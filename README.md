# Together — AI Journey Partner

**Don't show recommendations. Reveal adventures.** Together turns two people's different reactions to a shared cultural moment into one grounded thing worth doing together. AI adds a chapter to an existing friendship, family relationship, or partnership; it does not replace it.

- Public demo: https://together-journey-qloo.crypto5555111.chatgpt.site/
- Public source: https://github.com/noboru59631/together-journey

## Product flow

1. Name a shared film, meal, concert, book, place, show, or podcast.
2. Each person writes what stayed with them, including likes, dislikes, and emotional context.
3. The Conversation Engine extracts a strict, typed taste-signal object.
4. Every proposed cultural entity is searched in Qloo. Only an exact normalized name, expected type, and real Qloo ID can become a signal.
5. Qloo Insights expands the verified inputs into places, books, and destinations.
6. Together removes previously proposed or experienced IDs, applies a practicality preference, and reveals exactly one adventure.
7. “Why this adventure?” separates the LLM interpretation, verified Qloo input entities, Qloo's cross-domain result, and Together's own selection/copy.
8. Afterward, a reaction and optional reflection are saved to the browser's anonymous D1-backed Journey.

The first screen leads directly into this flow. It is not a dashboard, ranking, matching service, or recommendation list.

## Architecture

## Relationship Memory — Together learns how two people experience the world together.

Every successful **LIVE grounded reveal** now creates a chapter automatically. A reveal is a recommendation, not proof that you visited. Each chapter remembers a random anonymous pair/session ID, timestamp, both original reflections, Qloo-resolved IDs/names/types, per-person interpreted tags and dislikes, the grounded recommendation, rationale, result state, and optional feedback/reflection. DEMO, FALLBACK and NEEDS_INPUT never create learned chapters. The first run has no invented history.

Three small surfaces keep the existing Together design:

- **Our Journey**: recent grounded reveals, remembered reflections, optional feedback, and Reset our journey.
- **Our Taste**: Shared, Different and Unexplored, with chapter counts showing accumulated evidence.
- **What should we try next?**: the existing conversation/reveal flow, with an explicit explanation of how earlier signals guided discovery.

OpenAI interprets the current reflections into short reusable tags using the same Responses API and strict Structured Outputs. `lib/relationship-memory.ts` updates the profile deterministically: normalize/deduplicate tags per person and chapter; Shared requires the same tag from both people's grounded reflections, including across different chapters; its evidence count is the union of supporting chapter IDs; Different preserves each person's other emphasis; counts are distinct supporting chapters, not compatibility percentages. Unexplored is a fixed list of supported cultural domains absent from grounded inputs or positively confirmed recommendations. It describes opportunities, not inferred likes or verified venues. Different signals are not treated as disagreement. The JSON reaction edges retain Person → Entity → Tags; the derived buckets retain Pair → Signals with chapter IDs for audit.

Before the next extraction, the server loads memory from D1 and supplies a bounded summary of shared/different signals, unexplored domains, dislikes, previous recommendations and feedback. Historical tags are context, never evidence for invented current reactions. Qloo Insights receives current verified IDs plus up to six previously grounded input IDs, excluding chapters marked Not for us. Together excludes every retained prior recommendation and current input ID, prefers an unexplored domain within practical candidates, and deprioritizes rejected categories. Only a real Qloo candidate can be revealed. A deterministic memory explanation appears above the reveal and in its audit trace. Qloo provides grounding and cross-domain candidates; **Together implements relationship memory locally**.

Optional feedback is **This feels like us** (`liked`), **Interesting, but unexpected** (`neutral`), or **Not for us** (`not_for_us`). Liked confirms the recommendation domain as explored; neutral records uncertainty without inventing positive tags; Not for us stops that chapter's inputs from being reused as positive historical Qloo signals and deprioritizes its recommendation category. Input reflections remain evidence of the person's actual interests even when the generated recommendation was rejected. Feedback replaces the previous choice; it never increments evidence counts by itself.

### Storage, privacy and reset

The existing platform-native **Cloudflare D1 `DB` binding** stores `pair_sessions` and `pair_memories`. There is no external database, additional secret or Supabase setup. Migration `drizzle/0001_dizzy_iron_lad.sql` adds tables without altering existing data; Sites applies pending migrations during deployment. Only the newest 100 chapters per pair are retained and used for the profile. The timeline shows the newest eight. Evidence counts describe this retained window.

Memory survives reloads and server restarts in production. Pair access uses the existing random HttpOnly, SameSite=Lax cookie, Secure in production, renewed for 90 days. Both people use the same browser/session; changing partner names does not create a new pair. Reset before using Together with someone else. No login recovery or cross-device linking is included. Cookie expiry does not automatically delete server records; reset is the deletion mechanism. No secrets are stored in chapters. Original reflections are sent to OpenAI (`store: false`); the memory summary is also sent on repeat use. Qloo Search receives candidate names and types; Insights receives grounded IDs and an optional city.

**Reset our journey** confirms deletion, removes this pair's V2 chapters and legacy experiences/connections in one D1 batch, revokes the old session, and rotates its cookie. Revocation blocks in-flight V2 saves from recreating deleted chapters. The revoked random session ID and timestamps remain as a deletion tombstone; all taste/reflection payloads are removed. Data is scoped by the server cookie, never a client-provided pair ID. Memory responses are not cached. A failed write explicitly shows that the LIVE reveal was not saved; a failed read produces honest FALLBACK. Storage outages do not create an in-memory substitute presented as durable history. Missing OpenAI credentials still produce the existing DEMO with no learning.

For local/demo use, existing DEMO works with no secrets. To test durable memory locally, first build, then apply the schema to the **local** D1 binding (never use `--remote`):

```bash
npm run build
npx wrangler d1 migrations apply DB --local --config wrangler.local.json --persist-to .wrangler/state
npm start
```

Use the existing environment variables only: `OPENAI_API_KEY`, `OPENAI_MODEL`, `QLOO_API_KEY`, `QLOO_API_BASE_URL`. Enter their values in ignored local configuration or the Site's secret settings; never in chat. The table schema and Drizzle journal are tracked; production keys and user memory are not.

### V2 verification

`npm test` exercises no-history behavior, successful automatic memory, no learning for NEEDS_INPUT/DEMO/FALLBACK, second-run prior extraction context and Qloo signals, profile evolution, duplicate entities, feedback influence, pair isolation, deletion and in-flight-save revocation. The storage tests execute the actual migrations and SQL against SQLite, not a simulated map. Route tests use synthetic provider fixtures and do not claim live Qloo results.

The repeat-use fixture starts with Princess Mononoke / Joe Hisaishi, then extends to Norwegian Wood / Blue Bottle Coffee. The second run includes earlier nature/music reactions in its context, filters the first recommendation, adds literary/café signals to Our Taste, and references prior differences in its explanation. Run `npm test`, `npm run lint`, `npm run typecheck`, and `npm run build` before deployment.

### Conversation Engine

The server calls the OpenAI Responses API with Structured Outputs and a strict JSON Schema. The result includes:

- experience title and category;
- two participant records with likes, dislikes, emotional context, and concrete cultural entity candidates;
- confidence and explicit/inferred provenance for every entity;
- a concise Shared Spark; and
- an explicit location hint or `none`.

Application-side Zod validation still checks bounds, participant IDs, and required fields. Calls time out after nine seconds. A retry is allowed once for timeout, 429, 5xx, empty output, invalid JSON, or schema failure; non-retryable authorization failures stop immediately. User text is passed as data, and the system instruction forbids recommendations and invented cultural relationships.

The default model is `gpt-4o-mini`, configurable through `OPENAI_MODEL`. Structured Outputs are used instead of JSON mode, following the [official OpenAI Structured Outputs guide](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).

### Qloo Taste Engine

The LLM does not create Qloo IDs and cannot make a candidate LIVE. Each entity with confidence at least `0.65` is sent to Qloo `/search` with its expected type. Together accepts only an exact normalized name match, the expected Qloo type, and a non-empty returned ID. Low-confidence, mismatched, unresolved, and duplicate entities are shown as unused.

At least two distinct entities, covering both people, must resolve before `/v2/insights` runs. This removes the former fixed *Lost in Translation* → Phoenix bridge. Any inferred relationship stays tentative; only the independently resolved Qloo entity is used.

The verified IDs are passed to concurrent Insights requests for `place`, `book`, and `destination`, with explainability enabled. An explicit city is applied only to the place request. Without a location, a book is preferred over a potentially impractical distant place; with a location, a nearby place is preferred. Every LIVE reveal is a real Qloo result. Together never asks the LLM to invent a venue, book, or destination.

Qloo is indispensable: it verifies the cultural entities and supplies every LIVE cross-domain candidate. Without Qloo, Together can interpret a conversation but cannot produce a LIVE adventure. See the [Qloo Search reference](https://github.com/qloo/docs-public/blob/main/reference/get-search.md) and [Insights API guide](https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md).

### Journey Engine

D1 stores saved experiences under a random, browser-specific, HttpOnly journey cookie. Before each reveal, the server excludes all previously proposed or experienced Qloo IDs. Saved records include the selected Qloo ID, dynamic source experience, partner label, verified cultural signals, emotional signals, reaction, and optional reflection. Storage failure preserves the current UI and shows a retryable error.

## Modes

| Mode | Meaning |
| --- | --- |
| **LIVE** | LLM extraction passed strict validation, both people contributed Qloo-verified entities, Qloo Insights returned a usable new candidate, and D1 novelty filtering succeeded. |
| **NEEDS_INPUT** | The LLM ran, but fewer than two distinct cross-person entities could be verified. Insights is not called. The UI asks for one more concrete cultural clue. |
| **DEMO** | `OPENAI_API_KEY` is absent. A prepared activity is shown and the product explicitly says free-form understanding is not active. |
| **FALLBACK** | A configured LLM, Qloo, or Journey dependency failed. A prepared activity is clearly labeled and no LIVE recommendation is claimed. |

HTTP 401/403, 429, 5xx, timeouts, malformed structured output, weak confidence, entity mismatch, empty results, duplicate-only results, and D1 failures are handled without exposing credentials or raw provider errors.

## Local setup

Requires Node.js 22.13 or newer.

```bash
npm ci
npm run dev
```

Copy `.env.example` to an ignored `.env.local` and set values only there. Never commit, log, screenshot, or paste secrets into chat.

| Variable | Purpose |
| --- | --- |
| `QLOO_API_KEY` | Required for Qloo Search and Insights. |
| `QLOO_API_BASE_URL` | Optional; defaults to the Qloo hackathon host. |
| `OPENAI_API_KEY` | Required for LIVE free-form Conversation Engine extraction. |
| `OPENAI_MODEL` | Optional; defaults to `gpt-4o-mini`. |

For the hosted Site, open **Together — AI Journey Partner → Settings → Environment variables**, add `OPENAI_API_KEY` as a **secret**, optionally add `OPENAI_MODEL` as a normal variable, and redeploy. Enter the key directly in Sites; do not send it in chat. `QLOO_API_KEY` is already expected as a Site secret. The Site manifest contains only the logical D1 binding and project ID.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

The tests execute the real route handlers with isolated synthetic OpenAI, Qloo, and D1 dependencies. They cover two unrelated free-form conversation shapes, strict-output retry, wrong-entity rejection, low confidence, unresolved signals, duplicate history, 401/403/429/5xx, timeouts, LIVE/DEMO/FALLBACK/NEEDS_INPUT behavior, malformed input, and Journey save failure. Synthetic tests do not prove provider connectivity or recommendation quality.

LIVE release acceptance requires two previously unregistered conversations to complete this exact path in production: LLM extraction → two or more verified Qloo entities → three Insights categories → one reveal → explanation → return reflection → D1 row. Reviewers must judge both surprise and real-world feasibility; HTTP 200 alone is not a pass.

## 60-second demo story

> Together begins with something two people already shared. I enter *Princess Mononoke*: I remember the ancient forest and want somewhere quiet; Mika remembers Joe Hisaishi's music and wants wonder without crowds. The Conversation Engine structures those differences, but it cannot declare cultural facts. Qloo Search verifies the actual movie and artist IDs. Qloo Insights then crosses domains and returns real places, books, and destinations. Together removes anything already in our Journey, favors what we can realistically do near Tokyo, and reveals one adventure—not a list. In “Why this adventure?” you can see the LLM context, Qloo-verified inputs, Qloo's result, and Together's selection rule separately. We go, come back, and save what happened. That memory changes what can be revealed next. AI did not replace our relationship; it gave us one more story to share.

## Devpost checklist

- [x] Create the public `noboru59631/together-journey` repository and confirm it is publicly visible.
- [x] Include an OSI-compatible license (`MIT`).
- [x] Document architecture, provider responsibilities, failure modes, privacy, and Qloo's indispensable role.
- [x] Keep secrets out of source, history, screenshots, logs, and submission text.
- [x] Configure `OPENAI_API_KEY` as a production Site secret and redeploy with environment revision 3.
- [x] Add OpenAI API credits, then complete two production LLM LIVE runs and both guardrail runs.
- [x] Keep the externally hosted Site public and accessible without sign-in.
- [x] Add the public repository URL to `DEVPOST.md` and verify it resolves.
- [x] Run GitHub Actions CI for tests, lint, typecheck, and build.
- [ ] Copy the final text from `DEVPOST.md`, add screenshots if useful, and verify the technology list.
- [ ] Optionally capture the 60-second demo story; the 2026 Agentic Hackathon does not require a video.
- [x] Verify the public Site is accessible without sign-in immediately before submission preparation.
- [ ] Submit on Devpost manually; this repository does not automate or finalize submission.

## Privacy and limits

### V2: How we like to explore

Together learns not only what two people like, but how they like to experience the world together.

Our Taste includes a small **How we like to explore** section. First use says **Still learning**; it never fabricates a practical profile. After a saved LIVE recommendation, three contextual dimension controls rotate across quiet/lively, uncrowded/busy, indoor/outdoor, budget-conscious/premium, spontaneous/planned, and relaxed/active. Each has two choices; **Other preferences** reveals the remaining controls. A tiny optional note accepts requests such as “We liked it, but it was too crowded. More quiet places next time.” These are requests for future experiences, not proof that the recommendation was visited.

Qloo grounds candidates → Together enriches verified practical metadata → deterministic reranking → recommendation. Search exact-match grounding and the confidence gate precede Qloo Insights; existing novelty/history ordering remains the baseline. Practical enrichment runs only on that grounded set and never filters or generates candidates. OpenAI Responses with strict Structured Outputs interprets explicit free-text requests only; it does not decide persisted scores or candidate traits.

Each dimension's score is `2 * sum(direction * weight) / sum(weight)`, within -2..+2. Chips weigh 2, interpreted note signals weigh 1. One explicit signal can affect the next run. Opposing observations blend; labels appear only at weight >= 1 and absolute score >= 0.5. Equal opposing evidence returns to Still learning. One signal per chapter/dimension/source is upserted, so retries do not inflate evidence. Changing a note replaces that chapter's prior free-text signals. Chips preserve the note and its other evidence.

Candidate scoring uses normalized price/crowd metadata and conservative non-conflicting Qloo description phrases for quietness, setting, planning and pace. Each contributor is `pair score * candidate direction / 2 * confidence`; existing description dimensions retain weight 1. Ties retain baseline ordering. Names, guessed venue types, extraction tags, popularity, affinity and user requests never become price/crowd attributes. Similar-venue feedback inference remains deferred. The trace exposes original indices, Qloo IDs, numeric contributions and evidence. Adaptation copy appears only when the selected recommendation itself changes and has positive supported contributors, not merely when lower-ranked candidates swap.

### V2: Practical candidate metadata

Practical metadata is not for generating candidates. It is for choosing the best grounded candidate for this pair.

The existing Qloo provider supplies the only enrichment source. A single bounded server-side [`/entities?entity_ids=...` lookup](https://github.com/qloo/docs-public/blob/main/reference/get-entities.md) refreshes uncached place IDs; only exact ID matches with `urn:entity:place` are accepted. Fresh Insights fields remain usable when lookup fails. No consumer-page scraping, additional API key, model opinion, name-based joins or booking integration is introduced.

| Dimension | Supported evidence | Normalization and limitations |
| --- | --- | --- |
| Price | Qloo numeric integer `properties.price_level` 1–4 | 1 = budget, 2 = mid-range, 3–4 = premium. Missing, strings and invalid values = unknown. These are relative restaurant cost bands, not current menu quotes, currency or hotel nightly rates. |
| Crowd | Explicit, non-negated and non-conflicting Qloo description phrases: uncrowded / less crowded; crowded / busy / bustling | quieter / busy, **heuristic**, confidence 0.35. General quietness is not occupancy. Popularity is not occupancy. No verified live busy-hours source is currently available; moderate and verified crowd remain unknown with this provider. |

Each entity has independent `price` and `crowd` evidence records: value, `evidence_source` (provider URL without credentials), `source_type`, `evidence_type` (`verified`, `heuristic`, `unknown`), `evidence_confidence`, exact supported field/phrase, `fetched_at` and `expires_at`. Verified means a structured provider field, not independently checked current prices. Description evidence is never upgraded to verified crowd data. Confidence 0.35 is a conservative scoring weight, not a calibrated probability.

Only a learned preference AND fresh supported evidence permit a score. Unknown, expired and future-dated evidence contribute zero and remain hidden. Price prose (including affordable/luxury) contributes nothing. The current learned budget dimension is binary budget-conscious / premium-is-okay: mid-range is a supported factual chip but contributes zero, because the pair has no explicit mid-range preference model. Together does not claim a mid-range preference it never learned. Crowd hints are downweighted, labeled in rationale and shown as `Crowd hint: quieter/busy (description)`, never as verified crowd chips. Supported price chips are Budget / Mid-range / Premium; source links and hover details expose provenance. Chips expire in the open recommendation card.

Additive migration `0003_thankful_odin.sql` creates shared D1 `candidate_practical_metadata`, keyed by grounded entity ID, separate from pair memory. Structured prices expire after 24 hours, description crowd hints after 6 hours, unavailable values after 15 minutes. A failed lookup uses a 60-second TTL for unknown fields to avoid immediate repeated calls. Cache reads validate the payload and both field deadlines; a stale row is refreshed from the new provider response and fresh Insights snapshot, never reused as fallback. Unknown crowd can trigger refresh before a price's 24-hour maximum. Sequential discoveries share the cache across pairs/redeploys; simultaneous cache misses may duplicate a lookup. Reset revokes and clears pair preferences/history without deleting this shared provider cache. No conversation, pair identifier or secret is written to this cache.

Enrichment timeout, bad response, provider failure or cache failure preserve the full grounded set and LIVE status when core discovery works. Existing supported quiet/setting/planning/pace logic remains available; price/crowd never fall back to unlabeled guesses. The trace separately reports attempted place count, cache hits, refreshes, cache failures, provider status and each candidate's evidence, allowing enrichment absence to be distinguished from core LIVE success.

Additive migration `0002_crazy_fenris.sql` creates `practical_evidence` under the existing D1 `DB` binding. Rows store pair ID, chapter ID, grounded recommendation ID, dimension, direction, source, weight and timestamp. The profile and evidence count are derived deterministically on read, separately from cultural taste memory. No new secrets are needed. Evidence survives journey retention pruning and persists until reset; cookie expiry does not delete server records.

Optional notes remain in the existing D1 chapter reflection field and are sent to OpenAI server-side with `store: false`; structured signals are stored in the practical table. Do not enter sensitive information. Reset our journey deletes both practical evidence and existing journey/taste memory, revokes the pair session and rotates the cookie. Preference writes check ownership, LIVE chapter state and session revocation, and feedback plus signals update in one D1 transaction. DEMO, FALLBACK and NEEDS_INPUT cannot produce preference evidence. Interpretation failure leaves the prior feedback unchanged and offers retry/chip feedback.

Conversation text is sent server-side to the configured LLM provider for extraction. Only verified Qloo entity IDs are sent to Qloo Insights. API keys remain server-side. Saved reactions and optional reflections remain in D1 for the anonymous browser Journey cookie, which is HttpOnly, Secure in production, SameSite Lax, and expires after 90 days.

Do not enter sensitive personal information. Reset our journey deletes the anonymous pair's stored taste history (see the V2 storage section). The MVP has no account recovery, cross-device sharing, moderation, or production-grade rate limiting. It intentionally has no stranger matching, social feed, taste score, leaderboard, or multi-result recommendation grid.
