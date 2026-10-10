# Design: Visão unificada de leads + Tapeçaria/Estofado (DF) + dedupe multi-categoria

Data: 2026-10-09 · Status: aprovado pelo usuário · Projeto: virgo-scout

## Objetivo

Ter **todos os leads numa tabela só**, diferenciados por **Tipo**, com filtros existentes preservados; eliminar a visualização segmentada por categoria (toggle some); adicionar duas categorias novas de captura (**Tapeçaria** e **Estofado**, DF inteiro); e adaptar o dedupe para identidade multi-categoria.

## 1. UI unificada

- **Some o toggle de categoria.** `/api/leads` deixa de filtrar por `source` — um payload com todos os leads.
- **Fonte única = Supabase, local e produção:** o `/api/leads` local passa a ler do Supabase (mesmo caminho de `api/leads.js`), eliminando a divergência arquivo-local × banco (enriquecimento, `types` e status visíveis em todo ambiente). Arquivos `data/*.json` viram apenas artefato de captura/export.
- **Nova coluna Tipo** na tabela (badge colorido; um lead pode exibir mais de um badge quando tiver vários tipos).
- Filtro de Tipo global no topbar (substitui os botões de categoria: segmented control `Todos · Advogados · Arquitetura · Tapeçaria · Estofado`, id `typeSwitch`). Ele muda o parâmetro `?type=` do `/api/leads`, então **afeta tudo**: tabela, KPIs, mapa, gráficos e fila "Contatar hoje" (recálculo no servidor). Os demais filtros da tabela permanecem locais como hoje.
- **Card de captura** ganha seu próprio `select` de categoria (Advogados · Arquitetura · Tapeçaria · Estofado, `#capCat`) — define qual script roda, independente do filtro de visualização.
- Formato da tabela, chips, busca, status, fila, dashboard e a11y permanecem como estão (rodada 2026-10-09).
- Labels/Tipo vêm de `types` (ver §3); cores por tipo definidas em CSS (Advogado=azul, Arquitetura=ciano, Tapeçaria=rosa, Estofado=verde).

## 2. Categorias novas (pipeline)

- **Tags no banco (sem acento, seguro em URL):** `tapestaria`, `estofado`. Labels de UI: "Tapeçaria", "Estofado".
- **Scripts** no padrão existente (`scripts/capture-tapestaria.js`, `scripts/capture-estofado.js`) com lista de queries priorizada:
  1. **Tier alto poder aquisitivo:** Lago Sul, Lago Norte, Asa Sul, Asa Norte, Plano Piloto, Águas Claras, Cruzeiro, Park Way, Jardim Botânico.
  2. **Demais RAs do DF** (todas as registradas): Guará, Sobradinho, Sobradinho II, Paranoá, Núcleo Bandeirante, Santa Maria, Samambaia, Taguatinga, Ceilândia, Gama, Brazlândia, Itapoã, Estrutural, Sol Nascente/Tororó.
  - Formato de query: `tapeçaria <RA> Brasília DF` / `estofado <RA> Brasília DF` (termo principal × RA, na ordem de prioridade). "Cortinas"/"persianas" entram só no classificador (sem captura dedicada — YAGNI).
  - Volume estimado ≈ 25-30 RAs × 1 termo × 2 categorias — rodada local longa, resumível.
- **Classificador** (`src/utils/classify.js`): palavras-chave novas — tapeçaria: tapeçaria, tapeçarias, cortina(s), persiana(s), decoração têxtil; estofado: estofado(s), sofá(s), sofa(s), reforma de sofá, impermeabilizadora de estofado. Camada de origem (0.7) já lê `origin || source`.
- **Score de contatabilidade:** genérico (canais/fechado/senioridade) — sem mudança.
- **syncLeads:** tag derivada do argumento `category` (hoje binário advogados/arquitetura) vira mapa de tags: `advogados|arquitetura|tapestaria|estofado`.

## 3. Dedupe multi-categoria (4 pontos aprovados)

1. **Identidade por `place_id`:** `id` = `place_id` do Maps (estável para o mesmo lugar físico) quando existir; fallback `sha1(norm(name)|norm(address))` como hoje. Mata linhas quase-duplicadas entre capturas de categorias diferentes (problema B).
2. **Multi-tipo (`types`):** coluna nova `types` (texto, tags separadas por vírgula, ex.: `"tapestaria,estofado"`). No sync, linha existente recebe **união** (tipos já gravados ∪ tag da captura atual). `source` permanece como "última captura" (proveniência). UI de Tipo lê `types` (com fallback para `source` quando `types` for nulo — leads antigos até o backfill).
3. **Upsert não-degradante:** linha **nova** → insert completo (POST merge-duplicates). Linha **existente** → PATCH com apenas os campos não-vazios da captura + união de `types` — nunca sobrescrever phone/website/rating/instagram/facebook/enriquecimento com null. (Hoje o upsert envia todos os campos e degrada.)
4. **Backfill (migration 0005 + passo em `repair`):**
   - `types` inicial: `source` de cada linha existente.
   - Reescrever `id ← place_id` quando `place_id` não-nulo e diferente do id atual; em colisão (duas linhas viram o mesmo place_id) manter a mais rica (mesmo critério `richer()` do sync) e **unir** `types`; a linha descartada some.
   - Linhas sem place_id mantêm o id sha1.
   - A migration roda no **SQL Editor** (regra do projeto — não via PostgREST).

## 4. Riscos e limitações aceitos

- Negócio com nome/endereço alterados E sem place_id ainda pode gerar duplicata (residual pequeno; place_id cobre o grosso).
- Capturas das categorias novas só passam a valer depois do deploy + migration 0005 aplicada.
- Integração Git da Vercel está parada: deploy por `vercel deploy --prod` (CLI).
- Volume novo de leads × free tier do Supabase: monitorar antes da rodada max-DF.

## 5. Testes

- Unit (TDD): `leadId` com place_id; união de types no sync; PATCH parcial não-degrada; backfill SQL (fixture); classificador tapeçaria/estofado; filtro de Tipo na métrica (buildStats/buildTop com types).
- UI (Playwright): toggle ausente; coluna Tipo; filtro Tipo reduz tabela+KPIs+fila; lead com 2 tipos mostra 2 badges.
- Smoke real: captura quick de 1 query por categoria nova + sync + conferência no banco.
