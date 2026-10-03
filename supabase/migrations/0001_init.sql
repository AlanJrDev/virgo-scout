-- Virgo Scout: schema inicial (usuários, sessões, leads, capturas)
-- RLS habilitado SEM policies = nega tudo para clientes; só o servidor acessa com a secret key.
create extension if not exists pgcrypto;

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('founder','cofounder')),
  algo text not null default 'scrypt',
  salt text not null,
  hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token_hash text primary key,
  email text not null,
  role text not null,
  exp timestamptz not null
);
create index if not exists sessions_exp on sessions (exp);

create table if not exists leads (
  id text primary key,
  name text,
  rating numeric,
  reviews int,
  address text,
  phone text,
  website text,
  source text,
  area text,
  area_conf numeric,
  captured_at timestamptz
);
create index if not exists leads_captured on leads (captured_at desc);

create table if not exists captures (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz,
  finished_at timestamptz,
  status text not null check (status in ('running','done','failed')),
  queries int,
  leads_count int
);

alter table users enable row level security;
alter table sessions enable row level security;
alter table leads enable row level security;
alter table captures enable row level security;
