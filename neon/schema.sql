create extension if not exists "pgcrypto";

create table if not exists content_roles (
  clerk_user_id text primary key,
  role text not null default 'user' check (role in ('user', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists articles (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  slug text not null unique,
  subtitle text,
  summary text,
  category text not null default 'Research',
  status text not null default 'draft' check (status in ('draft', 'published', 'archived', 'deleted')),
  body jsonb not null default '[]'::jsonb,
  claims_json jsonb not null default '[]'::jsonb,
  charts_json jsonb not null default '[]'::jsonb,
  sources_json jsonb not null default '[]'::jsonb,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table articles
  drop constraint if exists articles_created_by_fkey;

alter table articles
  alter column created_by type text using created_by::text;

alter table articles
  drop constraint if exists articles_status_check;

alter table articles
  add constraint articles_status_check
  check (status in ('draft', 'published', 'archived', 'deleted'));

create index if not exists articles_status_created_at_idx on articles(status, created_at desc);
create index if not exists articles_category_idx on articles(category);
create index if not exists articles_slug_idx on articles(slug);
create index if not exists articles_created_by_idx on articles(created_by, created_at desc);
create index if not exists articles_search_idx on articles using gin (
  to_tsvector('english', coalesce(title, '') || ' ' || coalesce(summary, '') || ' ' || coalesce(category, ''))
);
