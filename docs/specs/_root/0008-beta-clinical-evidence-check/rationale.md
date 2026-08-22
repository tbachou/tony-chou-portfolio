# 0008. Beta clinical evidence check, rationale

## Context

> ⚠️ Premise note: this work began as "add a RAG system to Beta", and that framing does not survive contact with the problem. Retrieval augmented generation earns its place when the model does not know something specific and checkable. Claude has almost certainly read the climbing medicine literature, and a corpus of a few hundred passages curated by one person is a far narrower slice of it than the model's own training, so retrieval cannot be justified as knowledge injection here. What the model genuinely cannot do is tell you which published source backs a given number, and its confidence is uncorrelated with whether one exists. The defensible framing is therefore **attribution, not retrieval**: check whether a claim is traceable, which is a different question from whether it is probably right. Once the framing changed, the vector layer stopped being load bearing and was removed. The honest description of what this spec builds is a curated, human reviewed reference table with a metadata lookup, and it should not be described as a RAG system.

Beta (spec 0004) drafts staged return to climbing plans through three agents: a safety screener, a progression drafter, and a plain language coach. Its clinical content lives in `apps/api/src/modules/beta/skills/drafter.md` as prose Tony wrote from his Occupational Therapy background: the pain traffic light thresholds, the three week rule for pain that is constant even at rest, tendon behaviour guidance, and a section of injury specific rules. None of it links to a published source.

Nothing downstream can check it either. `beta-output-guard.ts` (spec 0005's guardrails child) is explicit in its own header that each rule "transcribes a line that already ships in `skills/drafter.md` or `skills/coach.md`" and "may not encode a view about what is clinically valid". So the guard verifies consistency with the prompt, never correctness against evidence. No layer in Beta connects a clinical claim to a source, and that gap is what this spec addresses.

Several forces shape the answer. Beta is slow already: measured drafter latency is 21 to 27 seconds and coach p50 about 8.5 seconds, so time to first plan text is roughly 25 seconds before anything is added. The planner may never persist visitor typed content (spec 0004 AC-6) and none may ever be logged (spec 0005 AC-I7). Beta is unadvertised, so a production shadow mode would collect close to zero data, a conclusion already reached when the output guard's streaming follow up was weighed. And two previous guard rules, R2 and R8, shipped as false positives, both from comparing model produced text lexically, which is the single most instructive failure in this area of the codebase.

There is also a hard external constraint. Any corpus of clinical literature carries licences, and a public repository that exists partly to support a job search cannot safely assume non commercial terms permit it.

## Options considered

### Option 1: offline evidence check over a hand curated corpus, lookup by metadata

Curate a small set of licence filtered open access passages, extract each one's range at curation time under human review, commit both, and compare the drafter's integers against them by filtering on injury and claim type. Runs in the harness against recorded plan captures.

**Pros**:

- No infrastructure at all: no database, no vector store, no embedding model, no credentials, no deployment.
- Verdicts are deterministic, because no model call sits inside one. Calibration is repeatable in a way R8 never was.
- The corpus is reviewable in a diff, so clinical content becomes an auditable artifact rather than prose in a prompt.
- Costs effectively nothing to run, since captures replace live model calls.

**Cons**:

- Not a retrieval system in any meaningful sense, so it demonstrates far less than the project originally intended.
- Curation does not scale beyond what one clinician can personally review.
- Metadata filtering returns everything under two enums, which stops being a useful candidate set past a few hundred passages per bucket.
- Taking the widest hull when passages disagree means `contradicted` gets monotonically harder to reach as the corpus grows, so coverage and detection pull against each other. Named as a tradeoff in `index.md` rather than solved; the deferred evidence tier is the only lever.
- It cannot be built without first making the drafter's timeline an integer pair, so a design that set out to change nothing in production ends up changing one field.

### Option 2: vector retrieval grounding the drafter at generation time

The drafter retrieves protocol passages and drafts from them, carrying citations in `submit_plan`.

**Pros**:

- Strongest possible grounding, because sources shape the plan rather than judging it afterwards.
- The conventional and most recognisable RAG architecture.

**Cons**:

- Changes the `submit_plan` schema and the dose contract, which currently keeps doses as integers so vague quantities are not representable, and hands the coach finished strings so it cannot alter a number. That contract is working and is load bearing for safety.
- Adds a retrieval round trip to a path already at roughly 25 seconds.
- Puts retrieval quality directly in front of visitors before any evidence exists that it works.

### Option 3: verification with vector retrieval

The design as it stood mid conversation: verification time checking, but with embeddings and a vector store (`pgvector` on Prisma Postgres, S3 Vectors, or a committed local index).

**Pros**:

- Semantic matching would rank passages within a filtered set, catching phrasings a metadata filter treats as equivalent.
- Would produce a genuine, demonstrable retrieval component and the vocabulary that goes with it.
- Now affordable: S3 Vectors runs at roughly one to three dollars a month, and OpenSearch Serverless NextGen has no OCU minimum.

**Cons**:

- The ranking gain is modest once `injury` and `claimType` have already narrowed the set to a handful of passages.
- Every store option carries a real cost: `pgvector` means raw SQL against an `Unsupported("vector")` column plus pulling the undecided dev database seeding question into this spec; a managed store means building infrastructure before the eval has proven anything.
- Adds an embedding model as a dependency whose change would silently alter results.

### Option 4: fix in place, extend the output guard with more hand written rules

Keep transcribing `drafter.md` into deterministic rules and grow the rule set.

**Pros**:

- Uses machinery that exists and is already proven twice in production.
- Zero new concepts, no corpus to maintain, nothing new to operate.

**Cons**:

- Cannot close the actual gap. The guard's own contract forbids it from encoding a view about clinical validity, so more rules produce more consistency checking and no more evidence.
- Every added rule is another lexical comparison, which is precisely the mechanism that produced R2 and R8.

## Rationale

Option 1 wins because of the premise note above. Once the goal is attribution rather than knowledge injection, the load bearing parts are the curated corpus, the human reviewed ranges, and a comparison that cannot drift. Retrieval mechanics are not among them, and Option 3 pays real costs (raw SQL against an untyped column, or managed infrastructure, or an embedding dependency) to accelerate a lookup that two enum filters already reduce to a handful of candidates.

Option 2 was rejected on the specific contract described in Context. Beta's structured dose design exists so the coach can never alter a number, and citations in `submit_plan` would reopen that surface for a benefit that is unproven. Adding a retrieval round trip to a path already at roughly 25 seconds compounds the objection (basis: the latency measurements recorded for the output guard's buffering decision).

Option 4 is the one worth naming carefully, because fix in place is often right and is underrated. It fails here for a structural reason rather than a preference: `beta-output-guard.ts` is deliberately scoped to transcribe what the prompt already says, so no quantity of additional rules can express "this number is not supported by any source". Extending it would deepen the exact lexical comparison pattern that produced both known false positives (basis: the R2 and R8 diagnoses recorded for the guard).

Two engineer preferences were overridden by the reasoning rather than by fiat, and both changes were made by Tony after the tradeoff was put in front of him. `pgvector` was chosen and then dropped once the premise note made the ranking step optional. Committing to a vector store at all was dropped for the same reason. Recording this matters because the follow up to revisit retrieval is real: if the corpus grows past what metadata filtering serves, Option 3 becomes correct, and everything expensive (curation, licence verification, reviewed ranges) ports to it unchanged.

The build order follows the standing rule that a green suite is not evidence: the gold cases are authored before the comparator that grades against them exists (basis: the verification method that produced the guard's AC-G9 result).

## Corrections from the cross check

A read only cross check of the first draft returned "not buildable as written", and three findings changed the design rather than polishing it. They are recorded because each one is a trap a future reader could fall back into.

**`timeWindow` was prose, not a number.** The first draft assumed it was structured. It is `{type: 'string'}` described as `'A concrete range, e.g. "Weeks 1-2"'`, and `parseDraftPlan` checks only that it is a non empty string. So the draft's own AC-1, no claim parsed from prose, was violated by its own design, and every `contradicted` verdict would have rested on a regex over model written text: the exact mechanism behind both R2 and R8. Three fixes were weighed: parse the string with a strict regex and add an `unparseable` outcome, switch the first thread to `DoseSpec` which is already integers, or change the schema. The schema change won because it is the same move already made for doses, justified by the same line in `drafter.md`, and it deletes the parsing surface instead of working around it. Visitor output is byte identical, so the cost is confined to the letter of AC-14.

**The `--record` capture could not support the harness.** It writes `{screener, drafter}` and nothing else, with no profile, injury, or id, and `cache[role]` is overwritten per call, so a multi profile run silently keeps only the last plan, unlabelled. `drafter.input` is also the raw tool input rather than the validated object, and cannot be revalidated without the request DTO. The capture format therefore becomes versioned and keyed by profile, carrying the full request.

**The gate could not run from a clone.** Captures default into `.corpus/`, which is gitignored, so AC-11 was unsatisfiable as written. One capture fixture is now committed, with the free text `goals` field replaced by a placeholder.

The cross check also found that the draft's build order put gold case authoring before the passages and captures those cases must name, and that a corpus answering `no_evidence` to everything would pass the "zero false contradictions" half of the gate trivially. Both are fixed in `index.md`: the enabling tasks come first, and AC-18 requires the gold set to contain at least one expected `supported` and one expected `contradicted`.

## Landscape scan, August 2026

Gathered during the design conversation to keep the store and corpus decisions from resting on stale knowledge. Recorded because the follow up to revisit retrieval will need it.

**Prisma and vectors.** Prisma ORM 7 has no first class vector support on any provider. Issue 26546 is open with no announced timeline, and MongoDB Atlas Vector Search is likewise unsupported (issue 26210). `pgvector` on Prisma Postgres works but is Early Access, enabled by a custom `CREATE EXTENSION` migration, and columns surface as `Unsupported("vector")`. TypedSQL types a raw query's params and results but does not lift the column to the model level. Among TypeScript alternatives, Drizzle has a genuine typed `vector()` column with similarity operators and can run alongside Prisma; LanceDB is the strongest embedded option.

**AWS vector storage cost.** Earlier assumptions were wrong in a way worth recording. OpenSearch Serverless classic collections do carry a large floor, roughly 175 dollars a month for a development collection and 350 for production, but NextGen collections went generally available in May 2026 with no OCU minimum and scale to zero after ten minutes idle. S3 Vectors went generally available in December 2025 at roughly one to three dollars a month at this scale and can back a Bedrock Knowledge Base. Aurora Serverless v2 with `pgvector` sits near 44 dollars a month because it cannot scale to zero.

**Embeddings.** Anthropic offers no embeddings API and points at Voyage. On Bedrock, Titan Text Embeddings V2 is about 0.11 dollars per million tokens and Cohere Embed v4 about 0.12. At this corpus size every option costs single digit cents. Open weight biomedical models (PubMedBERT, BioSentVec) are free but require a Python toolchain in an all TypeScript repository.

**Corpus licensing.** The PMC open access subset spans several licence families including CC0, CC BY, CC BY SA, and CC BY NC. Only the first three are safe for committing quoted passages to a public repository, and CC BY NC explicitly forbids commercial use. Licence metadata is machine readable in the article XML, so filtering is practical. The PMC FTP service ends in August 2026, leaving the PMC Cloud Service on AWS, OAI PMH, and E utilities as bulk routes. Of four climbing sources surfaced during the check, one was already CC BY NC SA, so this constraint bites immediately rather than theoretically.

## Curation sweep, 2026-08-22, and why this spec was dropped

Three parallel researchers swept the open literature for sources that state a week timeline for the final rehabilitation stage, one per injury Beta serves, restricted to the `CC0`, `CC-BY`, `CC-BY-SA` rule in AC-2. The result is the reason this spec was rejected, and it is recorded in full so nobody repeats the search.

| Injury | Usable sources | What they actually give |
|---|---|---|
| `finger_pulley` | 1 | Larsson, Nordeman, Blomdahl (2022), *BMC Sports Science, Medicine and Rehabilitation* 14:148, CC BY 4.0. Return to sport 6 to 8 weeks (grade 1 to 2), about 3 months (grade 3) |
| `elbow_tendinopathy` | 0 | Nothing satisfies week explicit, permissively licensed, and upper limb at once |
| `shoulder_impingement` | 3 | Programme duration only (8, 10, and 12 to 16 weeks), general adult population, no return to sport clearance |

**The binding constraint is the licence rule, not the literature.** The evidence exists and is well established. Schöffl's grade based pulley timelines are the field standard. But the primary papers are Elsevier or Sage with no Creative Commons grant, so AC-2 excludes all of them: Schöffl and Schöffl (2006, *J Hand Surg Am*; 2007, *J Hand Ther*), Miro, vanSonnenberg, Sabb, Schöffl (2021, *Wilderness & Environmental Medicine*), Lum and Park (2019, *J Orthopaedics*), Hartnett, Bondoc, Feretti (2023, *J Hand Ther*), Crowley (2012, *J Hand Microsurg*). Do not re research these; they are closed.

Three findings worth keeping even though the spec died:

- **A curation pattern nobody anticipated.** The single usable pulley source is a CC BY systematic review that *reports* Schöffl's closed access numbers. Quoting the open review rather than the closed primary is ordinary scholarly practice and satisfies AC-2 cleanly. If any evidence work is ever revived, this is the technique that makes it viable.
- **The elbow's emptiness is a true statement about the field, not a gap in the search.** A CC BY climbing scoping review protocol (PMC12927343) states that rehabilitation content at each stage is "poorly documented" in the literature it surveys. So `no_evidence` for elbow tendinopathy would have been Beta correctly reporting the state of the evidence.
- **The shoulder sources break the predicate.** AC-13 requires every timeline passage to answer when the final stage begins. The shoulder papers answer how long a programme runs, which is a different question. Treating "12 to 16 week programme" as "final stage starts at week 12" is exactly the quiet mismatch that produces a confident wrong verdict, and is the same class of error as R2 and R8.

The decisive argument against building is arithmetic rather than principle. With roughly four usable ranges across three injuries, the auditability this spec was built to deliver is obtainable by writing four citations into `drafter.md` and stating plainly where none exists. The machinery would have existed to hold four facts.

## References

**Project sources** (verifiable, in this repo):

- `apps/api/src/modules/beta/skills/drafter.md`, where the clinical rules currently live as prose
- `apps/api/src/modules/beta/beta-output-guard.ts`, whose header defines the gap this spec fills
- `apps/api/scripts/beta-guard-corpus.ts` and its `--record` and `--replay` flags, reused here
- `scripts/check-skills.mjs` and `skills-lock.json` (spec 0007), the pattern `check:corpus` follows
- spec 0004 AC-6 (never persist visitor typed content), spec 0005 AC-I7 (never log it)
- `AGENTS.md`, the rule that colocated `.spec.ts` tests are fully mocked, which is why the harness is a script

**Practices & standards**:

- Strangler pattern, applied by leaving the running pipeline untouched and building alongside it
- Eval before pipeline: the gold set is authored before the machinery it grades
- Determinism at the verdict boundary: model judgement is admitted only under human review, at curation time
- Attribution as distinct from correctness, the framing this spec rests on

**Links** (web verified during the design conversation):

- Prisma, first class vector support issue: https://github.com/prisma/prisma/issues/26546
- Prisma, pgvector for Prisma Postgres: https://www.prisma.io/blog/orm-6-13-0-ci-cd-workflows-and-pgvector-for-prisma-postgres
- Prisma Postgres extensions: https://www.prisma.io/docs/postgres/database/postgres-extensions
- Drizzle, vector similarity search: https://orm.drizzle.team/docs/guides/vector-similarity-search
- Anthropic, embeddings guidance: https://platform.claude.com/docs/en/build-with-claude/embeddings
- Amazon OpenSearch Service pricing: https://aws.amazon.com/opensearch-service/pricing/
- Amazon OpenSearch Serverless NextGen, generally available May 2026: https://aws.amazon.com/about-aws/whats-new/2026/05/amazon-opensearch-serverless-next-generation-generally-available/
- Amazon Bedrock pricing: https://aws.amazon.com/bedrock/pricing/
- NCBI, what is the PMC open access subset: https://support.nlm.nih.gov/kbArticle/?pn=KA-03253
- PMC open access list and bulk access tools: https://pmc.ncbi.nlm.nih.gov/tools/openftlist/
- PMC FTP service, ending August 2026: https://pmc.ncbi.nlm.nih.gov/tools/ftp/
- Becker, Iruretagoiena Urbieta, Schöffl (2025), synovial chondromatosis in sport climbers fingers, CC BY: https://pmc.ncbi.nlm.nih.gov/articles/PMC11876161/
- Schöffl, Lutter et al (2025), treatment algorithm for capsulitis of the fingers in rock climbers: https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2025.1497110/full
