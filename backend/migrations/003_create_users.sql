create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now()
);

alter table uploads
add column user_id uuid references users(id);
