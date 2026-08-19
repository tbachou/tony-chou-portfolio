# 0005 child: feedback intake

## Summary

Visitors on the Beta page and the portfolio site can send anonymous feedback (a category and a message). The api validates it, stores it in Postgres, and publishes an event for the classifier flow. No identity is collected; email is the owner's v1 reading surface, so no admin page ships here.

## Requirements

**User stories**:
- As a visitor, I want to report a problem or request a feature in under a minute so that I do not need to find an email address.
- As the owner, I want every submission stored and forwarded so that feedback is never lost even if the notification pipeline is down.

**Acceptance criteria**:
- **AC-I1**: a visitor on either surface can submit a message (1 to 2000 characters) with an optional category (bug, feature, other) and sees a confirmation state; the row lands in `Feedback` with source, category, message, hashedIp, createdAt.
- **AC-I2**: submissions are anonymous: no email, name, or account field exists on the form, the DTO, or the table. hashedIp uses the existing `rateLimitIdentity()` convention and serves rate limiting only.
- **AC-I3**: rate limits hold: a short window in memory throttle (5 per hour per identity, enforced by a `FeedbackThrottlerGuard` extending a shared IPv6 collapsing base guard, see Decision) plus a persisted cap of 10 rows per hashedIp per UTC day, enforced by counting existing `Feedback` rows before insert. Over limit returns 429 with the named constant `FEEDBACK_RATE_LIMIT_MESSAGE` and writes nothing. The count then insert cap has a stated, accepted race: concurrent submissions from one identity can exceed 10 by a few rows. Accepted because the stakes are a few extra spam rows in Postgres (unlike Beta's cap, which guards paid model calls and therefore uses the atomic reserve pattern), and the 5 per hour throttle bounds the burst window. This differs from Beta's convention on purpose; do not silently "fix" it in either direction without a spec change.
- **AC-I4**: validation rejects empty or over length messages and unknown fields (global ValidationPipe whitelist), returning 400 with no row written.
- **AC-I5**: the form copy on both surfaces states, verbatim or near: "Please do not include personal or medical details." The Beta surface copy also links nothing that implies plan content is attached; the submission carries only what the visitor typed in the feedback box.
- **AC-I6**: on successful store the api publishes the event to SNS fire and forget: an SNS failure or missing configuration never changes the visitor's 201 response and is logged as error name only.
- **AC-I7**: no api log line contains the message text, on any path (success, validation failure, throttle, SNS failure).

## Decision

One new module `apps/api/src/modules/feedback/` following the repo's module shape (controller, service, dto/, colocated specs, mocked tests). The web side adds a small form component per surface, styled by each surface's own theme, posting through the existing typed api helper pattern.

Cross check resolutions baked in:

- **Throttle identity**: the IPv6 collapsing `getTracker` logic currently inside `beta-throttler.guard.ts` is extracted to a shared base guard `common/guards/collapsed-ip-throttler.guard.ts`; `BetaThrottlerGuard` and the new `FeedbackThrottlerGuard` both extend it, so the hourly throttle and the daily cap key on the same /64 collapsed identity and the logic exists once.
- **Missing topic config**: when `SNS_FEEDBACK_TOPIC_ARN` is absent, the publisher logs a single WARN at module construction and publishing is disabled; no per request log spam.
- **Client construction safety**: the SNS client is constructed inside the same guarded path as the publish call; a synchronous construction failure (for example missing `AWS_REGION` while the ARN is set) is swallowed and logged name only, exactly like a publish failure, and can never throw into the request path (AC-I6 applies to both).
- **429 copy**: `FEEDBACK_RATE_LIMIT_MESSAGE` is a named constant in the module's constants file, mirroring Beta's `IP_LIMIT_MESSAGE` pattern.
- **Publisher IAM**: the api publisher user's policy (`sns:Publish` on this one topic ARN) is a Terraform managed `aws_iam_policy` defined in `infra/feedback.tf` (the classifier child, where the topic ARN exists); Tony creates the user and key in the console and attaches the policy by name, per the foundation's division of labor.

Event payload published to SNS (the exact boundary crossing object, nothing more):

```json
{ "id": "<cuid>", "source": "beta|portfolio", "category": "bug|feature|other|null", "message": "<text>", "createdAt": "<iso>" }
```

**Implementation skills**: `nestjs-best-practices` (`kadajett/agent-nestjs-skills`, `.claude/skills/nestjs-best-practices/`) · `prisma-database-setup` (`prisma/skills`, `.claude/skills/prisma-database-setup/`) · `javascript-typescript-jest` (`github/awesome-copilot`, `.claude/skills/javascript-typescript-jest/`)

## Feature design

**Data model sketch** (confirmed by the engineer 2026-08-19):

| Field | Type | Notes |
|---|---|---|
| id | String cuid | primary key |
| createdAt | DateTime | default now |
| source | enum FeedbackSource: beta, portfolio | required |
| category | enum FeedbackCategory: bug, feature, other | nullable, visitor chosen |
| message | String | required, max 2000 chars, `@db.VarChar(2000)` |
| hashedIp | String | required, indexed, `rateLimitIdentity()` output |

Append only: no update or delete API exists. Retention indefinite for now. Classification results are never stored (email only, per the umbrella).

**State transitions**: none, rows are immutable.

**API surface**:
| Endpoint | Method | Key inputs | Key outputs | Auth | Key errors |
|---|---|---|---|---|---|
| /feedback | POST | message: string (req, 1..2000), category: enum (opt), source: enum (req) | 201, id | public (@AllowAnonymous), throttled | 400 validation, 429 rate limited |

**Value sourcing**:
| Action | Value produced | Source |
|---|---|---|
| POST /feedback | source | request DTO field, set by which page hosts the form |
| POST /feedback | hashedIp | derived from request IP via `rateLimitIdentity()` (common/utils/ip-hash.util.ts) |
| POST /feedback | daily cap decision | count of `Feedback` rows for hashedIp within the current UTC day (`utcDateOnly` convention) |
| SNS publish | topic ARN | env `SNS_FEEDBACK_TOPIC_ARN` (foundation output; absent means skip publish and log once) |
| SNS publish | AWS credentials | Render env vars for the console created publisher user (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`) |

**Key invariants**:
- No PII fields exist anywhere in the flow (AC-I2); the table gains no identity columns without a new spec.
- The visitor response never depends on AWS availability (AC-I6).
- Message text appears in exactly two places: the Postgres row and the SNS payload.

**Security model**: public endpoint, anonymous by design, throttled at three layers (in memory, persisted daily cap, DTO limits). No compliance scope: no PII, no health data solicited, and the copy actively discourages it. Reads are owner only (via email now, an internal admin page later under the paused Phase 2).

**Configuration required**:
- `SNS_FEEDBACK_TOPIC_ARN`: target topic; absent disables publishing (intake still works).
- `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`: the publisher user's credentials, entered in Render's env UI by Tony.

**Critical test scenarios**:
- Happy path: submit from each surface, row stored, publish called with the exact payload shape, verifies **AC-I1**, **AC-I6**.
- Failure case: SNS client rejects; response is still 201 and the log line carries error name only, verifies **AC-I6**, **AC-I7**.
- Rate limit: 11th row in a UTC day for one hashedIp gets 429 and no insert, verifies **AC-I3**.
- Validation: 2001 character message gets 400, no row, no publish, verifies **AC-I4**.

## Build plan

Tracer Bullet: thinnest end to end thread first (portfolio surface), then thicken (Beta surface, hardening).

1. Migration for `Feedback` + enums (additive only, inspect before apply, shared prod DB rule), satisfies **AC-I1**.
2. Feedback module: DTO, controller, service with store + count based daily cap + throttle guard reuse, mocked specs, satisfies **AC-I1**, **AC-I2**, **AC-I3**, **AC-I4**, **AC-I7**.
3. SNS publisher (aws sdk v3 `@aws-sdk/client-sns`), fire and forget with name only error logging, env gated, specs for the failure paths, satisfies **AC-I6**.
4. Portfolio surface form (contact section), thin thread proof end to end against dev, satisfies **AC-I1**, **AC-I5**.
5. Beta surface form styled under `.beta-theme`, copy pass on both, satisfies **AC-I1**, **AC-I5**.
6. Gate: this child touches the Beta surface, so its push runs the full predeploy audit including the clinical auditor.

## Consequences

**Positive**: a real feedback loop with zero PII liability; the intake works even with AWS fully down.
**Negative / tradeoffs**: no reply channel to visitors (anonymous by design); the owner reads feedback only via email until Phase 2 builds the admin page.
**Neutral**: the api takes its first AWS SDK dependency.

## Inline rationale

Counting `Feedback` rows for the daily cap avoids a second counter table and cannot drift from reality; at 10 rows per identity per day the count query is trivially cheap on the hashedIp index, and its race is accepted explicitly in AC-I3. The env gated publisher lets the intake ship and be verified before any AWS resource exists, which is what a thin tracer thread wants. The fire and forget publish is safe on Render specifically because the api is a long lived process: a detached promise keeps running after the response is sent. On a serverless runtime this pattern would drop events; that is why it is stated here rather than assumed.
