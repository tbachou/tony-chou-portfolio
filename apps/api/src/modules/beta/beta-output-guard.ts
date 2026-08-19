/**
 * Beta's output-side safety layer (spec 0005 guardrails child), the Beta
 * analogue of conversation/ownership-guard.ts: deterministic rules over a
 * model's COMPLETE output, with safe substituted copy on failure.
 *
 * Same honest limitation as the ownership guard: this is a blocklist, not
 * language understanding. Each rule catches the obvious phrasing of its
 * item, not every way a model could imply the same thing.
 *
 * Every rule transcribes a line that already ships in skills/drafter.md or
 * skills/coach.md. A rule may encode what those files EXPLICITLY forbid or
 * EXPLICITLY require; it may not encode a view about what is clinically
 * valid. Each rule below names its source line.
 */

import { FULL_CRIMP_PATTERN, normalizeForMatch } from './beta.constants';

// ---------------------------------------------------------------------------
// The plan shape the drafter produces, and how code (never the model) turns
// its structured dose into prose.
// ---------------------------------------------------------------------------

/**
 * Structured dose. Integers rather than prose so "some" and "a few" are not
 * representable — transcribing drafter.md's "Every number you output (sets,
 * reps, weeks, grades) must be concrete, not a range like 'some'" — and so
 * the coach never receives a dose as editable text it could alter.
 */
export type DoseSpec = {
  sets: number;
  reps: number;
  holdSeconds?: number;
  frequencyPerWeek: number;
};

export type PlanExercise = {
  /**
   * Free string, deliberately. There is NO allowlist of permitted exercises:
   * an allowlist would need to know everything that is clinically valid, and
   * drafter.md's injury lists are illustrative rather than exhaustive, so
   * enumerating them would narrow the product under a fidelity label.
   */
  name: string;
  /** Constrained per request to the gear the visitor reported (layer 1). */
  equipmentUsed: string;
  dose: DoseSpec;
  notes?: string;
};

export type PlanStage = {
  /** The drafter's own reasoning, asked for before it prescribes. */
  rationale: string;
  title: string;
  timeWindow: string;
  exercises: PlanExercise[];
  allowedClimbing: string;
  advanceWhen: string[];
};

export type DraftPlan = { stages: PlanStage[]; overallCaution?: string };

/** What the coach actually receives: dose already rendered to prose by code. */
export type CoachExercise = { name: string; dose: string; notes?: string };
export type CoachStage = {
  title: string;
  timeWindow: string;
  exercises: CoachExercise[];
  allowedClimbing: string;
  advanceWhen: string[];
};
export type CoachPlan = { stages: CoachStage[]; overallCaution?: string };

function renderFrequency(perWeek: number): string {
  if (perWeek === 1) return 'once a week';
  if (perWeek === 2) return 'twice a week';
  return `${perWeek} times a week`;
}

/**
 * Renders a structured dose into the prose the coach is handed. Done in code
 * so the coach is never in a position to alter a dose number: it receives a
 * finished string, not fields.
 */
export function renderDose(dose: DoseSpec): string {
  const parts = [
    `${dose.sets} ${dose.sets === 1 ? 'set' : 'sets'} of ${dose.reps}`,
  ];
  if (dose.holdSeconds !== undefined) {
    parts.push(
      `holding ${dose.holdSeconds} ${dose.holdSeconds === 1 ? 'second' : 'seconds'}`,
    );
  }
  parts.push(renderFrequency(dose.frequencyPerWeek));
  return parts.join(', ');
}

/**
 * The drafter's plan reduced to what the coach is allowed to see: dose as
 * prose, and without `rationale` or `equipmentUsed`, which are drafting-time
 * scaffolding. coach.md forbids adding anything "beyond what the JSON
 * contains", so the JSON is kept to exactly what should appear in the plan.
 */
export function toCoachPlan(plan: DraftPlan): CoachPlan {
  return {
    stages: plan.stages.map((stage) => ({
      title: stage.title,
      timeWindow: stage.timeWindow,
      exercises: stage.exercises.map((exercise) => ({
        name: exercise.name,
        dose: renderDose(exercise.dose),
        ...(exercise.notes !== undefined && { notes: exercise.notes }),
      })),
      allowedClimbing: stage.allowedClimbing,
      advanceWhen: [...stage.advanceWhen],
    })),
    ...(plan.overallCaution !== undefined && {
      overallCaution: plan.overallCaution,
    }),
  };
}

// ---------------------------------------------------------------------------
// Layer 2: the deterministic guard over the coach's complete output.
//
// The rules lean on a fact the coach is contracted to provide: its output
// format is fixed (coach.md "Output format"), with headingless opening and
// closing paragraphs, one `## Stage n:` heading per stage, and the labels
// `**When:**`, `**Climbing:**`, `**Do this:**`, `**Move on when:**`. That
// lets several rules be scoped to the region where they apply rather than run
// over the whole document, which is what keeps their false positive rates
// down: a document-wide full-crimp match would fire on the skill files' own
// safety language ("No crimping of any kind").
// ---------------------------------------------------------------------------

export type GuardResult = { ok: true } | { ok: false; reason: string };

const STAGE_HEADING = /^##\s+Stage\s+(\d+)\s*:/i;

const COACH_LABELS = [
  '**When:**',
  '**Climbing:**',
  '**Do this:**',
  '**Move on when:**',
] as const;

/**
 * R1 — contraindicated pain phrasing.
 *
 * Transcribes coach.md's "Do not add new advice, exercises, warnings, or
 * timelines beyond what the JSON contains" read against drafter.md's pain
 * traffic light, which caps loading at "pain during activity no more than
 * about 3 out of 10, settling by the next morning". "Push through the pain"
 * is advice the JSON never contains and directly contradicts that criterion.
 *
 * Each entry pairs pain with a push-or-ignore verb, or is itself such a
 * phrase, so the rule never keys on the word "pain" alone. That is what lets
 * the mandated traffic-light language through: "no more than about 3 out of
 * 10", "settling by the next morning", "some discomfort is normal and
 * expected", "'no pain' is not required".
 */
export const CONTRAINDICATED_PAIN_PHRASES = [
  'push through the pain',
  'push through it',
  'work through the pain',
  'work through it',
  'no pain no gain',
  'ignore the pain',
  'tough it out',
  'power through',
  'pain is nothing to worry about',
] as const;

/**
 * R5 — medication naming. Transcribes drafter.md's hard rule "Do not
 * diagnose, name medications, or promise recovery timelines as fact."
 * Drug naming is outside the product's contract entirely, so a firing here
 * is correct behavior rather than a false positive.
 */
export const MEDICATION_NAMES = [
  'ibuprofen',
  'naproxen',
  'advil',
  'aleve',
  'tylenol',
  'paracetamol',
  'acetaminophen',
  'cortisone',
  'corticosteroid',
  'voltaren',
  'diclofenac',
  'nsaid',
  'anti inflammatories',
] as const;

/**
 * R6 — diagnosis asserted as fact. Transcribes drafter.md's "Do not
 * diagnose". Deliberately narrow constructions rather than the word
 * "diagnosis", so the visitor's own selected injury label ("your finger
 * pulley strain", "climber's elbow") and general education ("pulley strains
 * usually", "this kind of injury often") all pass. The weakest rule in the
 * table and the one most likely to need loosening once a corpus run exists.
 */
export const DIAGNOSIS_PHRASES = [
  'you have torn',
  'you have a grade',
  'you have ruptured',
  'is torn',
  'diagnosed with',
  'this is definitely a',
] as const;

/**
 * R7 — recovery promised as fact. Transcribes drafter.md's "promise recovery
 * timelines as fact" prohibition and coach.md's "say 'climbers usually find'
 * rather than 'you will'". Keyed to the promise constructions only, so the
 * stage time windows (explicitly guidance), "climbers usually find", "most
 * climbers", "typically", "you will feel" and "you will notice" all pass.
 */
export const RECOVERY_PROMISE_PHRASES = [
  'you will be back',
  'you will be climbing again',
  'you will fully recover',
  'guaranteed',
  'you will be healed',
] as const;

/** Common words R8's key-term check should not treat as distinctive. */
const CAUTION_STOPWORDS = new Set([
  'about',
  'after',
  'again',
  'alone',
  'along',
  'anything',
  'because',
  'been',
  'before',
  'being',
  'between',
  'could',
  'does',
  'doing',
  'during',
  'every',
  'from',
  'have',
  'having',
  'into',
  'itself',
  'might',
  'other',
  'over',
  'really',
  'should',
  'since',
  'some',
  'still',
  'such',
  'than',
  'that',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'thing',
  'this',
  'those',
  'through',
  'under',
  'until',
  'very',
  'what',
  'when',
  'where',
  'which',
  'while',
  'will',
  'with',
  'within',
  'without',
  'would',
  'your',
  'yours',
]);

/**
 * Fraction of a caution's distinctive terms that must survive into the
 * closing for R8 to pass. A mechanical allowance for rephrasing — which the
 * coach is supposed to do — not a judgement about wording. Terms match on a
 * five-character prefix so "assessment" also matches "assessed".
 */
const CAUTION_TERM_THRESHOLD = 0.5;
const CAUTION_TERM_PREFIX = 5;

export type CoachSections = {
  /** Lines before the first stage heading. Not checked by R3 or R4. */
  opening: string[];
  stages: { number: number | null; lines: string[] }[];
  /** Trailing headingless lines of the final stage section. */
  closing: string[];
};

/**
 * Splits the coach's output the way coach.md contracts it and the way
 * PlanDisplay parses it: '## Stage n:' headings start sections, and the final
 * section's trailing plain paragraphs are lifted out as the closing.
 */
export function splitCoachSections(text: string): CoachSections {
  const opening: string[] = [];
  const stages: { number: number | null; lines: string[] }[] = [];

  for (const line of text.split('\n')) {
    if (line.trimStart().startsWith('## ')) {
      const heading = STAGE_HEADING.exec(line.trim());
      stages.push({ number: heading ? Number(heading[1]) : null, lines: [] });
    } else if (stages.length === 0) {
      opening.push(line);
    } else {
      stages[stages.length - 1].lines.push(line);
    }
  }

  const closing: string[] = [];
  const last = stages[stages.length - 1];
  if (last) {
    while (last.lines.length > 0) {
      const line = last.lines[last.lines.length - 1];
      const trimmed = line.trimStart();
      if (trimmed.startsWith('- ') || trimmed.startsWith('**')) break;
      closing.unshift(line);
      last.lines.pop();
    }
  }

  return { opening, stages, closing };
}

/** The `- ` bullets that sit under a `**Do this:**` label within one stage. */
function prescriptionLines(stageLines: string[]): string[] {
  const bullets: string[] = [];
  let inDoThis = false;
  for (const line of stageLines) {
    const trimmed = line.trimStart();
    if (trimmed.startsWith('**')) {
      inDoThis = trimmed.startsWith('**Do this:**');
      continue;
    }
    if (inDoThis && trimmed.startsWith('- ')) bullets.push(trimmed.slice(2));
  }
  return bullets;
}

function numericTokens(text: string): string[] {
  return text.match(/\d+(?:\.\d+)?/g) ?? [];
}

function cautionKeyTerms(caution: string): string[] {
  return Array.from(
    new Set(
      normalizeForMatch(caution)
        .split(' ')
        .map((word) => word.replace(/[^a-z0-9]/g, ''))
        .filter((word) => word.length >= 5 && !CAUTION_STOPWORDS.has(word)),
    ),
  );
}

/** The parts of a request the guard needs; a DTO satisfies it structurally. */
export type GuardInput = { injuryArea: string; painBehavior: string };

/**
 * The Beta analogue of `evaluateTonyResponse`. Runs over the coach's COMPLETE
 * output, so the caller must buffer before calling it.
 *
 * `reason` names the rule and, where a blocklist matched, the blocklist phrase
 * — which is one of our own constants, never visitor or model text. Nothing
 * here returns matched output to a caller that logs it.
 */
export function evaluateCoachOutput(
  text: string,
  plan: DraftPlan,
  input: GuardInput,
): GuardResult {
  const normalized = normalizeForMatch(text);
  const sections = splitCoachSections(text);
  const coachPlan = toCoachPlan(plan);

  // R1 / R5 / R6 / R7: blocklists over the whole document.
  const blocklists = [
    ['R1 contraindicated pain phrasing', CONTRAINDICATED_PAIN_PHRASES],
    ['R5 medication naming', MEDICATION_NAMES],
    ['R6 diagnosis asserted as fact', DIAGNOSIS_PHRASES],
    ['R7 recovery promised as fact', RECOVERY_PROMISE_PHRASES],
  ] as const;
  for (const [rule, phrases] of blocklists) {
    for (const phrase of phrases) {
      if (normalized.includes(phrase)) {
        return { ok: false, reason: `${rule}: "${phrase}"` };
      }
    }
  }

  // R2: full-crimp programming, scoped to `**Do this:**` bullets. Scoped to
  // finger_pulley as well, because "Never program full-crimp training" lives
  // under drafter.md's finger_pulley section; applying it to other injuries
  // would assert something the skill file does not say. Layer 1 already
  // rejects a drafter plan naming full crimp, so a hit here means the COACH
  // introduced it — which is the only thing this rule is left to catch.
  if (input.injuryArea === 'finger_pulley') {
    for (const stage of sections.stages) {
      for (const bullet of prescriptionLines(stage.lines)) {
        if (normalizeForMatch(bullet).includes(FULL_CRIMP_PATTERN)) {
          return {
            ok: false,
            reason: 'R2 full-crimp programming in a prescription line',
          };
        }
      }
    }
  }

  // R4: structural conformance. Transcribes coach.md's "Do not add, remove,
  // merge, or reorder stages or exercises" and its Output format block. Run
  // before R3 so a malformed document reports the structural failure rather
  // than a confusing numeric one.
  if (sections.stages.length !== coachPlan.stages.length) {
    return {
      ok: false,
      reason: `R4 stage count: ${sections.stages.length} headings for ${coachPlan.stages.length} stages`,
    };
  }
  for (let i = 0; i < sections.stages.length; i += 1) {
    const section = sections.stages[i];
    if (section.number !== i + 1) {
      return {
        ok: false,
        reason: `R4 stage order: heading ${section.number ?? 'unnumbered'} at position ${i + 1}`,
      };
    }
    const body = section.lines.join('\n');
    for (const label of COACH_LABELS) {
      if (!body.includes(label)) {
        return { ok: false, reason: `R4 missing ${label} in stage ${i + 1}` };
      }
    }
    const bullets = prescriptionLines(section.lines);
    const expected = coachPlan.stages[i].exercises.length;
    if (bullets.length !== expected) {
      return {
        ok: false,
        reason: `R4 exercise count: ${bullets.length} bullets for ${expected} exercises in stage ${i + 1}`,
      };
    }
  }

  // R3: numeric fidelity. Transcribes coach.md's "Keep every number exactly
  // as drafted: sets, reps, weeks, grades, frequencies. Never change, round,
  // or omit one." Scoped per stage section; the opening and closing
  // paragraphs are not checked, and the stage heading's own number is allowed
  // by construction. Every other number the coach legitimately writes came
  // from the drafter, so it is present in the allowed set by construction.
  for (let i = 0; i < sections.stages.length; i += 1) {
    const allowed = new Set<string>([
      ...numericTokens(JSON.stringify(coachPlan.stages[i])),
      // The drafter's raw dose integers too, so a coach writing "1 time a
      // week" where code rendered "once a week" is not a false positive.
      ...plan.stages[i].exercises.flatMap((exercise) =>
        [
          exercise.dose.sets,
          exercise.dose.reps,
          exercise.dose.holdSeconds,
          exercise.dose.frequencyPerWeek,
        ]
          .filter((value): value is number => value !== undefined)
          .map(String),
      ),
      String(i + 1),
    ]);
    const scanned = [
      `## Stage ${i + 1}:`,
      ...sections.stages[i].lines,
    ].join('\n');
    for (const token of numericTokens(scanned)) {
      if (!allowed.has(token)) {
        return {
          ok: false,
          reason: `R3 numeric fidelity: stage ${i + 1} carries a number the drafter did not`,
        };
      }
    }
  }

  // R8: the caution drafter.md calls MANDATORY for this pain behavior must
  // survive into the closing ("a MANDATORY `overallCaution` (never omit it
  // for this pain behavior)"; coach.md's closing carries "the drafted
  // `overallCaution` if present"). Checks the caution's distinctive terms,
  // not an exact string, because the coach is supposed to rephrase.
  if (input.painBehavior === 'constant_even_at_rest' && plan.overallCaution) {
    const terms = cautionKeyTerms(plan.overallCaution);
    if (terms.length > 0) {
      const closing = normalizeForMatch(sections.closing.join(' '));
      const carried = terms.filter((term) =>
        closing.includes(term.slice(0, CAUTION_TERM_PREFIX)),
      );
      if (carried.length / terms.length < CAUTION_TERM_THRESHOLD) {
        return {
          ok: false,
          reason: 'R8 mandatory caution not carried into the closing',
        };
      }
    }
  }

  return { ok: true };
}

// ---------------------------------------------------------------------------
// The fallback: a complete plan rendered from the validated drafter object.
// ---------------------------------------------------------------------------

/**
 * Renders the plan deterministically when the guard rejects the coach's
 * prose. Only safe because layer 1's checks ran on the drafter's output
 * first: the plan object was schema-constrained and validated, so the
 * fallback ships content that already passed every prohibition. Only the
 * warmth is lost.
 *
 * It manufactures no clinical content. The only sentences not drawn from the
 * plan object are connective, and the closing's referral line transcribes
 * coach.md's own instruction ("a reminder that if anything gets worse instead
 * of better, a physical therapist or sports medicine doctor is the right next
 * step"). The substitution is silent by design — announcing it would alarm
 * without informing.
 *
 * The output follows coach.md's format exactly, so PlanDisplay renders it
 * into the same stage cards, with the same educational framing element above.
 */
export function renderPlanFallback(plan: DraftPlan): string {
  const parts: string[] = [
    // Deliberately avoids "work through it": that is an R1 blocklist phrase,
    // and the fallback must never trip the guard it exists to satisfy.
    'Here is your staged plan. Take it one stage at a time, and let the "move on when" points decide when you are ready for the next one.',
  ];

  plan.stages.forEach((stage, index) => {
    parts.push(
      [
        `## Stage ${index + 1}: ${stage.title}`,
        '',
        `**When:** ${stage.timeWindow}`,
        '',
        `**Climbing:** ${stage.allowedClimbing}`,
        '',
        '**Do this:**',
        ...stage.exercises.map(
          (exercise) =>
            `- ${exercise.name} — ${renderDose(exercise.dose)}${
              exercise.notes ? ` — ${exercise.notes}` : ''
            }`,
        ),
        '',
        '**Move on when:**',
        ...stage.advanceWhen.map((criterion) => `- ${criterion}`),
      ].join('\n'),
    );
  });

  const closing = [
    'Repeating a stage is normal; let your symptoms set the pace.',
  ];
  if (plan.overallCaution) closing.push(plan.overallCaution);
  closing.push(
    'If anything gets worse instead of better, a physical therapist or sports medicine doctor is the right next step.',
  );
  parts.push(closing.join(' '));

  return parts.join('\n\n');
}

// ---------------------------------------------------------------------------
// Mode flag. The only new configuration in this child.
// ---------------------------------------------------------------------------

export type GuardMode = 'off' | 'shadow' | 'enforce';

/**
 * `off` (default) is byte-for-byte today's behavior: the coach streams live
 * and the guard never runs (AC-G12). `shadow` buffers, evaluates, counts and
 * logs but still shows the coach's prose. `enforce` substitutes the rendered
 * plan. Read per request so the mode can be flipped by an env change alone.
 */
export function resolveGuardMode(): GuardMode {
  const raw = process.env.BETA_OUTPUT_GUARD_MODE;
  return raw === 'shadow' || raw === 'enforce' ? raw : 'off';
}
