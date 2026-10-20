-- 0012: updated_at do lead (skip-fresco do Capture V2 consulta `updated_at=gte`) — rodar no SQL Editor (migrations NÃO sobem via PostgREST)
alter table if exists leads add column if not exists updated_at timestamptz not null default now();
-- backfill: leads antigos ganham o valor da captura (captured_at; leads nao tem created_at, fallback = now)
update leads set updated_at = coalesce(captured_at, now());
-- mantem a coluna fresca a cada INSERT/UPDATE sem touch manual do app
create or replace function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;
drop trigger if exists leads_set_updated_at on leads;
create trigger leads_set_updated_at before insert or update on leads for each row execute function set_updated_at();
