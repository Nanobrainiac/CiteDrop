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
  facebook_post_id text,
  facebook_posted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table articles
  add column if not exists facebook_post_id text;

alter table articles
  add column if not exists facebook_posted_at timestamptz;

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

create table if not exists article_publish_reminders (
  id uuid primary key default gen_random_uuid(),
  article_id uuid not null references articles(id) on delete cascade,
  reminder_number int not null check (reminder_number between 1 and 5),
  sent_to text not null,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (article_id, reminder_number)
);

create index if not exists article_publish_reminders_article_id_idx
  on article_publish_reminders(article_id, sent_at desc);
