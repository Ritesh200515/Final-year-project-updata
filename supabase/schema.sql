-- Run this in the Supabase SQL editor once, before deploying.

create table if not exists connected_accounts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('facebook', 'instagram', 'linkedin')),
  -- Human label so the dashboard can show "iBase Electrosoft LLP (Page)" etc.
  display_name text,
  -- Facebook Page ID / Instagram Business Account ID / LinkedIn Org URN
  external_id text not null,
  -- AES-256-GCM encrypted token, see lib/crypto.js
  encrypted_access_token text not null,
  token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, external_id)
);

-- Optional: log of what was posted where, useful for debugging failed posts
create table if not exists post_log (
  id uuid primary key default gen_random_uuid(),
  platform text not null,
  external_id text not null,
  caption text,
  image_url text,
  status text not null check (status in ('success', 'error')),
  response jsonb,
  created_at timestamptz not null default now()
);
