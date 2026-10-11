# Together — AI Journey Partner

**Don't show recommendations. Reveal adventures.** Together turns two people's different reactions to a shared cultural moment into one grounded thing worth doing together. AI adds a chapter to an existing friendship, family relationship, or partnership; it does not replace it.

- Public demo: https://together-journey-qloo.crypto5555111.chatgpt.site/
- Public source: https://github.com/noboru59631/together-journey

## Together is a continuous discovery engine for two people.

Together helps two people discover what to watch, listen to, eat, visit, or experience next — based on how their shared taste evolves over time.

**Discovery subscription for two people** describes the feeling, not a billing product. The loop is **Experience → React → Learn → Discover → Experience Again**. There are no payments, notifications, followers, tokens or gamification.

The calm existing Journey now leads with **Next Discovery**: resume the latest saved suggestion, discover the next chapter, or **Surprise us**. A chapter created in the last seven days is labeled “This week’s discovery”; older chapters are labeled “Your latest discovery”. Nothing is scheduled or generated while the app is closed. Empty profiles lead to both people's first real reflections, not a fabricated recommendation. The server reuses earlier verified interests for repeat discovery without inventing new reflections or inflating taste-tag counts. New reflections continue through the existing strict OpenAI Responses extraction and Qloo exact-match Search pipeline.

**Our Taste → Unexplored** now lists only supported directions with matching prior Shared or Different tags, supporting chapter IDs, and a **Try this direction** action. These are plausible directions, not confirmed preferences or promises of candidate availability. A subcategory does not become a LIVE reveal until Qloo returns a matching place. Grounded input domains already present in the pair's interests are not called unexplored. Rejected chapters are not positive discovery evidence.

### Capability map

The map in `lib/discovery.ts` follows the [official Qloo Insights entity types](https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md). Account coverage can still produce no candidates; Together reports FALLBACK without recording a discovery.

| Direction enabled for discovery | Qloo grounding |
| --- | --- |
| Movies / TV | `urn:entity:movie` / `urn:entity:tv_show` |
| Music | `urn:entity:artist`; a listening invitation, not a fabricated concert |
| Books | `urn:entity:book` |
| Cafés / restaurants / food | `urn:entity:place` AND Qloo-verified café/restaurant taxonomy filter or primary-category evidence |
| Art / museums / culture | `urn:entity:place` AND Qloo-verified museum/gallery taxonomy filter or primary-category evidence |
| Outdoor / nature | `urn:entity:place` AND Qloo-verified park/garden taxonomy filter or primary-category evidence for nature, camping or fishing places |
| Local places | `urn:entity:place`; no event-date, opening-hours or ticket claims |
| Travel / destinations | `urn:entity:destination` |

Camping and fishing have no dedicated enabled Qloo domain. A metadata-backed campground/fishing place may appear within Outdoor; no itinerary, equipment, access or safety facts are invented. Live music can be discovered as an artist or a metadata-backed place, but scheduled performances are unverified. Games (`urn:entity:videogame`) are documented by Qloo and accepted as input signals, but stay hidden as an experimental output until live account coverage is checked. Local events are hidden as a separate output because venue grounding is not event verification. Candidate names alone do not establish place subcategories.

Place subdomains first search [Qloo `/v2/tags`](https://github.com/qloo/docs-public/blob/main/reference/get-tags.md) for matching classification tags. Only returned `urn:tag:category:place:*` or `urn:tag:genre:place:*` IDs with an exact recognized primary category can be used in `filter.tags`; keyword/affinity tags and unrelated taxonomy never become classification filters. No tag ID is fabricated. If the lookup is unavailable, Together requires a returned primary classification tag or a conservative opening description identifying the place itself (for example, “A quiet café…”). A church mentioning a café nearby, or a shopping building mentioning a rooftop garden, is insufficient. Category evidence is retained with the chapter. Missing primary support fails closed. Localized or unusual descriptions may be missed until their taxonomy is supported.

### Auditable domain and novelty scoring

Next Discovery chooses a domain **before** requesting Qloo candidates. Every eligible direction needs a matching tag from an earlier non-rejected LIVE chapter and at least two distinct grounded IDs representing both people. Direction cue mappings, source chapters and score contributors are visible in the response trace. Cues route discovery; they do not assert that a venue has those attributes. Qloo Insights then provides the actual cross-domain connection using verified entity IDs.

Domain score = `2 × min(shared matching tags, 3) + min(different matching tags, 3) + unexplored bonus − 2 × min(previous recommendations in domain, 5) − 4 × min(current same-domain streak, 3) + mean domain feedback + practical setting score`.

- Unexplored bonus: 3, or 5 for Surprise us; zero for already grounded input domains or previous recommendation domains.
- Domain feedback: Feels like us +1, Good surprise +2, Not for us −4, legacy neutral 0. Each chapter contributes its latest choice once.
- Outdoor setting score: the existing learned setting score (−2 to +2); other domain practicality stays neutral until candidate facts exist. Unknown crowd, price or travel distance never becomes a domain fact.
- Ties follow the declared capability-map order. Explicit Try this direction restricts discovery to that eligible domain. Automatic discovery tries at most the three highest-scoring directions; missing metadata, an empty result or a provider error never licenses an invented candidate.
- Previously suggested IDs, known/existing experience IDs and positive seed IDs are excluded. Normalized name aliases and near duplicates (at least three words each; token Jaccard similarity ≥0.8) are also excluded across domains.
- Fresh candidate score: `3 × existing evidence-based practical score + 2 novelty + 1/(original eligible Qloo index + 1)`. The final term retains a bounded familiarity/order preference. Novelty is rewarded only for grounded eligible candidates; practical evidence can change the winner for place/destination experiences. Movie, TV, music and book synopses do not supply practical venue facts (a quiet scene is not evidence of a quiet outing). Unknown evidence scores zero. Ties preserve Qloo order.

Every reveal explains **What we know about you two**, **Why this is new**, and **Why it still fits**. Explanations summarize observations and provider provenance, not hidden reasoning. Qloo supplies entities; Together supplies auditable domain/novelty decisions.

### Durable discovery loop

Chapter JSON adds optional `discovery`: domain, status (`suggested`, `tried`, `skipped`), source chapter IDs, three-part rationale and explicit location. Existing chapters remain readable; legacy categories map to supported domain history. Counts, last-seen timestamps and mean reactions are derived from unique LIVE chapters in D1, avoiding duplicate counter tables. Migration `0004_discovery_history.sql` adds an expression index without rewriting rows. Reset deletes all pair chapters and practical evidence, so cross-domain counts and timestamps also reset; shared practical metadata cache remains independent.

The browser generates one request UUID per deliberate discovery action. Retrying the same UUID returns the already saved chapter; duplicate concurrent writes resolve to that stored chapter. Feedback replaces rather than appends reactions. “We went” records tried explicitly; Not for us records skipped, without treating a suggestion as a visit. DEMO, NEEDS_INPUT, FALLBACK and failed saves never update discovery history. The retained history window is 100 chapters; novelty and counts are bounded to that window. There is no cross-device pair recovery yet.

`tests/discovery.test.mjs` covers empty profiles, supported evidence paths, novelty, repetition/streak penalties, unsupported domains, practical/feedback adaptation, a three-chapter **synthetic-provider** movie → café → outdoor flow, retry idempotency, real SQLite migration/roundtrip and reset. These tests are not live Qloo verification. Production verification results should be reported separately, with actual provider status and saved IDs.

## Product flow

1. Name a shared film, meal, concert, book, place, show, or podcast.
2. Each person writes what stayed with them, including likes, dislikes, and emotional context.
3. The Conversation Engine extracts a strict, typed taste-signal object.
4. Every proposed cultural entity is searched in Qloo. Only an exact normalized name, expected type, and real Qloo ID can become a signal.
5. On the first conversation, Qloo Insights expands verified inputs into places, books and destinations. On repeat Next Discovery, Together selects an evidence-backed domain first, then queries Qloo in that domain.
6. Together removes previously proposed or experienced IDs, applies evidence-backed practical and novelty scores, and reveals exactly one discovery.
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

OpenAI interprets current reflections into short reusable tags using Responses API strict Structured Outputs. `lib/relationship-memory.ts` normalizes and deduplicates tags per person and chapter. Shared requires the same tag from both people's grounded reflections, including across different chapters; its evidence count is the union of supporting chapter IDs. Different preserves each person's other emphasis. Counts are distinct supporting chapters, not compatibility percentages. Unexplored now uses the evidence-backed capability directions described above. Different signals are not treated as disagreement. JSON reaction edges retain Person → Entity → Tags, and derived buckets retain Pair → Signals with chapter IDs for audit.

Before a new reflection extraction, the server loads D1 memory and supplies a bounded summary of shared/different signals, unexplored domains, dislikes, previous recommendations and feedback. Historical tags are context, never evidence for invented current reactions. The conversation path uses current verified IDs plus up to six earlier grounded input IDs, excluding Not for us chapters; it excludes prior recommendations, applies practical evidence, and deprioritizes rejected categories. Next Discovery instead selects a domain from prior evidence before requesting candidates, using the scoring above. Only a real Qloo candidate can be revealed. Qloo provides grounding and cross-domain candidates; **Together implements relationship memory locally**.

Optional reactions are **Feels like us** (`liked`), **Good surprise** (`good_surprise`), and **Not for us** (`not_for_us`); earlier neutral records remain readable. Each LIVE suggestion counts as a discovery, separately from tried status. Not for us stops its chapter's inputs from being reused as positive historical Qloo signals and penalizes the recommendation domain. Input reflections remain actual-interest evidence in Shared/Different even when a recommendation was rejected. Feedback replaces the previous choice and never increments evidence counts by itself.

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

### Enduring preferences and recent context

**Together separates enduring preferences from one-off context.** Together learns what tends to stay true about two people — without overfitting to one day, one mood, or one experience.

Every interpreted post-experience aspect/dimension has `signalClass`: `stable_preference`, `contextual_reaction`, or `uncertain`. Strict Structured Outputs includes an exact `contextMarker` and a `futurePreference` flag. Deterministic guards require a supported topic and quotation, preserve the full supporting sentence, and permit direct stable evidence only when the quote contains explicit habitual wording such as usually/always/tend to/普段/いつも. The code verifies the model marker or extracts the exact habitual token itself, so a missing marker or uncertain model classification cannot hide an explicitly stated stable preference. Today/tonight/this time/tired/because or next-time requests override a stable suggestion. A single “I liked the music” stays uncertain. Negated habitual language cannot directly establish stability. Full clauses over 180 characters fail safely and can be retried with a shorter note.

The policy in `lib/preference-memory.ts` is separate from the existing raw weight-4 experience ledger and observational Shared/Different history:

| Evidence class | Long-term contribution | Direct stable eligibility |
| --- | ---: | --- |
| Explicit validated stable phrasing | 4 | Yes, for the submitting person |
| Uncertain unqualified preference | 2 | No |
| Contextual reaction or explicit next-time request | 1 | No |

For each person, kind and aspect/dimension: `signed = sum(direction * contribution)`, `cumulativeWeight = sum(contribution)`, `netWeight = abs(signed)`, `confidence = netWeight / (cumulativeWeight + 2)`. Confidence is an auditable evidence heuristic, not a calibrated probability. Stable requires **netWeight >= 4**, **confidence >= 0.5**, a nonzero direction, and either matching explicit stable evidence or matching evidence in **at least two distinct experienced chapters**. Thus two uncertain observations can promote; contextual-only observations require four agreeing chapters to reach weight 4. Duplicate submissions/chapters cannot inflate counts. Contradictory observations subtract signed support and add evidence mass; the stable label disappears immediately when any threshold fails. A new opposite label needs its own qualifying support. Editing replaces evidence and rebuilds the result.

Example for one dimension: contextual −1 → explicit stable −4 → contextual −1 → contradictory contextual +1 gives net support/confidence `1 / (1+2)`, `5 / (5+2)`, `6 / (6+2)`, `5 / (7+2)`. The label appears at step two, strengthens at step three and survives step four with reduced confidence. A quiet signal and a crowd signal are different dimensions: liking a busy outing does not automatically contradict quietness. No unsupported dimension mapping is performed.

**Long-term** contains qualifying person signals and a pair entry only when A and B independently qualify for the same dimension/aspect and direction. Pair confidence uses the weaker person's confidence. A submitting person saying “we” does not prove the absent person's agreement. **Recent context** contains non-stable signals from the latest three experienced chapters, including chapters with no review in that window; it expires **30 days after experience completion**, so editing an old review does not renew context. Chapter modifiers are newest `1`, next `0.5`, third `0.25`; an explicit next-time request doubles its modifier. Historical observations can still accumulate toward a recurring preference at their lower long-term weight; expiry removes temporary discovery effects, not review history.

Practical discovery uses a separate `discoveryPractical` profile, never the all-time raw post-experience practical profile. Baseline per dimension is the mean of each stable person's `2 * direction * confidence`. Temporary context is `0.75 * sum(direction * modifier) / max(1, recent person count)`, capped at ±1.5. Existing recommendation-time practical evidence contributes its old score × 0.25 and cannot create a new stable label. Combined score is capped at ±2. Existing candidate metadata/confidence gates and novelty penalties apply unchanged. Domain selection adds stable taste `2 * confidence` per matching person and recent taste `0.5 * modifier` per matching positive observation, capped together at 6. Expired one-off taste is excluded from the discovery taste profile. Original stated interests and actual overall ratings retain their prior behavior. The prompt/context and deterministic rationale receive both layers; a rationale describes memory use, not a guarantee of venue conditions or a claim that reranking changed the winner.

Layered discovery scores contribute whenever their weight is positive and their absolute score exceeds 0.000001. The older 0.5 display threshold is not applied to this derived profile: recent nuance must be able to weaken a stable baseline without accidentally suppressing it completely. Exactly balanced evidence has no contribution.

Our Taste adds **What seems to stick** (qualifying stable evidence; otherwise Still learning) and **What mattered recently** (temporary person-specific quotes). Observational Shared/Different remains available and explicitly does not mean stable. What we learned distinguishes actual contextual reactions from requests for next time, and never fabricates lasting pair consensus.

Additive migration `0006_open_rick_jones.sql` adds `signal_class` (old rows default uncertain), nullable `context_marker`, `future_preference` (default 0) and nullable `expires_at` to the existing signals, preserving all review history. It adds `preference_memory_layers`: pair key, policy version, derivation time and an auditable JSON projection with confidence/cumulative/net weights, distinct chapter/occurrence counts, first/last seen, expiry and promotion source. The projection is rebuilt from the canonical ledger on **every read**, never trusted as a cached truth; concurrent projection writes cannot determine recommendations. Review edits invalidate it atomically. Existing old quotes get conservative deterministic context/future classification on read without a destructive backfill. Reset deletes both layers, canonical reviews/signals and pair history, with session revocation preventing late revival. Context expiry does not delete the historical quotes or projection evidence; reset is the deletion action. No new secrets, provider or user tracking are added.

Tests cover classification/quote guards, repeated promotion, contradictions/demotion, independent A/B consensus, temporary reranking, three-chapter/30-day expiry, continuing stable effects, D1 rebuild/edit/reset, state/grounding gates and existing journey behavior. Limits: English/Japanese marker vocabulary, self-attested experience completion, an active 100-chapter learning window, a heuristic confidence score, and possible correlations among repeated situations. The next improvement is explicit condition-aware preferences (for example quiet when tired) and reliable candidate condition evidence.

### Post-experience learning

**Together learns from shared experiences, not just stated preferences.** Together gets better after every shared experience because it learns what each person actually enjoyed — and what they experienced differently.

On a saved LIVE Qloo-grounded chapter, **We tried this** records explicit completion. Each person can choose Loved it / Liked it / It was okay / Not for me, with an optional short note and up to four contextual chips. One person can answer now and the other later. Marking completion without a reaction adds no taste evidence. DEMO, FALLBACK, NEEDS_INPUT and unsaved reveals cannot create verified experience history. Completion is user attestation, not independent proof of attendance.

Optional notes/chips use OpenAI Responses strict Structured Outputs (`store: false`). Validated enumerated taste sentiments and practical directions require exact supporting quotes from the submitted content, plus a deterministic English/Japanese topic check at interpretation, storage and read. A crowd quote cannot become an outdoor dislike or quiet preference. This conservative vocabulary may omit valid reactions phrased differently or in other languages. Overall liking never implies liking every aspect. Unsupported or contradictory details are omitted; refused, incomplete or invalid output leaves prior evidence unchanged. The model interprets content only: deterministic code updates memory, ranks signals and writes auditable summaries. **What we learned** appears only after both people answer; an A-only reaction never invents B's reaction. Missing aspect comments are not interpreted as disagreement or indifference.

Weight per actual-experience observation is **4**, versus **1** for an initial stated taste tag or recommendation-time note and **2** for a recommendation-time practical chip. Signed taste evidence (+4 positive, -4 negative, 0 explicitly indifferent with evidence mass 4) is combined per person; support must have signed sum / total evidence mass >= 0.5 to appear. Shared requires supported positive evidence for both people, otherwise Different retains the supported person's emphasis. Explicit indifference can outweigh an earlier weak positive without inventing a dislike. Shared strength is the smaller of the two positive signed totals. Existing chapter counts stay counts, not compatibility percentages. Practical dimensions use the existing `2 * sum(direction * weight) / sum(weight)` formula, now including person-specific weight-4 evidence. Opposing requests balance instead of silently assigning one person's preference to the other.

Domain selection retains the existing variety penalties and uses the stable/recent taste contributions described above; domain reaction averages blend each person's actual rating at weight 4 with recommendation feedback at weight 1 (Loved +2, Liked +1, Okay 0, Not for me -4). Positive actual recommendations become new Qloo seed entities for that person before older stated interests. Negative actual reactions remove that person's entity from positive seeds. The next discovery's memory context and explanation separate stable evidence and temporary actual-experience observations. Quiet/crowd/price/pace ranking still requires fresh candidate evidence; a personal crowd complaint is not provider occupancy data or a guarantee that the next candidate is quieter.

Additive migration 0005 creates `experience_reviews` and `experience_reaction_signals`. Reviews are uniquely scoped by anonymous pair + chapter + A/B; signals add kind + tag/dimension. Atomic replacement and input fingerprint retries prevent duplicate evidence. Stored fields are pair/chapter IDs, actual Qloo entity ID/name/domain, person, overall reaction, structured aspect/practical signals, short supporting quotes, source `post_experience`, weight, timestamp and a SHA-256 retry fingerprint. Full post-experience notes and chip selections are **not** stored. Short quotes can contain personal text: avoid sensitive details. Edited reviews replace prior signals, including removal of previously submitted optional details. The UI explains this before saving.

Reset deletes all post-experience reviews and signals alongside existing pair history/practical evidence, revokes the session and rotates the HttpOnly anonymous cookie. The shared provider cache is retained. Learning uses the existing 100 retained chapters; older review records persist until reset but do not affect the active profile once their chapter leaves that window. There is no cross-device account recovery or independent attendance verification. Person labels A/B reuse the existing You/Partner identities.

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
