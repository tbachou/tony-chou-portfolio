# 0012. Grounded portfolio agent — rationale

## Context

The interview simulator (spec 0002) is the portfolio centerpiece, and spec 0011 gave it a scored eval suite. The next planned feature was visitor steering, and its full design interview ran on 2026-08-29. Before the spec was written, Tony raised the real problem: almost nobody drives the live simulator, so building more visitor facing capability onto it felt like effort with no audience. The question became what the machinery under that feature (context engineering, structured generation, retrieval, screening) should be built onto instead.

Three forces shaped the answer. First, the audience that actually exists: engineers who evaluate Tony read repos, readmes, and writeups; they rarely drive demos. Evidence they can check beats features they will not touch. Second, the course material rule: Tony wants builds in this area to apply the disciplines from `~/source/ai-engineering-fundamentals` (lessons 06 context engineering, 07 tool use, 08 retrieval, 09 generated UI, 10 human in the loop) and `~/source/agents-v2`, and the course's own method is one app improved in order, with an eval delta proving each step. Third, the corpus lesson from spec 0008: retrieval work over third party licensed content dies on licensing arithmetic, while content Tony owns has no such wall and is genuinely unknown to the model.

Not deciding meant either building the steering feature for an absent audience or abandoning finished design work.

One premise of this umbrella is not yet true. The reframe assumes the measured record is readable by the people it is meant to convince, and the repo is private as of 2026-08-29 (spec 0011's rationale asserts the opposite and was corrected). Going public was recommended and the blocking risk was audited clean: no key or real `.env` has ever been committed on any branch. The decision itself is Tony's, is not made here, and is tracked on phase two. Until it is made, this umbrella improves the product on the merits and banks the evidence; it does not yet deliver the audience.

## Options considered

### Option 1: One surface, improved up the course ladder with measured deltas

The existing simulator becomes the subject of phased, eval measured improvements in course order, with the scoreboard history and writeups as the audience facing product. Steering and free text land as later phases.

**Pros**:
- Preserves every settled steering decision and the original phase split (guided first, free text separately decided).
- Matches the course pedagogy exactly; each phase generates a checkable artifact.
- The corpus is fully owned, so retrieval adds real knowledge with no licence risk.

**Cons**:
- Two eval runs plus a writeup tax every phase, in money and time.
- The live surface still has few visitors; the bet is that the written record, not the demo, carries the value.

### Option 2: Mock interview trainer for Tony

Flip the simulator: the AI interviews Tony, he answers in free text, the 0011 judges score him. A real daily user during an active search.

**Pros**:
- Directly serves the job search; free text is natural in a private tool.

**Cons**:
- Tony judged it too narrow; the machinery deserves broader application.
- Audience of one, and the visitor facing surface stops improving.

### Option 3: Extract an open source toolkit

Pull the guard, judges, eval harness, and screening into a published npm package, with the portfolio as reference deployment.

**Pros**:
- The broadest application by definition, and a pinned repo is what engineers actually click.

**Cons**:
- Extracting before the machinery has a public measurement history yields a speculative library; sequenced after Option 1 it becomes an extraction of proven parts. Deferred, not rejected.

### Option 4: Retrieval and human in the loop work on Carryover

Carryover has a real external audience (clinicians) and existing sign off gates that map onto lesson 10.

**Pros**:
- Real users, and human in the loop fits its existing safety design.

**Cons**:
- Clinical retrieval hits the exact licence wall that killed spec 0008; the usable corpus does not exist without heavy curation through the review reporting technique. Parked.

## Rationale

Option 1 is the only shape where the course material, the finished steering interview, the 0011 instrument, and the audience problem all point the same way. The audience objection is answered by reframing the product: the measured record is what the real audience reads, and phase two makes it public early. The corpus force rules out Option 4 and the sequencing logic folds Option 3 in as a later extraction rather than an alternative. Option 2 failed Tony's own breadth test. Course order (context before retrieval before steering) is kept deliberately: the cheapest, most attributable delta comes first, and each later phase's measurement is uncontaminated by the previous one.

## Settled steering decisions (phase four seed, interviewed 2026-08-29)

Recorded so the phase four child spec starts from decisions, not memory. Re check each against the retrieval design before binding them.

- Steer shape: about 3 model suggested next questions per turn boundary; the visitor clicks one or lets it flow. Offered at every boundary except before the wrap up pair; TURN_PAIR_CAP stays 5.
- A chosen suggestion is asked verbatim: no interviewer model call that pair, the stored text streams out (mirrors the eval suite's injectQuestion path).
- Suggestions come from a separate small call on `claude-haiku-4-5` through a new `generateStructured` (forced tool) method on the production provider seam; unsupported under a bedrock configuration, degrading silently to the plain continue button. New `steer_options` SSE event (id and text only) before `turn_end`.
- Unsteered pairs keep the existing story cycling; a chosen steer overrides with the suggestion's tagged story. (Phase three's retrieval will likely change what "tagged story" means; this is the main re check.)
- New `SteerOption` table: id (the wire steerId), conversationId, turnIndex (the pair it targets), position 0 to 2 (unique with conversationId plus turnIndex), storyId FK, text, chosenAt nullable, createdAt. Rows keep the same lifecycle as turns.
- Redemption is strict: unknown id, wrong conversation, wrong turnIndex, or already redeemed rejects with 400 or 409 before any stream opens; the client retries unsteered.
- The request contract gains `steerId?`; steering is always a click on a server known id, never text (umbrella AC-4).
- Steering cases join the golden dataset in that phase, with a re baseline per 0011 AC-9.
