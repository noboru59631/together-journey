# Together — AI Journey Partner

**Make Life More Interesting. Together.** AI shouldn't replace your friends. It should give you more to share with them. What should we experience next?

Together is a Qloo Hackathon MVP: two friends reflect on *Lost in Translation*, discover their Shared Spark, and reveal **one** next adventure. It is a prepared two-person story, not a general-purpose chat or a stranger-matching service.

## Try the demo

1. Open the Journey Map and tap **Talk about today**.
2. Read the two prepared reflections: Tokyo at night, lonely but beautiful; and the indie soundtrack.
3. Tap **See your Shared Spark**, then **Let's follow it**.
4. Open **Why this adventure?** to inspect the inputs, Qloo entities when LIVE, and the Journey history filter.
5. Tap **Let's go**, then **We went—tell you about it** to save a reaction in D1.

The listening-bar image and story are **DEMO/FALLBACK artwork and copy**. LIVE place results are displayed without that artwork, so a Qloo result is never illustrated as a specific venue that Qloo did not provide.

## Architecture

- **Conversation:** The MVP reads two fixed reflections. A deterministic check separates the Tokyo/night context and soundtrack/indie cue from emotional language. It supports this prepared script only; it does not run an LLM or claim broad natural-language understanding.
- **Qloo:** The server resolves the exact movie *Lost in Translation* and soundtrack artist *Phoenix* through `/search`, checking names, types, and returned IDs. Phoenix's “Too Young” appears in the film's soundtrack; using that artist is a **curated bridge**, not a fact inferred by Qloo from the user's words. It passes both actual IDs as `signal.interests.entities` to concurrent `/v2/insights` requests for places, destinations, and books. The place request also uses `filter.location.query=Tokyo`; every request enables `feature.explainability=true`. The one revealed adventure is selected from the place results after Journey history is excluded, while the other categories verify cross-domain taste propagation.
- **Journey:** D1 stores saved experiences and optional reflections under a random, browser-specific, HttpOnly journey cookie. Before a LIVE reveal, the server removes Qloo candidates whose IDs appear in that browser's Journey history, then selects the first remaining Qloo result. The UI reveals one result, never a list.
- **Explanation:** “Why this adventure?” shows the actual resolved entity names and IDs, per-category result counts, sanitized API statuses, and the count excluded by Journey history. Together writes the prose explanation. It does not display an invented score or claim that every input independently caused the selected result.

Qloo is essential to LIVE: it supplies both the resolved cultural entities and the cross-domain place results. No LLM creates a venue. See the [Qloo search reference](https://github.com/qloo/docs-public/blob/main/reference/get-search.md), [Insights parameters](https://github.com/qloo/docs-public/blob/main/reference/insights-api-deep-dive.md), and [soundtrack source](https://www.focusfeatures.com/article/the_music_of_sofia_coppola).

## Modes and failures

| Mode | Meaning |
| --- | --- |
| **LIVE** | Both Qloo entities resolve, Insights returns a new place, and the D1 history filter succeeds. |
| **DEMO** | `QLOO_API_KEY` is absent. A fixed, clearly labeled story is shown. |
| **FALLBACK** | Qloo, history lookup, or the adventure service fails; the same fixed story is labeled as a fallback. |

Empty results, unresolved entities, 401/403, 429, 5xx, and timeouts enter FALLBACK. The API key, raw Qloo error body, and request headers are never logged or returned to the browser. An empty or weak result is never replaced with an LLM-invented LIVE recommendation.

## Setup

Requires Node.js 22.13 or newer. Install dependencies, copy `.env.example` to an ignored `.env.local`, and set `QLOO_API_KEY` only in that local file or the hosting secret manager. The default API host is `https://hackathon.api.qloo.com`; set `QLOO_API_BASE_URL` only if your Qloo account uses a different host. Keep the key out of Git, issue reports, screenshots, and client code.

```bash
npm ci
npm run dev
```

The hosted Site uses the logical D1 binding `DB` from `.openai/hosting.json` and the migration in `drizzle/`. Open [Sites](https://chatgpt.com/sites), find **Together — AI Journey Partner**, then select **More actions → Settings**. Add `QLOO_API_KEY` as a **secret** in its hosted environment settings, enter the value directly there, and save. Never paste the value into chat or put it in `.openai/hosting.json`. Ask the agent to redeploy the approved saved version after saving; Sites applies runtime changes on the next deployment. See the [official Sites instructions](https://learn.chatgpt.com/docs/sites?surface=app). If this account redirects Sites to Library or has no settings control, do not assume that the documented screen is available.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm test
npm run build
```

The route tests execute the actual adventure handler with isolated synthetic Qloo and D1 dependencies. They cover DEMO, two resolved signals, cross-domain type and ID validation, history exclusions, malformed reflections, empty results, resolution failures, 401/403, 429, 5xx, timeouts, and unavailable history. Their synthetic success case does **not** verify live Qloo connectivity or recommendation quality.

The prepared LIVE sequence was verified end to end on 2026-10-08 with a configured Site secret: reflections → exact entity resolution → two IDs in three Insights requests → returned places/destinations/books → D1 novelty filter → one reveal → reaction/reflection save. Every live Qloo request returned HTTP 200 with 20 results. The first reveal was St. Mary's Cathedral, Tokyo; after saving it, a repeat run excluded that Qloo ID and revealed The Okura Prestige Tower. Desktop and 390 × 844 mobile browser flows both completed, and both saved records were confirmed in D1. No secret values are recorded in application diagnostics or this document.

## Privacy and limits

The demo conversation is fictional and fixed. Saved reactions and optional reflections remain in D1 for that browser's anonymous Journey cookie; the cookie is HttpOnly, Secure in production, and expires after 90 days. The app has no account recovery, cross-device sharing, deletion UI, content moderation, or production-grade rate limiting. Do not enter sensitive personal information in the optional reflection. The Journey Map itself is an illustrative UI; saved D1 history currently affects novelty filtering but does not rebuild the visual map after a reload.

This MVP does not include stranger matching, an SNS feed, rankings, taste percentages, points, or a grid of recommendations. The prepared Qloo LIVE path is verified, but general LLM signal extraction is not implemented: the current experience supports the fixed reflections above and uses a deterministic Tokyo cue plus a curated Phoenix soundtrack bridge.
