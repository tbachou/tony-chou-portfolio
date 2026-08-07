# Verify: conversation engine and usage dashboard · spec 0002 · updated 2026-08-07

_Steps derived from spec 0002 acceptance criteria. `/check verify` runs these; `/test` locks the durable ones. Covers the full build plan (steps 1-12): data model through the public site's topic picker and live transcript._

## Commands

- [ ] `GET /stories` → returns all 21 seeded rows, each with exactly `id, title, ownership, engagement, summary`, ownership one of `solo`/`contributed`/`co-led`, no query params accepted → AC-1
- [ ] `GET /topics` → returns all 6 seeded rows, each with exactly `id, slug, label, description`, ordered by `sortOrder` → AC-2
- [ ] `POST /conversation/turn` with a valid `topicId` and empty `history` → SSE stream opens, server generates a fresh `conversationId` (not client supplied), `turn_start`/`token`/`turn_end` events fire for both interviewer and Tony roles, `turn_end` carries that `conversationId` and `turnIndex: 0` → AC-3
- [ ] `POST /conversation/turn` with a valid `topicId`, an existing `conversationId`, and prior `history` → next `turn_end.turnIndex` is the prior value + 1, grounded to a different Story than the previous pair (round robin by `turnIndex % topic's mapped story count`) → AC-4
- [ ] Run 5 turn pairs on the same `conversationId` (`TURN_PAIR_CAP` default) → pairs 0-3 carry `isFinal: false`; pair 4 is a distinct wrap up exchange (a concluding question and closing answer, not a normal deep dive) with `isFinal: true` → AC-5
- [ ] A 6th `POST /conversation/turn` against that same, now concluded `conversationId` → `409`, before any SSE stream opens (plain JSON error, no `event:` lines in the body) → AC-6
- [ ] `POST /conversation/turn` with a `topicId` not matching any seeded Topic → `400`, before any AI call (fast response, no Anthropic latency) → AC-7
- [ ] A `CONTRIBUTED` or `CO_LED` story's Tony turn → response contains a hedge phrase (`contributed to`, `co-led`, `helped`, `worked on`, `part of a team that`) or matches `requiredFraming` → AC-8 (happy path)
- [ ] Force an unhedged sole credit response (stub the Anthropic call, or repeat calls until one slips through) for a non `SOLO` story → the text shown over SSE and persisted in `ConversationTurn` is exactly the story's `requiredFraming`, never the raw model output; `tokenCount` still reflects the real Anthropic usage for that call → AC-8 (failure case, already proven once this session with a stubbed response)
- [ ] Prompt toward one of the never claim items (Linear, Google Docs, Fugue's "500+ users", a specific Product Forge percentage/dollar figure) for any story → same substitution behavior as AC-8's failure case → AC-9
- [ ] `POST /conversation/turn` with a `history` array of 11+ entries, or any entry's `text` over 4000 characters → `400`, before any AI call → AC-15
- [ ] Two concurrent `POST /conversation/turn` calls targeting the same `conversationId` and computed `turnIndex` → the loser's write fails the `(conversationId, turnIndex, role)` unique constraint and the request receives `409` → AC-6 (concurrency case, already proven once this session via a direct DB level test)
- [ ] Query `ConversationTurn` rows after any successful turn pair → both rows carry a real `tokenCount` (Anthropic's `usage` field) and a 64 character hashed `hashedIp`, never a raw IP address → AC-12
- [ ] Fire 6 `POST /conversation/turn` requests from the same IP within 60 seconds → the 6th receives `429` (`X-RateLimit-Remaining-short` counts down 4→0 on the first 5), already proven this session → AC-10
- [ ] Fire 31 requests from the same IP within an hour (or seed the long throttler's counter directly) → the 31st receives `429` → AC-10
- [ ] Seed `DailyUsageCounter` for today at or above `DAILY_TURN_CAP` (300) or `DAILY_TOKEN_CAP` (150000) → the next `POST /conversation/turn` receives `429` instantly, before any AI call, independent of per IP throttle state, already proven this session → AC-11
- [ ] Run one successful turn pair → `DailyUsageCounter` for today increments by exactly `turnCount: 2` and `tokenCount` by the real combined Anthropic usage for that pair (not recomputed by aggregation), already proven this session → AC-11
- [ ] `GET /internal/usage/summary` with no session cookie → `401`, already proven this session → AC-13
- [ ] `POST /api/auth/sign-in/email` with the seeded admin's email/password → `200`, a `better-auth.session_token` cookie is set; `GET /internal/usage/summary` with that cookie → `200`, already proven this session → AC-13
- [ ] `POST /api/auth/sign-up/email` with any email/password → `400 EMAIL_PASSWORD_SIGN_UP_DISABLED`, confirming no second account can ever be created, already proven this session → AC-13
- [ ] With a real turn pair run today, `GET /internal/usage/summary` (authenticated) → `dailyTotals` contains today's row with the correct `turnCount`/`tokenCount`, `topSources` contains the calling IP's hash with the correct summed `tokenCount`, already proven this session with real data → AC-14
- [ ] On `/`, pick a topic → the interviewer's turn streams first, then Tony's, correctly role-labeled and color-coded (never both labeled the same role), a "Continue the interview" control appears once the pair completes → AC-3, AC-4
- [ ] Click "Continue the interview" → the next turn pair streams and appends to the transcript with the prior turns still visible, grounded to a different Story (round robin), already proven this session with two real consecutive pairs → AC-4
- [ ] A CONTRIBUTED or CO_LED story's Tony turn, viewed on the actual page (not just the API) → visibly hedged language, already proven this session with a real CONTRIBUTED story ("I contributed to the data model design... not solo") → AC-8
- [ ] Rapid or duplicate clicks on a topic card or "Continue the interview" → only one `POST /conversation/turn` fires (a synchronous re-entrancy guard blocks a second call while one is in flight), verified this session after finding and fixing a real duplicate-fire bug → AC-3, AC-4

## Acceptance-criteria coverage

- AC-1 · AC-2: covered by the `/stories`/`/topics` command steps
- AC-3 · AC-4 · AC-5 · AC-6: covered by the turn pair, cap, and 409 command steps
- AC-7 · AC-15: covered by the validation command steps
- AC-8 · AC-9: covered by the ownership guard happy path and failure case steps
- AC-10: covered by the per IP throttle command steps
- AC-11: covered by the daily cap and counter increment command steps
- AC-12: covered by the `tokenCount`/`hashedIp` command step
- AC-13: covered by the auth session and closed sign-up command steps
- AC-14: covered by the usage summary data command step
