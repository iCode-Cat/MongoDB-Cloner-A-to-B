import { MongoClient } from "mongodb";
import path from "node:path";

import {
  promptMongoUri,
  promptSingleDatabase,
  promptCollectionSelection,
  promptToBeSure,
} from "../cli/prompts.js";
import { connectToMongo } from "../database/mongodb.js";
import { migrateCollections } from "./runner.js";

type XronoxContext = {
  client: MongoClient;
  uri: string;
  databaseName: string;
  collections: string[];
  configPath: string;
};

const RESUME_FLAG = "--resume";
const VALIDATE_FLAG = "--validate";

async function listCollections(client: MongoClient, dbName: string): Promise<string[]> {
  const db = client.db(dbName);
  const collections = await db
    .listCollections({}, { nameOnly: true })
    .toArray();
  return collections
    .map((col) => col.name)
    .filter((name): name is string => typeof name === "string");
}

export async function runXronoxMode(): Promise<void> {
  console.log("Welcome to MongoDB Cloner (Xronox mode)");

  const args = process.argv.slice(2);
  const resumeMode = args.includes(RESUME_FLAG);
  const validateMode = args.includes(VALIDATE_FLAG);

  const sourceUri = await promptMongoUri();
  const configPath = path.resolve(process.cwd(), "xronox.config.json");

  let client: Awaited<ReturnType<typeof connectToMongo>> | undefined;

  try {
    console.log("Connecting to MongoDB for Xronox migration...");
    client = await connectToMongo({ mongouri: sourceUri });
    console.log("✓ Connected successfully!");

    const adminDb = client.db().admin();
    const { databases } = await adminDb.listDatabases();
    const databaseNames = databases
      .map((db) => db.name)
      .filter((name): name is string => typeof name === "string" && name !== "admin" && name !== "local");

    if (databaseNames.length === 0) {
      console.log("No databases available for Xronox migration.");
      return;
    }

    const databaseName = await promptSingleDatabase(databaseNames);

    const availableCollections = await listCollections(client, databaseName);

    if (availableCollections.length === 0) {
      console.log(`Database '${databaseName}' has no collections to migrate.`);
      return;
    }

    const collections = await promptCollectionSelection(availableCollections);

    if (collections.length === 0) {
      console.log("No collections selected. Exiting Xronox mode.");
      return;
    }

    console.log("Summary:");
    console.log(`  Mongo URI: ${sourceUri}`);
    console.log(`  Xronox config: ${configPath}`);
    console.log(`  Database: ${databaseName}`);
    console.log(`  Collections: ${collections.join(", ")}`);
    if (resumeMode) {
      console.log("  Resume mode: enabled (skip existing heads)");
    }
    if (validateMode) {
      console.log("  Validation: enabled (check bucket after copy)");
    }

    const confirmation = await promptToBeSure();
    if (confirmation !== "Y") {
      console.log("Xronox migration cancelled by user.");
      return;
    }

    await migrateCollections(
      {
        client,
        uri: sourceUri,
        databaseName,
        collections,
        configPath,
      },
      {
        resume: resumeMode,
        validate: validateMode,
      }
    );

    console.log("✅ Xronox migration completed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Xronox migration failed: ${message}`);
  } finally {
    if (client) {
      try {
        await client.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️  Failed to close Xronox Mongo connection: ${message}`);
      }
    }
  }
}

export type { XronoxContext };
