-- Virgo Scout 0005: dedupe multi-categoria.
-- types (união de tipos por negócio) + identidade por place_id.
-- Passos: coluna → união de types → escolha da vencedora → transferência
-- de dados das perdedoras → exclusão → reescrita do id ← place_id.
-- Ids sha1 (40 hex) nunca colidem com place_id (contém ':'), então a
-- reescrita só "colide" entre linhas do mesmo place_id (já fundidas).

-- 1. coluna types
alter table leads add column if not exists types text;
update leads set types = source where types is null and source is not null;

-- 2. união de types entre linhas que compartilham place_id
--    (mesmo lugar capturado em categorias diferentes)
with merged as (
  select place_id,
         string_agg(distinct t, ',' order by t) as types_merged
  from leads,
       lateral unnest(string_to_array(coalesce(types, ''), ',')) as t
  where place_id is not null and place_id <> '' and coalesce(types, '') <> ''
  group by place_id
)
update leads l
   set types = m.types_merged
  from merged m
 where l.place_id = m.place_id;

-- 3+4. vencedora por place_id (mais reviews; empate: site, telefone, id);
--       transfere contato/enriquecimento faltantes e apaga as perdedoras
with ranked as (
  select id,
         place_id,
         row_number() over (
           partition by place_id
           order by coalesce(reviews, 0) desc,
                    (website is not null) desc,
                    (phone is not null) desc,
                    id
         ) as rn
    from leads
   where place_id is not null and place_id <> ''
), winner as (
  select id as old_id, place_id from ranked where rn = 1
), carry as (
  update leads w
     set status = case when w.status = 'novo' and l.status <> 'novo' then l.status else w.status end,
         last_contact_at = coalesce(w.last_contact_at, l.last_contact_at),
         notes = coalesce(w.notes, l.notes),
         email = coalesce(w.email, l.email),
         instagram = coalesce(w.instagram, l.instagram),
         facebook = coalesce(w.facebook, l.facebook),
         since_year = coalesce(w.since_year, l.since_year),
         site_title = coalesce(w.site_title, l.site_title),
         enriched_at = coalesce(w.enriched_at, l.enriched_at),
         phone = coalesce(w.phone, l.phone),
         website = coalesce(w.website, l.website),
         rating = coalesce(w.rating, l.rating),
         claimed = coalesce(w.claimed, l.claimed),
         hours = coalesce(w.hours, l.hours),
         photos = coalesce(w.photos, l.photos),
         whatsapp_hint = coalesce(w.whatsapp_hint, false) or coalesce(l.whatsapp_hint, false),
         closed = coalesce(w.closed, false) or coalesce(l.closed, false)
    from leads l, winner win
   where l.place_id = win.place_id
     and w.id = win.old_id
     and l.id <> win.old_id
  returning w.id
)
delete from leads l
 using winner win
 where l.place_id = win.place_id
   and l.id <> win.old_id;

-- 5. reescreve o id das sobreviventes para place_id
update leads
   set id = place_id
 where place_id is not null and place_id <> ''
   and id <> place_id;
