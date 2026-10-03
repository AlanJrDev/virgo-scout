-- Virgo Scout 0002: preserva a query original da captura em leads.origin.
-- O campo source virou tag de categoria ('arquitetura' | demais) e deixou de
-- carregar o contexto que o classificador usa; origin mantém esse contexto.
alter table leads add column if not exists origin text;
