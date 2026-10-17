# Capture V2 — Relevância antecipada, multi-termo e budget proporcional

Data: 2026-10-18 · Status: aprovado (função a — cobertura máxima) · Pilot: topografia

## Contexto

Auditoria da rodada topografia full-DF (39 queries):

| Métrica | Valor | Diagnóstico |
| --- | --- | --- |
| Cards brutos | 306 | — |
| Válidos (isLead) | 92 (30%) | dedupe + artefatos de paginação |
| Relevantes (NICHE_ROOTS) | 56 (18% do bruto) | ruído descontado só pós-captura |
| RAs no teto de 120 cards | 15/31 | Google "relaxa" a pesquisa p/ nicho escasso → lixo |
| Budget de detail gasto em ruído | ~60% | MAX_DETAILS=70 visita cards irrelevantes |
| Queries sem retorno | 8/39 (ex. `Brasília Brasília DF`) | termo duplicado confunde o Maps |

Objetivo aprovado: **cobertura máxima de leads relevantes por nicho**, captura full-DF até ~1h, proporcional ao nº de RAs (RA específico proporcionalmente mais rápido). Agendamento externo fica como hook para fase futura (não implementado agora).

## Decisões

1. **Relevância entra no scraper, não no sync.** A lista de cards é avaliada em memória com as raízes do nicho (`NICHE_ROOTS`, fonte única em `src/utils/categories.js`). Só relevantes/ambiguos recebem detail; descartados vão para telemetria, não para o JSON.
2. **Multi-termo adaptativo por nicho.** `CATEGORIES[cat].terms = ['topografia', 'topógrafo', 'levantamento topográfico', 'georreferenciamento']`. Roda termo 1 em todas as RAs; termo 2 só nas RAs onde o termo 1 rendeu < N relevantes (N por categoria, default 3). Não multiplica 39→156 queries sem critério.
3. **Budget proporcional.** `--budget` em minutos (default: `2 + 1.2 × nºDeQueries`, cap 60). A fila de queries é ordenada por yield histórico e corta a cauda quando o tempo acaba. Query única de RA (~4 min) — nada de 1h fixa.
4. **Recaptura incremental.** Antes do detail, consulta `place_id` já presentes na base com `updated_at` < 30 dias: skip (mantém campos já enriquecidos), só entra na fila quem é novo/carecente.
5. **Fix de queries:** RA "Brasília" (alias do DF inteiro) não duplica termo na query (`topografia Brasília DF`); RAs gigantes geográficos (Brasília/Asas) herdam as sub-buscas existentes.

## Componentes (arquivos e função)

| Arquivo | Mudança |
| --- | --- |
| `src/utils/categories.js` | `terms` por categoria; export `relevanceScore(row, cat)` (0/negativo = descarta; borderline = "ambiguo" guarda no JSON com flag) |
| `scripts/queries-<tag>.js` (via `buildQueries`) | gera fila: [[term, RA]] com fix do alias Brasília + dedupe de queries idênticas |
| `scripts/mapsScraper.js` | fase `collectCards()` separada de `visitDetails(queue)`: cards -> `relevanceScore` -> fila de detail ordenada por score; telemetria por query |
| `scripts/capture-<tag>.js` (base em capture-runner compartilhado) | recebe `--budget`; consome histórico de `captures.qs` p/ ordenar fila; grava telemetria |
| `scripts/sync-supabase.js` | mantém relevância como rede de segurança (idempotente); skip de place_id fresco na recaptura |
| `src/utils/leads-io.js` | JSON v2 inclui `rejected` (amostra, p/ auditoria) e `telemetry` por query |
| Supabase `captures` (colunas novas) | `qs` (jsonb: [{query, cards, relevant, dropped, details}]), `budget_min`, `ra_count` — migration 0009 |

## Fluxo de dados (por query)

```text
(term, RA) → Maps list page → collectCards (scroll ≤ MAX_SCROLLS)
  → inMemory: dedupe place_id (na query + na base ≤30d) → relevanceScore
     ├─ >0  → fila de detail (ordenada, respeita MAX_DETAILS e remaining budget)
     ├─ =0 e ambiguo → detail só se sobrar orçamento
     └─ <0  → descartado (telemetria)
→ detail visits (fone/site/sociais/hours) → merge no JSON
→ telemetry {cards, relevant, dropped, details} por query → captures.qs
→ sync (dedupe + relevância de segurança + orphan cleanup) → build-web-data
```

## Erros e edge cases

- **Rate limit/página faltosa**: jitter entre queries (8–15s), retry 1× por query; falha persiste na telemetria e não para a rodada.
- **Nicho novo sem histórico**: fila ordena por ordem natural de RA (sem yield prévio); telemetria acumula p/ próxima rodada.
- **Budget estourado no meio de query**: termina a query atual (não descarta trabalho), corta as seguintes; status `.partial`.
- **place_id sem detail novo: card barato coletado**: card sem detail mantém campos do card (nome/categoria) e é marcado `details: false` — não vira fantasma.
- **Ambiguos apodrecendo no JSON**: flag `ambiguo: true` fica visível na tabela (Tipo/categoria), usuário decide.

## Testes

- Unit: `buildQueries` (alias Brasília, dedupe, fila multi-termo), `relevanceScore` (dos casos reais da auditoria: Santa Mônica, Jardim Botânico, 2GEO, Garcia Topografia), planner de budget/ordenação por yield.
- Série curta real: pilot no nicho topografia, 1 RA (Águas Claras) → valida cards/relevantes/detail skip.
- Full-DF 1h (após aprovação): compara telemetria vs auditoria (meta: ≥2× relevantes com mesmos 60 min).

## Fora do escopo (fase futura)

- Scheduler/cloud worker chamando `/api/capture` (hook: formato de job já faz spawn; nada muda no contrato).
- Google Places API paga.
- Enriquecimento IG/WhatsApp (aliases `enrich:*` já existem e seguem intactos).
