-- 0011: rastreio de retry do backfill de whatsapp (Fase 1 — descoberta profunda)
alter table if exists leads
  add column if not exists wa_attempts int not null default 0; -- rodadas do enrich:wa que já analisaram o lead
alter table if exists leads
  add column if not exists wa_last_try timestamptz;            -- última passada (cooldown 7 dias na fila)
-- sem índice: 129 linhas hoje; custo de manutenção > ganho (decisão H)
