import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import dotenv from "dotenv";
dotenv.config();

describe("runCli", () => {
  const logs: string[] = [];
  const originalLog = console.log;

  beforeEach(() => {
    logs.length = 0;
    console.log = vi.fn((message?: unknown) => {
      logs.push(String(message));
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    console.log = originalLog;
  });

  it.skip("prints the welcome message and confirms the selected database", async () => {
    // TODO: Update this test to mock promptMongoUri and promptDatabaseSelection
    // This test needs to be rewritten since runCli no longer takes dependencies
    /*
    vi.mock("../src/cli/prompts", () => ({
      promptMongoUri: vi.fn().mockResolvedValue("mongodb://localhost:27017"),
      promptDatabaseSelection: vi.fn().mockResolvedValue(["mongodb"]),
    }));
    
    await runCli();
    expect(logs).toContain("Welcome to MongoDB Cloner");
    expect(logs).toContain("Ready to clone: mongodb");
    */
  });

  it("runs the CLI flow with mocked prompts and database calls", async () => {
    vi.resetModules();

    const prompts = await import("../src/cli/prompts");
    vi.spyOn(prompts, "promptMongoUri").mockResolvedValue(
      "mongodb://localhost:27017"
    );
    vi.spyOn(prompts, "promptDatabaseSelection").mockResolvedValue([
      "db1",
      "db2",
    ]);
    vi.spyOn(prompts, "promptDestinationMongoUri").mockResolvedValue(
      "mongodb://localhost:27018"
    );
    vi.spyOn(prompts, "promptConflictResolution").mockResolvedValue({
      overwrite: [],
      skip: [],
      cancelled: false,
    });
    vi.spyOn(prompts, "promptToBeSure").mockResolvedValue("Y");

    const dbModule = await import("../src/database/mongodb");
    const sourceClose = vi.fn();
    const destinationClose = vi.fn();
    vi.spyOn(dbModule, "connectToMongo")
      .mockResolvedValueOnce({
        close: sourceClose,
      } as any)
      .mockResolvedValueOnce({
        close: destinationClose,
      } as any);
    vi.spyOn(dbModule, "listDatabaseNames").mockResolvedValue({
      databaseNamesNoConfig: ["db1", "db2", "db3"],
      databaseNamesFull: ["db1", "db2", "db3"],
    });
    vi.spyOn(dbModule, "listDatabaseNamesFromClient").mockResolvedValue({
      databaseNamesNoConfig: ["db4", "db5"],
      databaseNamesFull: ["db4", "db5"],
    });

    const cloneRunner = await import("../src/clone/runner");
    const cloneSpy = vi
      .spyOn(cloneRunner, "cloneDatabases")
      .mockResolvedValue(undefined);

    const { runCli } = await import("../src/index");

    await runCli();

    expect(logs).toEqual([
      "Welcome to MongoDB Cloner",
      "Connecting to MongoDB...",
      "✓ Connected successfully!",
      "Ready to clone: db1, db2",
      "Connecting to destination MongoDB...",
      "✓ Connected successfully!",
      "No conflicts detected on destination.",
      "Summary:",
      "  Source URI: mongodb://localhost:27017",
      "  Destination URI: mongodb://localhost:27018",
      "  Databases queued: db1, db2",
      "✅ Cloning completed successfully.",
    ]);
    expect(sourceClose).toHaveBeenCalled();
    expect(destinationClose).toHaveBeenCalled();
    expect(cloneSpy).toHaveBeenCalledWith({
      source: expect.any(Object),
      destination: expect.any(Object),
      databases: ["db1", "db2"],
      overwrite: [],
      skipIndexes: false,
    });
  });

  it("skips index creation when --skip-indexes is provided", async () => {
    vi.resetModules();

    const prompts = await import("../src/cli/prompts");
    vi.spyOn(prompts, "promptMongoUri").mockResolvedValue(
      "mongodb://localhost:27017"
    );
    vi.spyOn(prompts, "promptDatabaseSelection").mockResolvedValue(["db1"]);
    vi.spyOn(prompts, "promptDestinationMongoUri").mockResolvedValue(
      "mongodb://localhost:27018"
    );
    vi.spyOn(prompts, "promptConflictResolution").mockResolvedValue({
      overwrite: [],
      skip: [],
      cancelled: false,
    });
    vi.spyOn(prompts, "promptToBeSure").mockResolvedValue("Y");

    const dbModule = await import("../src/database/mongodb");
    vi.spyOn(dbModule, "connectToMongo")
      .mockResolvedValueOnce({ close: vi.fn() } as any)
      .mockResolvedValueOnce({ close: vi.fn() } as any);
    vi.spyOn(dbModule, "listDatabaseNames").mockResolvedValue({
      databaseNamesNoConfig: ["db1"],
      databaseNamesFull: ["db1"],
    });
    vi.spyOn(dbModule, "listDatabaseNamesFromClient").mockResolvedValue({
      databaseNamesNoConfig: [],
      databaseNamesFull: [],
    });

    const cloneRunner = await import("../src/clone/runner");
    const cloneSpy = vi
      .spyOn(cloneRunner, "cloneDatabases")
      .mockResolvedValue(undefined);

    const { runCli } = await import("../src/index");

    await runCli({ skipIndexes: true });

    expect(cloneSpy).toHaveBeenCalledWith({
      source: expect.any(Object),
      destination: expect.any(Object),
      databases: ["db1"],
      overwrite: [],
      skipIndexes: true,
    });
    expect(logs).toContain("  Indexes will be skipped.");
  });

  it("connects to a real MongoDB when MONGODB_TEST_URI is set", async () => {
    const mongoUri = process.env.MONGODB_TEST_URI;
    if (!mongoUri) {
      console.warn("MONGODB_TEST_URI not set, skipping integration test");
      return;
    }

    vi.resetModules();

    const prompts = await import("../src/cli/prompts");
    vi.spyOn(prompts, "promptMongoUri").mockResolvedValue(mongoUri);
    vi.spyOn(prompts, "promptDatabaseSelection").mockImplementation(
      async (databases: string[]) => databases
    );
    vi.spyOn(prompts, "promptDestinationMongoUri").mockResolvedValue(mongoUri);
    vi.spyOn(prompts, "promptConflictResolution").mockResolvedValue({
      overwrite: [],
      skip: [],
      cancelled: false,
    });
    vi.spyOn(prompts, "promptToBeSure").mockResolvedValue("N");

    const cloneRunner = await import("../src/clone/runner");
    vi.spyOn(cloneRunner, "cloneDatabases").mockResolvedValue(undefined);

    const { runCli } = await import("../src/index");

    await runCli();

    expect(logs).toContain("Connecting to destination MongoDB...");
    expect(logs).toContain("Summary:");
    expect(logs).toContain("Cloning cancelled by user.");
  });
});
