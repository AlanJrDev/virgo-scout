-- 0010: evidência/origem do WhatsApp declarado (Fase 0 — WhatsApp real)
alter table if exists leads
  add column if not exists wa_source text;      -- maps|site|instagram; null = desconhecido (pré-0010)
alter table if exists leads
  add column if not exists wa_status text;      -- declared|suspect|invalid (classificador wa-audit)
alter table if exists leads
  add column if not exists wa_evidence text;    -- URL da página onde o link foi achado
alter table if exists leads
  add column if not exists wa_checked_at timestamptz; -- última checagem (audit:wa)
create index if not exists leads_wa_status_idx on leads (wa_status) where wa_status is not null;
