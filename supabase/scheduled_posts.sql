-- Run this in the Supabase SQL editor once to enable post scheduling.

create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  platform text not null check (platform in ('facebook', 'instagram', 'linkedin')),
  -- Facebook Page ID / Instagram Business Account ID / LinkedIn URN (same as connected_accounts.external_id)
  external_id text not null,
  account_name text,
  caption text not null,
  image_url text not null,
  scheduled_for timestamptz not null,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'posted', 'failed', 'cancelled')),
  error text,
  attempts int not null default 0,
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scheduled_posts_due_idx on scheduled_posts (status, scheduled_for);
