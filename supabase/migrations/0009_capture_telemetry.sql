-- 0009: telemetria de captura em captures (category, budget_min, ra_count, qs)
-- + status 'partial' para runs cortados por budget: sem a check nova, todo
-- partial cai no fallback legado do sync para sempre (nota da Task 5).
-- Idempotente (IF NOT EXISTS / IF EXISTS): re-execução acidental no SQL Editor é segura.

alter table captures
  add column if not exists category text,
  add column if not exists budget_min numeric,
  add column if not exists ra_count int,
  add column if not exists qs jsonb;

-- check de status da 0001 (auto-nomeada captures_status_check): aceita
-- 'partial' além de running/done/failed. drop if exists + add = reexec inofensivo.
alter table captures drop constraint if exists captures_status_check;
alter table captures add constraint captures_status_check
  check (status in ('running','done','failed','partial'));

create index if not exists captures_category_idx on captures (category, started_at desc);

-- captures não tem created_at (0001): started_at é o nascimento do registro e a
-- chave de idempotência do sync — índice de recência equivalente ao pedido.
create index if not exists captures_started_at_idx on captures (started_at desc);
