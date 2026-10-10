# Devpost submission draft

## Project name

Together — AI Journey Partner

## Tagline

Turn two honest reactions into one Qloo-grounded real-world adventure.

## Functional demo

https://together-journey-qloo.crypto5555111.chatgpt.site/

## Public code repository

https://github.com/noboru59631/together-journey

## What it does

Together helps two people decide what to experience next without reducing either person to a taste score or showing them an endless recommendation list. They start with something they already experienced together—a film, book, meal, concert, place, show, or podcast—and separately describe what stayed with them.

An OpenAI-powered Conversation Engine converts those reflections into a strict typed taste-signal object. It may propose cultural entities, but it cannot declare them real. Together independently searches Qloo for every candidate and accepts only an exact normalized name match with the expected entity type and a real Qloo ID. Low-confidence, mismatched, unresolved, and duplicate entities are excluded.

Once both people have contributed verified signals, Qloo Insights crosses domains to find real places, books, or destinations. Together removes anything already proposed or experienced, applies a practicality preference, and reveals exactly one adventure. The explanation view separates what came from the LLM, what Qloo verified, what Qloo inferred, and what Together selected. After the experience, the pair can save a reaction and reflection to their anonymous Journey, changing what can be revealed next.

## How it is agentic

Together runs a bounded multi-step workflow instead of asking an LLM for a recommendation:

1. Interpret two free-form reflections with strict Structured Outputs.
2. Verify every proposed entity through Qloo Search.
3. Stop with `NEEDS_INPUT` when there is not enough verified evidence.
4. Query Qloo Insights across several domains only after the verification gate passes.
5. Filter prior Journey history and choose one practical new candidate.
6. Explain provenance and save the outcome for the next decision.

Each step has explicit tool boundaries, validation, retry rules, and honest failure modes. The model supplies context, not cultural facts. Qloo supplies the grounded cross-domain intelligence that makes the workflow useful.

## What makes it Qloo-powered

The product cannot produce a `LIVE` adventure without Qloo. Qloo first verifies that candidate films, artists, books, food, and places actually exist and match the expected type. Its Insights API then supplies every cross-domain candidate considered by the selector. Removing Qloo would leave only free-form interpretation; it would not leave a functioning recommendation product.

This design also prevents a persuasive LLM answer from silently becoming product truth. A fabricated or weak entity is excluded before Insights runs, and an unresolved conversation is labeled `NEEDS_INPUT` rather than presented as a live result.

## How it was built

- TypeScript, React, Next.js-compatible Vinext, and Cloudflare Workers
- OpenAI Responses API with strict Structured Outputs
- Qloo Search and Insights APIs with exact-match entity resolution
- Zod validation and explicit retry/failure handling
- Cloudflare D1 for anonymous Journey history
- Node test runner and ESLint

## Privacy and responsible design

Conversation text is sent server-side to the configured LLM provider for extraction. Only verified Qloo entity IDs are sent to Qloo Insights. API keys remain server-side. Saved reactions and optional reflections are scoped to a random HttpOnly Journey cookie. The MVP has no stranger matching, public profile, taste score, social feed, or leaderboard.

The UI never labels a prepared activity as `LIVE`. Missing credentials produce `DEMO`; provider or storage failures produce `FALLBACK`; insufficient verified evidence produces `NEEDS_INPUT`.

## Testing instructions

1. Open the public demo URL without signing in.
2. Enter `Princess Mononoke` as a movie. Mention the ancient forest in one reflection and `Joe Hisaishi` in the other.
3. Confirm the result is `LIVE`, open “Why this adventure?”, and verify the LLM, verified Qloo entities, Qloo inference, and Together selection are shown separately.
4. Repeat with `Norwegian Wood` as a book and `Blue Bottle Coffee` in the second reflection.
5. Try vague reflections with no concrete cultural clues and confirm `NEEDS_INPUT`.
6. Try clearly fabricated titles and creators and confirm they are not silently accepted or labeled `LIVE`.

## License

MIT

## Final pre-submit blockers

- Add OpenAI API credits; the production key is configured, but the current API account returns `credit_balance_exhausted`.
- Complete and record the two production `LIVE` runs plus both guardrail runs after credits are available.
- Create the public GitHub repository at the URL above and verify its CI workflow is green.
- Recheck the public Site immediately before the manual Devpost submission.
