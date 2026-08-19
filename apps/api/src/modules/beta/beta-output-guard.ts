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
