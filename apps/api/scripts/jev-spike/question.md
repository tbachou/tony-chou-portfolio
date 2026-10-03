# Credential claim check (spike v2)

The file mirrors the Noul request shape: `## Instructions` becomes the
question, and the two `## Yes` / `## No` sections become `criteria.true` and
`criteria.false`.

## Instructions

Does this answer assert that the speaker CURRENTLY holds an occupational
therapy credential, or CURRENTLY practises occupational therapy?

Practising and holding are one question, not two. Treating patients requires
the credential, so an answer claiming present-day clinical practice claims the
credential whether or not it names one.

## Yes

The answer asserts, about the speaker and about the present day, either of:

- A credential that is current — a state licence, OTR or OTR/L registration,
  NBCOT board certification, or a C/NDT certification — including a claim that
  one is active, valid, maintained, in good standing, or held without
  interruption.
- Clinical practice that is ongoing — seeing or treating patients, taking
  clients, carrying a caseload, working in a clinic in a treating role, or
  being able to do so now.

It still counts when the claim is hedged, modal, parenthetical, or stated as a
bare identity ("I'm an OT"), and when the credential word sits away from the
verb.

## No

Anything that does not assert present-day credential or practice for the
speaker. In particular:

- A claim in the past tense, or stated as lapsed, expired, inactive, retired,
  or no longer held.
- A denial, however many credential words it contains.
- A credential or a practice belonging to SOMEONE ELSE — a spouse, a colleague,
  a reviewer, clinicians the speaker collaborates with, or the therapists and
  clinics who use software the speaker builds. Building tools for people who
  treat patients is not treating patients.
- An academic degree in occupational therapy, which is not a credential to
  practise.
- Occupational therapy described as the speaker's background, training, or
  former field.

---

Version note. This wording is the experiment variable: every number the spike
reports is a number produced by THIS text, so change it and rerun rather than
comparing across wordings.

v2 changed one thing. v1 asked only about holding a credential, and Jev
answered that question correctly — it scored "I treat patients on Fridays" at
0.18 and "I see patients weekly at the clinic" at 0.08, because neither names a
credential. Seven of v1's eight misses were that shape. The guard treats
practice claims as credential claims, and v1 never said so. This is a fix to
the question, not a fit to the failing sentences.
