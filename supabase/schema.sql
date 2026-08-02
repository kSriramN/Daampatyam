-- Run this once in the Supabase SQL Editor (Project → SQL Editor → New query).
-- Creates a table that only collects product feedback (star rating + optional
-- comment). No relationship data (chapters, photos, voice notes, partner
-- details) ever leaves the user's device — this table never sees it.

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  rating smallint not null check (rating between 1 and 5),
  comment text,
  device_id text, -- random per-device id, not tied to any identity
  submitted_at timestamptz not null default now()
);

alter table public.feedback enable row level security;

-- Anyone using the app (anon key) can submit feedback...
create policy "anyone can insert feedback"
  on public.feedback for insert
  to anon
  with check (true);

-- ...but cannot read, update, or delete anyone's feedback (including their own).
-- Read feedback from the Supabase Table Editor / SQL Editor with your own
-- account, which uses elevated privileges and bypasses this policy.


-- ---------------------------------------------------------------
-- kv_store: encrypted app data for logged-in accounts (meta, profile,
-- chapters, counters, moods, notes, todos, promises, bucketlist, reminders).
-- Every "value" here is ciphertext produced client-side (AES-256-GCM) —
-- Supabase (and anyone with dashboard access) only ever sees unreadable
-- blobs, never your passphrase, your recovery phrase, or plaintext content.
-- ---------------------------------------------------------------

create table if not exists public.kv_store (
  user_id uuid not null references auth.users(id) on delete cascade,
  key text not null,
  value text not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, key)
);

alter table public.kv_store enable row level security;

-- A logged-in user can only ever read or write their own rows.
create policy "users manage their own kv rows"
  on public.kv_store for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

