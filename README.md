# Together — AI Journey Partner

Hackathon MVP for the idea: **AI should not replace your people; it should create more life to share with them.** The product turns a reflection on a real experience into one new, real-world adventure.

## Demo flow

1. Open the Journey Map and tap **Talk about today**.
2. Read the two reflections on *Lost in Translation*.
3. Reveal the **Shared Spark**—common ground without a taste-match score.
4. Tap **Let's follow it** to reveal exactly one adventure.
5. Open **Why this adventure?** to see Conversation → Entity resolution → Qloo Taste Graph → Journey filter.
6. Tap **Let's go**, then **We went—tell you about it** to record a reaction and add the chapter to the Journey.

## Architecture

- **Conversation Engine:** the MVP ships a deterministic structured extraction for the prepared vertical slice. In production, an LLM should return `experience`, resolvable `cultural_signals`, and separate `emotional_context`; emotional adjectives are not sent to Qloo as if they were entities.
- **Qloo Taste Engine:** `app/api/adventure/route.ts` resolves *Lost in Translation*, Tokyo nightlife, and indie music through `/search`, passes the resulting real entity IDs together as `signal.interests.entities` to `/v2/insights`, requests `filter.type=urn:entity:place`, and preserves Qloo's result order.
- **Journey Engine:** D1 stores experiences, reflections, reactions, who joined, discovery source, Qloo IDs, and structured signals. Known entity IDs are removed after Qloo retrieval so the single reveal is novel to this Journey.
- **Experience UI:** a client-side five-state flow implements Journey, Talk, Shared Spark, Reveal, and Return. A WebMCP tool exposes the same Reveal action when the browser supports it.

Qloo is not optional in the live path: the app does not ask an LLM to invent the recommended place. Qloo resolves cultural entities and performs the cross-domain ranking; the product layer only applies Journey novelty/context and chooses one result from that grounded set.

## LIVE and DEMO

- **LIVE** appears only after both entity resolution and `/v2/insights` succeed with a real Qloo response.
- **DEMO** is shown when `QLOO_API_KEY` is absent or the live call fails. It uses the prepared listening-bar story and never labels it as live.
- `QLOO_API_BASE_URL` is configurable because hackathon and production accounts may use different hosts.

## Setup

```bash
cp .env.example .env.local
npm install
npm run db:generate
npm run dev
```

Set `QLOO_API_KEY` in `.env.local` for local LIVE mode. Do not commit `.env.local`. The hosted environment must receive the same key as a secret.

## Validation

```bash
npm run lint
npx tsc --noEmit
npm run build
```

## MVP boundaries

No stranger matching, dating/friend discovery, social feed, recommendation grid, ranking, points, taste-match percentage, complex profile, or payment flow. Single-user use works conceptually; this prepared vertical slice demonstrates the shared two-person Journey.
