# MongoDB Cloner A → B

Interactive CLI utility that copies databases from one MongoDB deployment to another. It was built to make cross-cluster migrations (Atlas ⇄ self-hosted, staging ⇄ production, etc.) predictable even when network conditions are rough.

---

## Features

- **Interactive wizard** – step-by-step prompts for source URI, databases to clone, destination URI, and overwrite confirmation.
- **Resilient copy engine** – reads data in very small, ordered pages to avoid socket timeouts and automatically retries transient network errors.
- **Progress feedback** – per-database and per-collection counters so long running clones stay transparent.
- **Optional index cloning** – build indexes as part of the run _or_ skip them with `--skip-indexes` and recreate afterwards.
- **Atlas friendly** – avoids cursors that free tiers disallow; safe to run against hosted Atlas clusters and other managed MongoDB services.
- **Xronox mode** – migrate raw Mongo collections into Xronox head documents + externalized storage pointers with resumable and validation support.

---

## Requirements

- Node.js **18+** (ESM + Top-level await required)
- Access to both MongoDB deployments (source & destination) from the machine running the CLI

> Tip: running the CLI from a host that lives in the same region/cluster as the databases drastically reduces the chance of network errors.

---

## Installation

```bash
# Run once (no install)
npx mongodb-cloner

# Install globally
yarn global add mongodb-cloner
# or
npm install -g mongodb-cloner

# Run after global install
mongodb-cloner
```

---

## Usage

### Standard Mongo → Mongo copy

1. Provide the **source MongoDB connection string** when prompted.
2. Select one or more databases to copy (space to toggle, enter to confirm).
3. Provide the **destination MongoDB connection string**.
4. If any selected database already exists on the destination, choose to overwrite, skip, or cancel.
5. Review the summary and confirm the clone.

```bash
# Clone with indexes
npx mongodb-cloner

# Clone data only (rebuild indexes yourself afterwards)
npx mongodb-cloner --skip-indexes
```

### Xronox mode (Mongo → Xronox storage)

Enable the dedicated workflow with `--xronox`.

```bash
# Fresh migration
npx mongodb-cloner --xronox

# Resume a partial run and validate storage after copy
npx mongodb-cloner --xronox --resume --validate
```

What changes in this mode:

- You provide a single Mongo URI (source). The tool loads `xronox.config.json`, instantiates the Xronox router, and writes head documents to `<collection>_head` while replacing the base collection with those heads.
- Every record is externalized to the configured Spaces/S3 bucket (`xronox.config.json` + environment variables). Head documents include `_system.storage.{bucket,key,size,checksum}` plus tracking metadata.
- `--resume` skips documents that already have `_system.storage.key`, making the run idempotent after network failures.
- `--validate` re-reads each stored JSON blob via the storage adapter and logs any checksum errors or missing objects.

> Need to inspect migrated data? Run `db.<collection>.find({ "_system.storage.key": { $exists: true } })` to see which documents are already “Xronox heads”.

### Options

| Flag             | Description                                                                                          |
| ---------------- | ---------------------------------------------------------------------------------------------------- |
| `--skip-indexes` | Copies only documents. Useful when index creation is slow or should be handled manually afterwards.  |
| `--xronox`       | Switch to the Xronox workflow (single URI → Xronox router + externalized storage).                   |
| `--resume`       | (Xronox only) Skip documents whose head already points to storage; helps recover from interruptions. |
| `--validate`     | (Xronox only) After the copy verifies every stored JSON payload exists in the bucket.                |

### Environment Variables

If you set these environment variables, they will prefill the prompts:

| Variable                  | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| `MONGODB_SOURCE_URI`      | default value for the source connection string prompt      |
| `MONGODB_DESTINATION_URI` | default value for the destination connection string prompt |

Xronox mode requires an `xronox.config.json` (simple example below) and the corresponding env vars. Example launch:

```bash
MONGODB_SOURCE_URI="mongodb+srv://user:pass@cluster0.mongodb.net" \
SPACE_ENDPOINT="https://s3.amazonaws.com" \
SPACE_BUCKET="my-xronox-bucket" \
SPACE_REGION="us-east-1" \
SPACE_ACCESS_KEY="..." \
SPACE_SECRET_KEY="..." \
npx mongodb-cloner --xronox --resume --validate
```

---

## xronox.config.json (minimal)

```json
{
  "database": {
    "uri": "ENV.MONGO_URI",
    "dbName": "ENV.XRONOX_DB||xronox_system"
  },
  "storage": {
    "endpoint": "ENV.SPACE_ENDPOINT",
    "region": "ENV.SPACE_REGION||us-east-1",
    "bucket": "ENV.SPACE_BUCKET",
    "accessKey": "ENV.SPACE_ACCESS_KEY",
    "secretKey": "ENV.SPACE_SECRET_KEY"
  }
}
```

For multi-tenant or advanced routing configs, follow the Xronox router documentation. The CLI simply relies on `createSingleXronox`; replace it with a custom router if you need dynamic tiers.

---

## What to Expect During a Clone

- The CLI prints per-database progress. Collections are copied one by one, and progress lines update in place.
- Network hiccups trigger retries with exponential backoff (for Mongo data copy and Xronox storage uploads). If a connection drops mid-run, rerun the exact command with `--resume` for Xronox to finish remaining records.
- Xronox mode logs every storage write (bucket/key/size/sha256) so you can audit after the fact.

---

## Troubleshooting

| Symptom                                  | Explanation & Fix                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read ETIMEDOUT`, `write EPIPE`          | The network closed the connection mid-batch. Reduce latency by running the CLI closer to the databases, keep `PAGE_SIZE` small, or retry with `--skip-indexes`. The cloner already retries exponentially, but repeated failures mean the connection is genuinely unstable. |
| Xronox run died midway                   | Re-run with `--xronox --resume` to skip already-migrated heads. Add `--validate` to confirm bucket integrity afterwards. Check `db.<collection>.find({ "_system.storage.key": { $exists: false } })` to find stragglers.                                                   |
| Validation warnings                      | If `--validate` logs missing objects, rerun the CLI without `--resume` for a clean rewrite, or delete the broken keys and rerun with `--resume`.                                                                                                                           |
| Prompt repeats or flickers               | Progress lines update in place. This is expected in some terminals. If it becomes noisy, pipe output to a file or use a non-interactive terminal.                                                                                                                          |
| Atlas “noTimeout cursors are disallowed” | The CLI avoids no-timeout cursors. If you see this, ensure you’re using the latest version and that the collection’s `_id` field is being used for pagination (default behavior).                                                                                          |
| I need indexes after skipping them       | Run `db.getSiblingDB('<db>').collection.createIndexes([...])` on the destination or use MongoDB Compass/Atlas UI to recreate indexes after the data copy finishes.                                                                                                         |

---

## Development & Testing

```bash
# Install dependencies
npm install

# Lint/Typecheck (TypeScript build)
npm run build

# Run tests (Vitest)
npm test
```

Key files:

- `src/index.ts` – CLI orchestration
- `src/cli/prompts.ts` – Enquirer prompts & validation
- `src/clone/runner.ts` – Copy engine (pagination, retries, index sync)
- `src/xronox/index.ts` – Xronox mode entrypoint & flag handling
- `src/xronox/runner.ts` – Xronox migration + resume/validation logic
- `src/database/mongodb.ts` – MongoDB helpers (connections & database listing)

---

## Release Checklist

1. Update `package.json` version if needed.
2. `npm run build`
3. `npm test`
4. `npm publish --access public`

Once published, announce the release with:

```
npx mongodb-cloner --skip-indexes
```

Copy databases with confidence 🎉
