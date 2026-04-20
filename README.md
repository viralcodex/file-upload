# File Upload

A chunked file upload demo with a Vite + TypeScript frontend and an Express + MinIO + PostgreSQL backend.

The browser splits files into chunks, uploads each chunk to a presigned URL, then tells the server to assemble them. A file list with select-and-delete is included.

## Setup

```bash
# Frontend
bun install
bun run dev        # starts Vite on http://localhost:5173

# Backend (separate terminal)
cd backend
bun install
bun run dev        # starts Express on http://localhost:8080
```

The backend also needs PostgreSQL and MinIO running locally — see [backend/README.md](backend/README.md) for details.

## Frontend Files

| File                              | Purpose                                                    |
| --------------------------------- | ---------------------------------------------------------- |
| [index.html](index.html)         | Single page shell with file input, list, and toolbar       |
| [client.ts](client.ts)           | DOM wiring — connects buttons/input to `files.ts` exports  |
| [files.ts](files.ts)             | File list state, init/complete/abort flow, delete, refresh |
| [file-upload.ts](file-upload.ts) | Chunked upload with exponential backoff + jitter retries   |
| [css.css](css.css)               | Styles                                                     |

## How It Works

1. User picks a file via the `+` button.
2. `files.ts` calls `POST /upload/init` with file metadata → receives an `uploadId` and presigned PUT URLs.
3. `file-upload.ts` slices the file into chunks and uploads them in parallel (up to 5 retries each with exponential backoff).
4. On success, `files.ts` calls `POST /upload/complete` with the part ETags to assemble the file.
5. On failure, the client calls `POST /upload/abort` to clean up the multipart session and rethrows the error.
6. The file list (`GET /files`) shows completed uploads; selected files can be deleted (`POST /files/delete`).

## Stack

- **Frontend:** TypeScript, Vite, vanilla DOM
- **Backend:** Express, MinIO (S3-compatible), PostgreSQL — see [backend/README.md](backend/README.md)
