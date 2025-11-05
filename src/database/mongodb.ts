import { MongoClient } from "mongodb";

type Dependencies = {
  mongouri: string;
};

type DatabaseNames = {
  databaseNamesFull: string[];
  databaseNamesNoConfig: string[];
};

async function extractDatabaseNames(
  client: MongoClient
): Promise<DatabaseNames> {
  const adminDb = client.db("admin");
  const databases = await adminDb.admin().listDatabases();
  const databaseNamesFull = databases.databases.map((db) => db.name);
  const databaseNamesNoConfig = databaseNamesFull.filter(
    (name) => !["admin", "config", "local"].includes(name)
  );

  return {
    databaseNamesFull,
    databaseNamesNoConfig,
  };
}

export async function listDatabaseNames({
  mongouri,
}: Dependencies): Promise<DatabaseNames> {
  const client = new MongoClient(mongouri, {
    connectTimeoutMS: 3_600_000,
    socketTimeoutMS: 3_600_000,
    serverSelectionTimeoutMS: 120_000,
    retryReads: true,
    retryWrites: true,
  });

  try {
    await client.connect();
    return await extractDatabaseNames(client);
  } finally {
    await client.close();
  }
}

export function listDatabaseNamesFromClient(
  client: MongoClient
): Promise<DatabaseNames> {
  return extractDatabaseNames(client);
}

export async function connectToMongo({
  mongouri,
}: Dependencies): Promise<MongoClient> {
  const client = new MongoClient(mongouri, {
    connectTimeoutMS: 3_600_000,
    socketTimeoutMS: 3_600_000,
    serverSelectionTimeoutMS: 120_000,
    retryReads: true,
    retryWrites: true,
  });
  await client.connect();
  await client.db("admin").command({ ping: 1 });
  return client;
}
