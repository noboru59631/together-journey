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

- [ ] Create the public `noboru59631/together-journey` repository and confirm it is publicly visible.
- [x] Include an OSI-compatible license (`MIT`).
- [x] Document architecture, provider responsibilities, failure modes, privacy, and Qloo's indispensable role.
- [x] Keep secrets out of source, history, screenshots, logs, and submission text.
- [x] Configure `OPENAI_API_KEY` as a production Site secret and redeploy it with Version 13.
- [ ] Add OpenAI API credits, then complete two production LLM LIVE runs and both guardrail runs.
- [x] Keep the externally hosted Site public and accessible without sign-in.
- [x] Add the intended public repository URL to `DEVPOST.md`; verify it resolves after repository creation.
- [ ] Copy the final text from `DEVPOST.md`, add screenshots if useful, and verify the technology list.
- [ ] Optionally capture the 60-second demo story; the 2026 Agentic Hackathon does not require a video.
- [ ] Verify the public Site is accessible without sign-in immediately before submission.
- [ ] Submit on Devpost manually; this repository does not automate or finalize submission.

## Privacy and limits

Conversation text is sent server-side to the configured LLM provider for extraction. Only verified Qloo entity IDs are sent to Qloo Insights. API keys remain server-side. Saved reactions and optional reflections remain in D1 for the anonymous browser Journey cookie, which is HttpOnly, Secure in production, SameSite Lax, and expires after 90 days.

Do not enter sensitive personal information. The MVP has no account recovery, cross-device sharing, deletion UI, moderation, or production-grade rate limiting. It intentionally has no stranger matching, social feed, taste score, leaderboard, or multi-result recommendation grid.
