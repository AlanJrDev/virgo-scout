-- 0013: cadastro público (signups) — solicitação pendente revisada pelo founder no painel.
-- RLS habilitada SEM policies: anon/authenticated ficam sem acesso a nenhuma linha
-- (PostgREST devolve vazio/zeros); acesso real só via service key no servidor
-- (api/signup, api/signups, api/signup-review) — service_role não passa por RLS.
create table if not exists public.signups (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  phone text not null,
  cpf text not null,
  algo text not null default 'scrypt',
  salt text not null,
  hash text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  constraint signups_status_chk check (status in ('pending','approved','rejected'))
);
-- unique por e-mail só entre cadastros ativos: rejected não bloqueia novo
-- cadastro do mesmo e-mail (a checagem da API também filtra pending/approved)
create unique index if not exists signups_email_active_uidx on public.signups (email) where status in ('pending','approved');
create index if not exists signups_status_created_idx on public.signups (status, created_at desc);
alter table public.signups enable row level security;
revoke all on public.signups from anon, authenticated;
