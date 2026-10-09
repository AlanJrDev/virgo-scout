-- Virgo Scout 0004: enriquecimento (Maps detalhe + site analyzer)
alter table leads add column if not exists category text;
alter table leads add column if not exists plus_code text;
alter table leads add column if not exists lat numeric;
alter table leads add column if not exists lng numeric;
alter table leads add column if not exists place_id text;
alter table leads add column if not exists claimed boolean;
alter table leads add column if not exists hours text;
alter table leads add column if not exists photos int;
alter table leads add column if not exists closed boolean;
alter table leads add column if not exists instagram text;
alter table leads add column if not exists facebook text;
alter table leads add column if not exists email text;
alter table leads add column if not exists whatsapp_hint boolean;
alter table leads add column if not exists since_year int;
alter table leads add column if not exists site_title text;
alter table leads add column if not exists enriched_at timestamptz;
create index if not exists leads_unenriched on leads (enriched_at) where enriched_at is null;
