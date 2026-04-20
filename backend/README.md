# Backend

Express server that handles multipart file uploads to MinIO (S3-compatible object storage) with PostgreSQL for tracking upload state.

Supports chunked uploads with init -> upload parts -> complete/abort lifecycle, plus deferred cleanup for stale uploads and pending deletions.

## Setup

```bash
cd backend
bun install

# create .env with at least:
# DATABASE_URL=postgres://app:app@localhost:5432/file_upload

# apply migrations
psql "$DATABASE_URL" -f migrations/001_create_uploads.sql
psql "$DATABASE_URL" -f migrations/002_create_uploads.sql

# start the API server
bun run dev
```

## Local Dependencies

- PostgreSQL reachable through `DATABASE_URL`
- MinIO running on `localhost:9000`
- Bucket name: `files`
- MinIO credentials are currently hardcoded in the server:
	- access key: `minioadmin`
	- secret key: `minioadmin`

## Cleanup Worker

The cleanup worker is a separate script:

```bash
bun run src/cleanup.ts
```

It handles three cases:

- stale DB-backed uploads still in `initiated`
- stale incomplete multipart uploads in MinIO older than 30 minutes
- files marked as `pending_delete`, which are removed from MinIO and then marked `deleted` in PostgreSQL

## API

| Endpoint             | Method | Description                                 |
| -------------------- | ------ | ------------------------------------------- |
| `/upload/init`       | POST   | Start a multipart upload session            |
| `/upload/complete`   | POST   | Finalize and assemble the upload            |
| `/upload/abort`      | POST   | Abort an in-progress upload                 |
| `/files`             | GET    | List completed files for the UI             |
| `/files/delete`      | POST   | Mark completed files as `pending_delete`    |

## Upload States

- `initiated`: multipart session exists and upload is still in progress
- `completed`: upload finished successfully
- `aborted`: upload was cancelled or stale cleanup aborted it
- `failed`: upload hit a terminal error
- `pending_delete`: UI requested deletion; cleanup worker will remove the object later
- `deleted`: object removal succeeded and the row was finalized

## Stack

- **Runtime:** Bun
- **Framework:** Express
- **Storage:** MinIO
- **Database:** PostgreSQL
