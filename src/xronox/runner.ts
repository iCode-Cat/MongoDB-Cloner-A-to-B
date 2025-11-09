import { createHash, randomUUID } from "node:crypto";

import { createSingleXronox, jsonKey, Repos } from "@xronoces/xronox-core";
import type { RouteContext } from "@xronoces/xronox-core";
import type { StorageAdapter } from "@xronoces/xronox-storage-interface";
import type { Collection, MongoClient, ObjectId } from "mongodb";

import type { XronoxContext } from "./index.js";

const PAGE_SIZE = 50;

type MigrateOptions = {
  resume?: boolean;
  validate?: boolean;
};

export async function migrateCollections(
  context: XronoxContext,
  options: MigrateOptions = {}
): Promise<void> {
  const { client, databaseName, collections, configPath, uri } = context;

  process.env.MONGO_URI = uri;

  const router = createSingleXronox({
    configPath,
    overrideDbName: databaseName,
  });

  try {
    for (let i = 0; i < collections.length; i += 1) {
      const collectionName = collections[i];
      console.log(
        `• Migrating collection "${collectionName}" [${i + 1}/${
          collections.length
        }]`
      );
      await migrateCollection({
        client,
        router,
        databaseName,
        collectionName,
        options,
      });
    }
  } finally {
    if ("shutdown" in router && typeof router.shutdown === "function") {
      await router.shutdown();
    }
  }
}

type RouterLike = ReturnType<typeof createSingleXronox>;

type MigrateArgs = {
  client: MongoClient;
  router: RouterLike;
  databaseName: string;
  collectionName: string;
  options: MigrateOptions;
};

async function migrateCollection(args: MigrateArgs): Promise<void> {
  const { client, router, databaseName, collectionName, options } = args;
  const sourceCollection = client.db(databaseName).collection(collectionName);

  const total = await sourceCollection.countDocuments();
  if (total === 0) {
    console.log("    • No documents found. Skipping.");
    return;
  }

  const routeCtx = createRouteContext(databaseName, collectionName);
  const routeInfo = router.route(routeCtx);
  const targetClient = await router.getMongoClient(routeInfo.mongoUri);
  const targetDb = targetClient.db(databaseName);
  const storageInfo = await router.getSpaces(routeCtx);

  const repos = new Repos(targetDb, collectionName);
  await repos.ensureIndexes(undefined as any);

  const headCollectionName = `${collectionName}_head`;
  const targetHeadCollection = targetDb.collection(headCollectionName);
  const baseCollection = targetDb.collection(collectionName);

  let migrated = 0;
  const cursor = sourceCollection.find({}, { batchSize: PAGE_SIZE });

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc) {
      continue;
    }

    const result = await migrateDocument({
      repos,
      headCollection: targetHeadCollection,
      baseCollection,
      storage: storageInfo,
      collectionName,
      record: doc,
      resume: options.resume ?? false,
    });

    if (!result) {
      continue;
    }

    migrated += 1;
    logProgress(migrated, total);
  }

  console.log(`    • 100% (${migrated}/${total})`);

  if (options.validate) {
    await validateCollection({
      headCollection: targetHeadCollection,
      storage: storageInfo,
      collectionName,
    });
  }
}

type MigrateDocumentArgs = {
  repos: Repos;
  headCollection: Collection;
  baseCollection: Collection;
  storage: { storage: StorageAdapter; bucket: string };
  collectionName: string;
  record: Record<string, unknown>;
  resume: boolean;
};

type MigrationResult = {
  idHex: string;
} | null;

async function migrateDocument(
  args: MigrateDocumentArgs
): Promise<MigrationResult> {
  const {
    repos,
    headCollection,
    baseCollection,
    storage,
    collectionName,
    record,
    resume,
  } = args;

  const id = record._id as ObjectId | undefined;
  if (!id) {
    return null;
  }

  const idHex = id.toString();

  if (resume) {
    const existingHead = await headCollection.findOne({ _id: id });
    if (existingHead && existingHead._system?.storage?.key) {
      return null;
    }
  }

  const payload: Record<string, unknown> = { ...record };
  delete payload._id;
  delete payload._system;

  if (
    !payload.id ||
    (typeof payload.id === "string" && payload.id.trim() === "")
  ) {
    payload.id = randomUUID();
  }

  const jsonContent = JSON.stringify(payload);
  const size = Buffer.byteLength(jsonContent, "utf8");
  const checksum = createHash("sha256").update(jsonContent).digest("hex");
  const key = jsonKey(collectionName, idHex, 0);

  await storage.storage.putJSON(storage.bucket, key, payload);

  const cv = await repos.incCv(undefined);

  const metaIndexed: Record<string, unknown> =
    typeof record.metaIndexed === "object" && record.metaIndexed !== null
      ? { ...(record.metaIndexed as Record<string, unknown>) }
      : {};

  if (payload.id !== undefined) {
    metaIndexed.id = payload.id;
  }

  const headDoc: Record<string, unknown> = {
    _id: id,
    metaIndexed,
    _system: {
      ov: 0,
      cv,
      storage: {
        bucket: storage.bucket,
        key,
        size,
        checksum,
      },
      timestamps: {
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      tracking: { jobIds: [] },
    },
  };

  if (payload.id !== undefined) {
    headDoc.id = payload.id;
  }

  await headCollection.replaceOne({ _id: id }, headDoc, { upsert: true });

  await baseCollection.replaceOne({ _id: id }, headDoc, { upsert: true });

  return { idHex };
}

type ValidationArgs = {
  headCollection: Collection;
  storage: { storage: StorageAdapter; bucket: string };
  collectionName: string;
};

async function validateCollection(args: ValidationArgs): Promise<void> {
  const { headCollection, storage, collectionName } = args;
  const cursor = headCollection.find({});
  let validated = 0;
  const failures: string[] = [];

  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    if (!doc || !doc._system?.storage?.key) {
      continue;
    }

    try {
      await storage.storage.getJSON(storage.bucket, doc._system.storage.key);
      validated += 1;
    } catch (error) {
      failures.push(doc._id?.toString?.() ?? "unknown");
      console.warn(
        `⚠️  Validation failed for ${collectionName}/${
          doc._system.storage.key
        }: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  console.log(
    failures.length === 0
      ? `    • Validation passed (${validated} documents)`
      : `    • Validation completed with ${failures.length} failures`
  );
}

function logProgress(current: number, total: number): void {
  const percent = Math.min(100, Math.floor((current / total) * 100));
  process.stdout.write(`    • ${percent}% (${current}/${total})\r`);
}

function createRouteContext(dbName: string, collection: string): RouteContext {
  return {
    dbName,
    collection,
    databaseType: "runtime",
  };
}
