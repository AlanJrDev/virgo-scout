# Design: Qualificação multifonte de leads (site + sistema)

Data: 2026-10-16 · Status: aprovado pelo usuário · Projeto: virgo-scout

## Objetivo

Captar e priorizar leads **provavelmente compradores** dos produtos da Virgo Tech (**site/LP** e **sistema/automação**), em vez de apenas leads *contatáveis*. O sistema passa a produzir, por lead, um **`fit`** (0–100) com **motivos explícitos** e **gatilho de timing**, sobre **múltiplas fontes públicas gratuitas**, com um **loop de feedback** que calibra os pesos com o tempo.

## 1. Diagnóstico

- O `scoreOf` atual (`src/utils/metrics.js:109`) mede **contatabilidade** (tem canal) + **oportunidade** (sem site) e usa `rating×6` e `log10(reviews)×4` como únicos proxies de porte. Não mede **capacidade de compra** nem **intenção**.
- Consequência: o Tier A ("sem site + celular") mistura o negócio forte (que compra) com o profissional solo sem verba (que não compra). Priorizamos *quem dá para ligar*, não *quem tende a comprar*.
- Não há sinal de **marketing ativo** — o melhor preditor de demanda por presença digital.
- Não há registro de resultado (contato → resposta → venda), logo não há como aprender o ICP real.

## 2. Princípio: dois números por lead

- **`reach`** (0–15): facilidade de falar com o decisor (canal validado — reutiliza a auditoria de WhatsApp `scripts/audit-wa.js`). **É exatamente a dimensão "Acesso" do §3, exposta isolada** para ordenação/filtro operacional (não é um sinal à parte).
- **`fit`** (0–100): probabilidade de compra, por ICP (`site` | `sistema`), com **`reasons[]`** (evidências legíveis) e **`why_now`** (gatilho de timing). Inclui `reach` como uma das dimensões.

O `scoreOf`/`badgeOf` atuais saem de cena como métrica de priorização; `reach` preserva a noção de contatabilidade (hoje embutida no score).

## 3. Modelo de qualificação

`fit` = soma de 4 dimensões (pesos em `src/qualify/weights.js`, versionados):

| Dimensão | Faixa | Sinais (evidência) |
|---|---|---|
| **Oportunidade** (need) | 0–30 | sem site (+15) · site ruim/desatualizado (+10–15) · sem site mas IG ativo (+10) |
| **Capacidade** (pode pagar) | 0–30 | anúncio ativo (Ads CT) (+15) · reviews em escala (log) · claimed (+5) · desde ≥2 anos · multi-endereço |
| **Intenção** (quer crescer) | 0–25 | Ads ativo (+15) · IG com cadência recente (+10) · claimed (+5) · promoções |
| **Acesso** (alcança decisor) | 0–15 | zap declarado **validado** (+10) · celular (+5) · email/IG (+3) |

**Classificação de ICP:**
- **site**: sem site ou site ruim + porte pequeno/médio + alcançável.
- **sistema**: já tem site + sinais de escala/processo manual (multi-unidade, "orçamento/agendamento por WhatsApp" na copy, volume alto de reviews).
- `icp` pode conter os dois.

**Desqualificadores** (`fit` baixo/0): `closed`; rede corporativa sem decisor local (para ICP-site). `reach=0` não zera `fit`, mas zera a prioridade operacional.

**Saída do motor** (`qualify(lead)`): `{ reach, fit, icp, reasons[], why_now }`. Puro e testável.

## 4. Fontes novas (grátis/local)

- **Auditoria de site** (`src/enrich/site-audit.js`) — estende `site-analyzer`: SSL, viewport mobile, plataforma (Wix/WordPress/builder), ano do copyright, formulário/agendamento, peso. Detecta **"precisa de site novo"** e **"precisa de sistema"**.
- **Google Ads Transparency** (`src/enrich/ads.js`) — público: negócio **anunciando** = verba + intenção; anúncio apontando para site ausente/ruim = lead quente. Melhor sinal de intenção disponível.
- **Instagram público** (`src/enrich/instagram.js`) — followers/posts/último post e ausência de site na bio → comprador ideal de site; cadência = porte.

Mescla na base unificada por `place_id`/telefone (padrão existente do sync).

## 5. Arquitetura e fluxo

```
Maps capture → sync → enrich (site/IG/ads/site-audit) → qualify(engine) → dashboard/queue → contato → outcome → (calibra pesos)
```

- **Enrichers**: resumíveis por coluna `*_checked_at`, **não-degradantes** (PATCH só com campos não-vazios), com delay; falha → `unknown` (nunca grava lixo).
- **Scoring no build** (puro, como hoje) a partir das colunas enriquecidas; `fit`/`icp`/`reach` também **persistidos** para filtro em `/api/leads?icp=&min_fit=`.
- **Feedback**: `outcome` (`novo → contatado → respondeu → reuniao → fechou | perdeu`) registrado na UI; vira base de calibração dos pesos.

## 6. Componentes e dados

**Módulos/scripts novos:**
- `src/qualify/engine.js` (+ `weights.js`) — motor puro.
- `src/enrich/site-audit.js`, `src/enrich/ads.js`, `src/enrich/instagram.js`.
- `scripts/enrich-audit.js`, `scripts/enrich-ads.js`, `scripts/enrich-ig.js` (padrão de `enrich-leads.js`).
- `src/utils/outcomes.js` — marcação de resultado.

**Migration 0007 (`0007_qualification.sql`)** — colunas novas em `leads`: `ads_active bool`, `ads_landing text`, `ads_checked_at timestamptz`, `ig_followers int`, `ig_posts int`, `ig_last_post date`, `ig_checked_at timestamptz`, `site_audit jsonb`, `fit int`, `icp text`, `reach int`, `fit_reasons text[]`, `why_now text`, `outcome text`, `outcome_at timestamptz`. Roda no **SQL Editor** (regra do projeto).

**UI:**
- Filtros por **ICP** e **min fit**; coluna **"Por que"** (chips de `reasons`).
- Fila "Contatar hoje" ordenada por `fit` (desempate: sem site).
- KPIs separados **site** / **sistema**.

## 7. Tratamento de erro e limites (honestidade)

- **IG anti-scraping** é frágil → degrada para `unknown`; nunca bloqueia a qualificação.
- **Ads Transparency** usa endpoint interno (frágil) com fallback Playwright; smoke valida cada caminho.
- **Sem dado de conversão**: pesos iniciais = *priors* de especialista + poucos casos anedóticos; o loop de feedback calibra.
- **Zero dependência npm nova**: `fetch`/Playwright apenas.
- Seletores do Maps/CT/IG giram (lição do projeto): todo extrator tem fallback e é isolado para não derrubar o enricher inteiro.

## 8. Testes

- **TDD no puro**: `qualify()` com leads-fixture → `icp/fit/reasons/why_now` esperados; extratores de `site-audit`, `ads` e `ig` contra fixtures de HTML/JSON salvos.
- **Smoke real limitado** por enricher (5–10 leads) → conferência no banco.
- `npm test` verde antes de cada commit.

## 9. Fases (base do plano de implementação)

- **F0** — motor `qualify` + integração em `metrics`/UI usando os dados atuais (ganho imediato, sem migration).
- **F1** — auditoria de site + coluna → alimenta o motor.
- **F2** — Google Ads Transparency → melhor sinal de intenção/verba.
- **F3** — Instagram público.
- **F4** — instrumentação de `outcome` (feedback).
- **F5** — reforma do dashboard (ICP, "Por que", fila por `fit`).

## 10. Fora de escopo (YAGNI)

- Fontes pagas / APIs comerciais de enriquecimento.
- Modelo de ML treinado (o feedback vira calibração de pesos, não ML, nesta rodada).
- Novas categorias de captura no Maps.
- Verificação dura de WhatsApp via sessão Baileys (permanece a limitação já documentada).
