import readline from "node:readline";
import type {
  Collection,
  Document,
  MongoClient,
  CreateIndexesOptions,
} from "mongodb";
import { MongoNetworkError } from "mongodb";

type Dependencies = {
  source: MongoClient;
  destination: MongoClient;
  databases: string[];
  overwrite: string[];
  skipIndexes?: boolean;
};

const PAGE_SIZE = 10;
const MAX_RETRIES = 7;

export async function cloneDatabases({
  source,
  destination,
  databases,
  overwrite,
  skipIndexes = false,
}: Dependencies): Promise<void> {
  const totalDatabases = databases.length;
  let completedDatabases = 0;

  for (const dbName of databases) {
    completedDatabases += 1;
    const databasePercent = Math.round(
      (completedDatabases / totalDatabases) * 100
    );
    console.log(
      `Starting clone for database "${dbName}" [${databasePercent}% of databases]`
    );

    const sourceDb = source.db(dbName);
    const destinationDb = destination.db(dbName);
    const shouldOverwrite = overwrite.includes(dbName);

    if (shouldOverwrite) {
      console.log(
        `  • Overwrite requested – dropping destination database "${dbName}"`
      );
      await destinationDb.dropDatabase();
    }

    const sourceCollections = await sourceDb.listCollections().toArray();

    if (sourceCollections.length === 0) {
      console.log(`  • No collections found in "${dbName}" – skipping`);
      continue;
    }

    const totalCollections = sourceCollections.length;
    let completedCollections = 0;

    const destinationCollections = await destinationDb
      .listCollections({}, { nameOnly: true })
      .toArray();
    const destinationCollectionNames = new Set(
      destinationCollections.map((collection) => collection.name)
    );

    for (const collectionInfo of sourceCollections) {
      const collectionName = collectionInfo.name;

      if (!collectionName) {
        completedCollections += 1;
        continue;
      }

      completedCollections += 1;
      const collectionPercent = Math.round(
        (completedCollections / totalCollections) * 100
      );

      if (!shouldOverwrite && destinationCollectionNames.has(collectionName)) {
        console.log(
          `  • Skipping collection "${collectionName}" – already exists on destination`
        );
        continue;
      }

      console.log(
        `  • Cloning collection "${collectionName}" [${collectionPercent}% of collections]`
      );

      if (destinationCollectionNames.has(collectionName)) {
        await destinationDb.collection(collectionName).drop();
        destinationCollectionNames.delete(collectionName);
      }

      if (!destinationCollectionNames.has(collectionName)) {
        const collectionOptions =
          "options" in collectionInfo && collectionInfo.options
            ? sanitizeOptions(collectionInfo.options)
            : undefined;
        try {
          if (collectionOptions) {
            await destinationDb.createCollection(
              collectionName,
              collectionOptions
            );
          } else {
            await destinationDb.createCollection(collectionName);
          }
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          console.warn(
            `    ⚠️  Failed to create collection with source options. Falling back to existing collection. (${message})`
          );
        }
        destinationCollectionNames.add(collectionName);
      }

      await cloneCollection(
        sourceDb.collection(collectionName),
        destinationDb.collection(collectionName)
      );

      if (!skipIndexes) {
        await syncIndexes(
          sourceDb.collection(collectionName),
          destinationDb.collection(collectionName)
        );
      }
    }

    console.log(`Finished cloning database "${dbName}"`);
  }
}

async function cloneCollection(
  sourceCollection: Collection<Document>,
  destinationCollection: Collection<Document>
): Promise<void> {
  const totalDocs = await safeEstimatedCount(sourceCollection);
  let processedDocs = 0;
  let lastId: unknown = undefined;

  while (true) {
    const filter =
      lastId === undefined
        ? ({} as Record<string, unknown>)
        : ({
            _id: {
              $gt: lastId,
            },
          } as Record<string, unknown>);

    const page = await sourceCollection
      .find(filter)
      .sort({ _id: 1 })
      .limit(PAGE_SIZE)
      .toArray();

    if (page.length === 0) {
      break;
    }

    await insertBatch(destinationCollection, page);
    processedDocs += page.length;
    printProgress(processedDocs, totalDocs);

    lastId = page[page.length - 1]._id ?? lastId;

    await destinationCollection.db.command({ ping: 1 }).catch(() => {});
  }

  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write("    • 100% (complete)\n");
}

async function safeEstimatedCount(
  collection: Collection<Document>
): Promise<number> {
  try {
    return await collection.estimatedDocumentCount();
  } catch {
    const result = await collection.aggregate([{ $count: "count" }]).toArray();
    return result[0]?.count ?? 0;
  }
}

async function insertBatch(
  destinationCollection: Collection<Document>,
  documents: Document[],
  attempt = 1
): Promise<void> {
  try {
    await destinationCollection.insertMany(documents, {
      ordered: false,
      bypassDocumentValidation: true,
    });
  } catch (error) {
    const isNetworkError =
      error instanceof MongoNetworkError ||
      (error instanceof Error &&
        /(EPIPE|ETIMEDOUT|ECONNRESET|Connection closed|Socket Closed)/i.test(
          error.message
        ));

    if (!isNetworkError || attempt >= MAX_RETRIES) {
      // Fallback to individual inserts before giving up
      await insertIndividually(destinationCollection, documents);
      return;
    }

    const delay = Math.min(20_000, 500 * attempt * attempt);
    console.warn(
      `    ⚠️  Network issue while inserting batch (${
        error instanceof Error ? error.message : error
      }). Retrying in ${delay}ms (attempt ${attempt + 1}/${MAX_RETRIES}).`
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    try {
      await destinationCollection.db.command({ ping: 1 });
    } catch (pingError) {
      console.warn(
        `    ⚠️  Ping after failure also errored: ${
          pingError instanceof Error ? pingError.message : pingError
        }`
      );
    }

    await insertBatch(destinationCollection, documents, attempt + 1);
  }
}

async function insertIndividually(
  destinationCollection: Collection<Document>,
  documents: Document[]
): Promise<void> {
  for (const doc of documents) {
    let attempt = 1;
    while (attempt <= MAX_RETRIES) {
      try {
        await destinationCollection.insertOne(doc, {
          bypassDocumentValidation: true,
        });
        break;
      } catch (error) {
        const isNetworkError =
          error instanceof MongoNetworkError ||
          (error instanceof Error &&
            /(EPIPE|ETIMEDOUT|ECONNRESET|Connection closed|Socket Closed)/i.test(
              error.message
            ));

        if (!isNetworkError || attempt >= MAX_RETRIES) {
          throw error;
        }

        const delay = Math.min(20_000, 500 * attempt * attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
        attempt += 1;
      }
    }
  }
}

function printProgress(processedDocs: number, totalDocs: number): void {
  const docPercent = totalDocs
    ? Math.min(100, Math.round((processedDocs / totalDocs) * 100))
    : Math.round((processedDocs / (processedDocs || 1)) * 100);
  const message = `    • ${docPercent}% (${processedDocs}/${totalDocs || "?"})`;
  readline.clearLine(process.stdout, 0);
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(message);
}

async function syncIndexes(
  sourceCollection: Collection<Document>,
  destinationCollection: Collection<Document>
): Promise<void> {
  const indexes = await sourceCollection.indexes();

  for (const index of indexes) {
    if (index.name === "_id_") {
      continue;
    }

    try {
      const options = buildIndexOptions(index);
      await destinationCollection.createIndex(index.key, options);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `    ⚠️  Failed to create index "${index.name}" on collection "${destinationCollection.namespace}". (${message})`
      );
    }
  }
}

function sanitizeOptions<T extends Record<string, unknown>>(options: T): T {
  const sanitized = Object.fromEntries(
    Object.entries(options).filter(([, value]) => value != null)
  );
  return sanitized as T;
}

function buildIndexOptions(index: Record<string, any>): CreateIndexesOptions {
  const options: CreateIndexesOptions = {
    name: index.name,
  };

  if (typeof index.unique === "boolean") {
    options.unique = index.unique;
  }

  if (typeof index.sparse === "boolean") {
    options.sparse = index.sparse;
  }

  if (typeof index.background === "boolean") {
    options.background = index.background;
  }

  if (typeof index.expireAfterSeconds === "number") {
    options.expireAfterSeconds = index.expireAfterSeconds;
  }

  if (index.partialFilterExpression) {
    options.partialFilterExpression = index.partialFilterExpression;
  }

  if (index.collation) {
    options.collation = index.collation;
  }

  if (index.wildcardProjection) {
    options.wildcardProjection = index.wildcardProjection;
  }

  if (index.weights) {
    options.weights = index.weights;
  }

  if (index.default_language) {
    options.default_language = index.default_language;
  }

  if (index.language_override) {
    options.language_override = index.language_override;
  }

  if (index.textIndexVersion != null) {
    options.textIndexVersion = index.textIndexVersion;
  }

  if (index["2dsphereIndexVersion"] != null) {
    options["2dsphereIndexVersion"] = index["2dsphereIndexVersion"];
  }

  if (index.bits != null) {
    options.bits = index.bits;
  }

  if (index.min != null) {
    options.min = index.min;
  }

  if (index.max != null) {
    options.max = index.max;
  }

  if (index.bucketSize != null) {
    options.bucketSize = index.bucketSize;
  }

  if (index.storageEngine) {
    options.storageEngine = index.storageEngine;
  }

  if (typeof index.hidden === "boolean") {
    options.hidden = index.hidden;
  }

  return options;
}
