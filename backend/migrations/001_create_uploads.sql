create extension if not exists pgcrypto;

create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  upload_id text not null unique,
  object_key text not null unique,
  original_file_name text not null,
  content_type text not null,
  file_size bigint not null,
  chunk_count integer not null,
  bucket_name text not null default 'files',
  status text not null check (status in ('initiated', 'completed', 'aborted', 'failed')),
  etag text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  error_reason text
);