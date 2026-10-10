-- 0006: WhatsApp real declarado no site do lead (extraído pelo enrich, antes descartado).
alter table leads add column if not exists whatsapp text;
