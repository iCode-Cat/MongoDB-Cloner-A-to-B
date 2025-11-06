# MongoDB Cloner A → B

Interactive CLI utility that copies databases from one MongoDB deployment to another. It was built to make cross-cluster migrations (Atlas ⇄ self-hosted, staging ⇄ production, etc.) predictable even when network conditions are rough.

---

## Features

- **Interactive wizard** – step-by-step prompts for source URI, databases to clone, destination URI, and overwrite confirmation.
- **Resilient copy engine** – reads data in very small, ordered pages to avoid socket timeouts and automatically retries transient network errors.
- **Progress feedback** – per-database and per-collection counters so long running clones stay transparent.
- **Optional index cloning** – build indexes as part of the run _or_ skip them with `--skip-indexes` and recreate afterwards.
- **Atlas friendly** – avoids cursors that free tiers disallow; safe to run against hosted Atlas clusters and other managed MongoDB services.

---

## Requirements

- Node.js **18+** (ESM + Top-level await required)
- Access to both MongoDB deployments (source & destination) from the machine running the CLI

> Tip: running the CLI from a host that lives in the same region/cluster as the databases drastically reduces the chance of network errors.

---

## Installation

You can run the tool directly with `npx` or install it globally.

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

### Options

| Flag             | Description                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------- |
| `--skip-indexes` | Copies only documents. Useful when index creation is slow or should be handled manually afterwards. |

### Environment Variables

If you set these environment variables, they will prefill the prompts:

| Variable                  | Description                                                |
| ------------------------- | ---------------------------------------------------------- |
| `MONGODB_SOURCE_URI`      | default value for the source connection string prompt      |
| `MONGODB_DESTINATION_URI` | default value for the destination connection string prompt |

Example:

```bash
MONGODB_SOURCE_URI="mongodb+srv://user:pass@cluster0.mongodb.net" \
MONGODB_DESTINATION_URI="mongodb://localhost:27017" \
npx mongodb-cloner --skip-indexes
```

---

## What to Expect During a Clone

- The CLI prints per-database progress. Collections are copied one by one.
- Progress lines are refreshed in place – if you run the tool in CI/TTY-less environments, use the `--skip-indexes` flag and redirect stdout/stderr to capture status.
- When network hiccups occur, the utility retries each batch (up to 7 times) and falls back to inserting documents individually before failing.

---

## Troubleshooting

| Symptom                                  | Explanation & Fix                                                                                                                                                                                                                                                          |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `read ETIMEDOUT`, `write EPIPE`          | The network closed the connection mid-batch. Reduce latency by running the CLI closer to the databases, keep `PAGE_SIZE` small, or retry with `--skip-indexes`. The cloner already retries exponentially, but repeated failures mean the connection is genuinely unstable. |
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
- `src/database/mongodb.ts` – MongoDB helpers (connections & database listing)

---

## Release Checklist

1. Update `package.json` version if needed.
2. `npm run build`
3. `npm test`
4. `npm publish --access public`

Once published, announce the release with:

```

```
