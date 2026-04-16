# Backend

Express server that handles multipart file uploads to MinIO (S3-compatible object storage) with PostgreSQL for tracking upload state.

Supports chunked uploads with init → upload parts → complete/abort lifecycle, including cleanup of stale uploads.

## Setup

```bash
bun install
cp .env.example .env  # configure MinIO + Postgres credentials
bun run dev
```

## API

| Endpoint             | Method | Description                        |
| -------------------- | ------ | ---------------------------------- |
| `/upload/init`       | POST   | Start a multipart upload session   |
| `/upload/complete`   | POST   | Finalize and assemble the upload   |
| `/upload/abort`      | POST   | Abort an in-progress upload        |

## Stack

- **Runtime:** Bun
- **Framework:** Express
- **Storage:** MinIO
- **Database:** PostgreSQL
