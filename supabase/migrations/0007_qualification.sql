-- 0007: qualificação multifonte — sinais de intenção/capacidade + fit persistido.
alter table leads add column if not exists site_audit jsonb;
alter table leads add column if not exists ads_active boolean;
alter table leads add column if not exists ads_landing text;
alter table leads add column if not exists ads_checked_at timestamptz;
alter table leads add column if not exists ig_followers int;
alter table leads add column if not exists ig_posts int;
alter table leads add column if not exists ig_last_post date;
alter table leads add column if not exists ig_checked_at timestamptz;
alter table leads add column if not exists fit int;
alter table leads add column if not exists icp text;
alter table leads add column if not exists reach int;
alter table leads add column if not exists fit_reasons text[];
alter table leads add column if not exists why_now text;
alter table leads add column if not exists outcome text;
alter table leads add column if not exists outcome_at timestamptz;
alter table leads add column if not exists qualified_at timestamptz;
create index if not exists leads_fit on leads (fit desc nulls last);
