-- Virgo Scout 0003: pipeline de contato em leads.
-- Fecha o loop do funil: quem foi contatado, quando e observações.
alter table leads add column if not exists status text not null default 'novo';
alter table leads add column if not exists last_contact_at timestamptz;
alter table leads add column if not exists notes text;
create index if not exists leads_status on leads (status);
