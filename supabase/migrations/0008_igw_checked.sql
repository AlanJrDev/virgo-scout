-- 0008: rastreio da checagem de WhatsApp na bio do Instagram (evita re-loop infinito)
alter table if exists leads
  add column if not exists igw_checked_at timestamptz;
