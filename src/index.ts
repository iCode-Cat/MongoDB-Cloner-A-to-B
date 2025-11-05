import {
  promptMongoUri,
  promptDatabaseSelection,
  promptDestinationMongoUri,
  promptToBeSure,
  promptConflictResolution,
} from "./cli/prompts.js";
import {
  connectToMongo,
  listDatabaseNames,
  listDatabaseNamesFromClient,
} from "./database/mongodb.js";
import { cloneDatabases } from "./clone/runner.js";

type RunCliOptions = {
  skipIndexes?: boolean;
};

export async function runCli(options: RunCliOptions = {}): Promise<void> {
  console.log("Welcome to MongoDB Cloner");

  const sourceUri = await promptMongoUri();

  let source: Awaited<ReturnType<typeof connectToMongo>> | undefined;
  let destination: Awaited<ReturnType<typeof connectToMongo>> | undefined;

  try {
    console.log("Connecting to MongoDB...");
    source = await connectToMongo({ mongouri: sourceUri });
    console.log("✓ Connected successfully!");

    const { databaseNamesNoConfig } = await listDatabaseNames({
      mongouri: sourceUri,
    });

    if (databaseNamesNoConfig.length === 0) {
      console.log("No databases found to clone.");
      return;
    }

    const selectedDatabases = await promptDatabaseSelection(
      databaseNamesNoConfig
    );

    if (selectedDatabases.length === 0) {
      console.log("No databases selected. Exiting.");
      return;
    }

    console.log(`Ready to clone: ${selectedDatabases.join(", ")}`);

    const destinationUri = await promptDestinationMongoUri();

    console.log("Connecting to destination MongoDB...");
    destination = await connectToMongo({ mongouri: destinationUri });
    console.log("✓ Connected successfully!");

    const { databaseNamesNoConfig: destinationDatabases } =
      await listDatabaseNamesFromClient(destination);

    const conflictingDatabases = selectedDatabases.filter((name) =>
      destinationDatabases.includes(name)
    );

    let overwrite: string[] = [];
    let skip: string[] = [];

    if (conflictingDatabases.length > 0) {
      const resolution = await promptConflictResolution(conflictingDatabases);

      if (resolution.cancelled) {
        console.log("Cloning cancelled by user due to conflicts.");
        return;
      }

      overwrite = resolution.overwrite;
      skip = resolution.skip;

      if (overwrite.length > 0) {
        console.log(`Will overwrite: ${overwrite.join(", ")}`);
      }

      if (skip.length > 0) {
        console.log(`Will skip: ${skip.join(", ")}`);
      }
    } else {
      console.log("No conflicts detected on destination.");
    }

    const databasesToClone = selectedDatabases.filter(
      (name) => !skip.includes(name)
    );

    if (databasesToClone.length === 0) {
      console.log("No databases left to clone after resolving conflicts.");
      return;
    }

    console.log("Summary:");
    console.log(`  Source URI: ${sourceUri}`);
    console.log(`  Destination URI: ${destinationUri}`);
    console.log(`  Databases queued: ${databasesToClone.join(", ")}`);
    if (overwrite.length > 0) {
      console.log(`  Will overwrite: ${overwrite.join(", ")}`);
    }
    if (options.skipIndexes) {
      console.log("  Indexes will be skipped.");
    }

    const lastDecision = await promptToBeSure();

    if (lastDecision !== "Y") {
      console.log("Cloning cancelled by user.");
      return;
    }

    await cloneDatabases({
      source,
      destination,
      databases: databasesToClone,
      overwrite: overwrite.filter((name) => databasesToClone.includes(name)),
      skipIndexes: options.skipIndexes ?? false,
    });

    console.log("✅ Cloning completed successfully.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`❌ Cloning failed: ${message}`);
  } finally {
    if (source) {
      try {
        await source.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️  Failed to close source connection: ${message}`);
      }
    }

    if (destination) {
      try {
        await destination.close();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`⚠️  Failed to close destination connection: ${message}`);
      }
    }
  }
}
