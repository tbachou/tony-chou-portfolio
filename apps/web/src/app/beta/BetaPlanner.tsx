'use client';

import { useEffect, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  BetaRequestError,
  DISCIPLINES,
  INJURY_AREAS,
  EQUIPMENT_ACCESS,
  PAIN_BEHAVIORS,
  RED_FLAG_SYMPTOMS,
  SYMPTOMS,
  fetchBetaStatus,
  streamBetaPlan,
  type BetaPlanPayload,
  type BetaStage,
  type Discipline,
  type EquipmentAccess,
  type InjuryArea,
  type PainBehavior,
  type Symptom,
} from '@/lib/beta-api';
import {
  PLAN_PACING_RULE,
  PLAN_STOP_CONDITIONS,
  PLAN_STOP_CONDITIONS_HEADING,
  buildPlanClipboardText,
} from '@/lib/beta-copy';
import { PlanDisplay } from './PlanDisplay';

const ACK_STORAGE_KEY = 'beta-disclaimer-acknowledged-v1';

// ---------------------------------------------------------------------
// Plain-language labels for the API enum values (values themselves must
// match beta.constants.ts exactly — the server validates with IsIn).
// ---------------------------------------------------------------------

const INJURY_OPTIONS: { value: InjuryArea; label: string; hint: string }[] = [
  {
    value: 'finger_pulley',
    label: 'Finger pulley strain',
    hint: 'Pain at the base of a finger, often worst on crimps',
  },
  {
    value: 'elbow_tendinopathy',
    label: "Climber's elbow",
    hint: 'Tendon pain on the inside or outside of the elbow',
  },
  {
    value: 'shoulder_impingement',
    label: 'Shoulder impingement',
    hint: 'Pinching pain overhead or on cross-body moves',
  },
];

const SYMPTOM_LABELS: Record<Symptom, string> = {
  sudden_pop_with_swelling: 'A sudden pop, snap, or tearing feeling when it happened',
  numbness_or_tingling: 'Numbness or tingling',
  cannot_bear_weight_or_grip: 'Can’t bear weight, or can’t grip at all',
  night_pain: 'Pain that wakes me at night',
  pain_with_specific_holds_or_moves: 'Pain on specific holds or moves',
  pain_at_session_start_that_warms_up: 'Hurts at the start of a session, then eases',
  morning_stiffness: 'Morning stiffness',
  mild_swelling: 'Mild swelling',
  tenderness_to_touch: 'Tender to the touch',
  weakness_or_early_fatigue: 'Weakness or early fatigue',
};

const PAIN_BEHAVIOR_LABELS: Record<PainBehavior, string> = {
  none_at_rest_hurts_under_load: 'Fine at rest, hurts under load',
  warms_up_then_fine: 'Warms up, then feels fine',
  worsens_as_session_goes_on: 'Gets worse as a session goes on',
  constant_even_at_rest: 'Constant, even at rest',
};

const DISCIPLINE_LABELS: Record<Discipline, string> = {
  bouldering: 'Bouldering',
  sport: 'Sport',
  trad: 'Trad',
  indoor_gym: 'Indoor gym',
};

const EQUIPMENT_LABELS: Record<EquipmentAccess, string> = {
  climbing_gym: 'Climbing gym',
  home_wall: 'Home wall',
  hangboard: 'Hangboard',
  resistance_bands: 'Resistance bands',
  weights: 'Weights',
  none: 'None of these',
};

const PIPELINE_STAGES: { id: BetaStage; label: string }[] = [
  { id: 'screening', label: 'Screening' },
  { id: 'drafting', label: 'Drafting' },
  { id: 'coaching', label: 'Coaching' },
];

// Batched per stage transition, never per token (AC-4).
const STAGE_ANNOUNCEMENTS: Record<BetaStage, string> = {
  screening: 'Screening your answers for warning signs.',
  drafting: 'Screening passed. Drafting your staged progression.',
  coaching: 'Turning the draft into plain language. Your plan is streaming in.',
};

const CAP_NOTICE_DEFAULT =
  'Beta caps itself at 20 plans a day so a portfolio demo can’t run away with the AI bill. Today’s budget is spent — it resets at midnight UTC. The form below stays open if you want to look around.';

const HOURLY_THROTTLE_MESSAGE =
  'You’ve hit the hourly attempt limit — Beta allows 3 attempts per hour per visitor. Take a breather and try again in a little while.';

const NETWORK_ERROR_MESSAGE =
  'Couldn’t reach the planner service. It runs on a small demo server that sometimes naps between visitors — give it a few seconds and try again.';

type Phase = 'idle' | 'running' | 'done' | 'red_flag' | 'error';

// ---------------------------------------------------------------------
// Client-side validation. Browser-native bubbles are transient, show one
// error at a time, cannot be recalled, and frequently render outside the
// viewport at 200% zoom — so the form opts out with noValidate and owns
// its own errors. The `required` / `min` / `max` attributes stay: they
// still map to aria-required and describe the control to assistive tech.
// ---------------------------------------------------------------------

type FieldName =
  | 'injuryArea'
  | 'onsetWeeks'
  | 'painBehavior'
  | 'grade'
  | 'discipline'
  | 'sessionsPerWeek';

// DOM order, so the error summary reads the form top to bottom.
const FIELD_ORDER: FieldName[] = [
  'injuryArea',
  'onsetWeeks',
  'painBehavior',
  'grade',
  'discipline',
  'sessionsPerWeek',
];

// Where an error-summary link sends focus. Radio groups have no single
// control, so the link targets the first option in the group.
const FIELD_ANCHORS: Record<FieldName, string> = {
  injuryArea: `beta-injury-${INJURY_OPTIONS[0].value}`,
  onsetWeeks: 'beta-onset',
  painBehavior: `beta-pain-${PAIN_BEHAVIORS[0]}`,
  grade: 'beta-grade',
  discipline: `beta-discipline-${DISCIPLINES[0]}`,
  sessionsPerWeek: 'beta-sessions',
};

const GRADE_PATTERN = /^[A-Za-z0-9 .+/-]+$/;

/**
 * Every rule the form enforces, in one place. The values are the api's enum
 * values and the server re-validates all of them with IsIn (spec 0004) —
 * this schema is the first gate, never the only one.
 *
 * The two numeric answers stay strings: their inputs are text-like, an empty
 * box has to stay distinguishable from a deliberate zero, and Number('') is
 * 0. The three required choices have no default, so an untouched group fails
 * its enum and reports the sentence written here rather than "invalid
 * option".
 */
const plannerSchema = z.object({
  injuryArea: z.enum(INJURY_AREAS, { error: 'Choose the area that hurts.' }),
  onsetWeeks: z.string().superRefine((value, ctx) => {
    const weeks = value.trim();
    if (weeks === '') {
      ctx.addIssue({ code: 'custom', message: 'Enter how many weeks ago it started.' });
      return;
    }
    const parsed = Number(weeks);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 520) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a whole number of weeks between 0 and 520.',
      });
    }
  }),
  symptoms: z.array(z.enum(SYMPTOMS)),
  painBehavior: z.enum(PAIN_BEHAVIORS, {
    error: 'Choose the pattern that best fits your pain.',
  }),
  grade: z.string().superRefine((value, ctx) => {
    const entered = value.trim();
    if (entered === '') {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter the grade you were climbing before the injury.',
      });
      return;
    }
    if (!GRADE_PATTERN.test(entered)) {
      ctx.addIssue({
        code: 'custom',
        message: 'Use a plain climbing grade like V5, 5.11a, or 6b+.',
      });
    }
  }),
  discipline: z.enum(DISCIPLINES, { error: 'Choose your main discipline.' }),
  goals: z.string(),
  sessionsPerWeek: z.string().superRefine((value, ctx) => {
    const sessions = value.trim();
    if (sessions === '') return;
    const parsed = Number(sessions);
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 14) {
      ctx.addIssue({
        code: 'custom',
        message: 'Enter a whole number of sessions between 0 and 14, or leave this blank.',
      });
    }
  }),
  equipment: z.array(z.enum(EQUIPMENT_ACCESS)),
});

type PlannerValues = z.infer<typeof plannerSchema>;

function errorId(field: FieldName) {
  return `beta-error-${field}`;
}

function describedBy(...ids: (string | false | undefined)[]) {
  return ids.filter(Boolean).join(' ') || undefined;
}

/** Persistent, per-control error text. Never colour alone: it carries an
 *  icon and bold weight too, and the control gets aria-invalid. */
function FieldError({ field, message }: { field: FieldName; message?: string }) {
  if (!message) return null;
  return (
    <p id={errorId(field)} className="beta-field-error">
      <span aria-hidden="true" className="beta-field-error-mark">
        !
      </span>
      <span>{message}</span>
    </p>
  );
}

/**
 * Move focus to a container the visitor cannot reach with Tab.
 *
 * The tabindex is applied for the duration of the focus and removed on blur,
 * rather than living in the markup. A permanent tabindex="-1" makes the
 * container the nearest focusable ancestor of everything inside it, and a
 * browser that declines to focus the control that was clicked focuses that
 * ancestor instead. Safari does exactly that for radios and checkboxes, so
 * every click on a choice in the form put focus on the <form> and lit the
 * whole card with the .beta-focus-target:focus ring.
 *
 * Focus still has to be visible wherever script puts it, which is why that
 * ring keys off :focus rather than :focus-visible — programmatic focus does
 * not match :focus-visible. Keeping the container unfocusable until the
 * moment it is focused is what stops a click from borrowing that ring.
 */
function focusContainer(el: HTMLElement | null, options?: FocusOptions) {
  if (!el) return;
  el.setAttribute('tabindex', '-1');
  el.addEventListener('blur', () => el.removeAttribute('tabindex'), { once: true });
  el.focus(options);
}

export function BetaPlanner() {
  // Disclaimer gate (AC-3). Read in useEffect to stay hydration-safe.
  const [acknowledged, setAcknowledged] = useState(false);

  // Status pre-check (AC-5): non-null means the global cap is spent.
  const [capNotice, setCapNotice] = useState<string | null>(null);

  // Pipeline / result state (AC-4, AC-2, AC-8).
  const [phase, setPhase] = useState<Phase>('idle');
  const [planCopied, setPlanCopied] = useState(false);
  const copiedTimerRef = useRef<number | null>(null);

  // The one path that cannot call clearCopied itself.
  useEffect(
    () => () => {
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    },
    [],
  );
  const [stage, setStage] = useState<BetaStage | null>(null);
  const [planText, setPlanText] = useState('');
  const [redFlagMessage, setRedFlagMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'limit' | 'failure' | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Form state. shouldFocusError is off because a failed submit sends focus
  // to the error summary instead of the first bad field — the summary lists
  // everything that is wrong, which one field cannot.
  const {
    register,
    handleSubmit: submitWithValidation,
    control,
    formState: { errors, submitCount },
  } = useForm<PlannerValues>({
    resolver: zodResolver(plannerSchema),
    shouldFocusError: false,
    defaultValues: {
      onsetWeeks: '',
      symptoms: [],
      grade: '',
      goals: '',
      sessionsPerWeek: '',
      equipment: [],
    },
  });

  // Only the live character counter reads a value during typing. useWatch
  // rather than watch(), which returns a function React Compiler cannot
  // memoize safely.
  const goals = useWatch({ control, name: 'goals' });

  const runIdRef = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);
  const redFlagRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  // Only true when the visitor just dismissed the gate or reset the result —
  // never when the gate is skipped from localStorage on load, which must not
  // steal focus from wherever the visitor actually is on the page.
  const focusFormRef = useRef(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(ACK_STORAGE_KEY) === 'true') setAcknowledged(true);
    } catch {
      // Storage unavailable (private mode etc.) — the gate simply shows.
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchBetaStatus()
      .then((status) => {
        if (!cancelled && !status.available) setCapNotice(CAP_NOTICE_DEFAULT);
      })
      .catch(() => {
        // Status check is best-effort; submit-time errors handle the rest.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A terminal safety state must never be screen-only: the card carries the
  // actionable half (which professional to see; that the plan is truncated),
  // while the sr-only line only summarises. Focus is the reliable delivery
  // path — a live region inserted into the DOM already populated is announced
  // inconsistently — so the roles below are the backstop, not the mechanism.
  useEffect(() => {
    if (phase === 'red_flag') focusContainer(redFlagRef.current);
  }, [phase]);

  useEffect(() => {
    if (phase === 'error' && errorMessage) focusContainer(errorRef.current);
  }, [phase, errorMessage]);

  // Dismissing the gate swaps it for the form. Without this the button
  // appears to do nothing to anyone not watching the screen: focus falls to
  // <body> and nothing is announced.
  useEffect(() => {
    if (acknowledged && focusFormRef.current) {
      focusFormRef.current = false;
      focusContainer(formRef.current);
    }
  }, [acknowledged]);

  function acknowledge() {
    focusFormRef.current = true;
    setAcknowledged(true);
    try {
      localStorage.setItem(ACK_STORAGE_KEY, 'true');
    } catch {
      // Best effort: this visit is unlocked either way.
    }
  }

  // A failed submit puts focus on the summary, so the visitor hears what is
  // wrong and can jump straight to any of it. Keyed on submitCount rather
  // than on the errors themselves: this has to fire once per attempt, not
  // again every time the visitor clears one of the errors by typing. On a
  // clean submit the summary is not rendered and focusContainer no-ops.
  useEffect(() => {
    if (submitCount > 0) focusContainer(errorSummaryRef.current);
  }, [submitCount]);

  /**
   * Copies the plan the visitor is looking at, WITH the context the screen
   * gives it: `buildPlanClipboardText` prepends the educational framing and
   * appends the stop conditions. Copying `planText` alone produced a bare
   * protocol with neither, which is the artifact AC-G14 exists to prevent.
   *
   * Entirely client side: the text is already rendered, so nothing is
   * requested and nothing is sent.
   */
  async function copyPlan() {
    try {
      await navigator.clipboard.writeText(buildPlanClipboardText(planText));
      setPlanCopied(true);
      // Held in a ref and cleared first, so a second copy gets its own full
      // confirmation instead of being cut short by the previous timer, and so
      // a reset cannot leave "Copied" showing against a plan nobody copied.
      if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
      copiedTimerRef.current = window.setTimeout(() => setPlanCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (permissions, insecure context). The
      // plan is still on screen and selectable, so this does not warrant an
      // error state; leaving the label unchanged says "nothing happened".
    }
  }

  /** Clears any pending "Copied" confirmation. */
  function clearCopied() {
    if (copiedTimerRef.current) window.clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = null;
    setPlanCopied(false);
  }

  function resetResult() {
    clearCopied();
    runIdRef.current += 1;
    setPhase('idle');
    setStage(null);
    setPlanText('');
    setRedFlagMessage(null);
    setErrorMessage(null);
    setErrorKind(null);
    setAnnouncement('');
    // "Start over" unmounts the card its own button lives in, so move focus
    // back to the form before that happens rather than letting it drop.
    focusContainer(formRef.current);
  }

  function scrollToResult() {
    const reduceMotion =
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    requestAnimationFrame(() => {
      resultRef.current?.scrollIntoView({
        behavior: reduceMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
  }

  async function handleValid(values: PlannerValues) {
    if (phase === 'running' || capNotice) return;

    const payload: BetaPlanPayload = {
      injuryArea: values.injuryArea,
      onsetWeeksAgo: Number(values.onsetWeeks.trim()),
      symptoms: values.symptoms,
      painBehavior: values.painBehavior,
      preInjuryGrade: values.grade.trim(),
      discipline: values.discipline,
    };
    const trimmedGoals = values.goals.trim();
    if (trimmedGoals) payload.goals = trimmedGoals;
    const sessions = values.sessionsPerWeek.trim();
    if (sessions !== '') payload.sessionsPerWeek = Number(sessions);
    if (values.equipment.length > 0) payload.equipmentAccess = values.equipment;

    // Move focus before the render that disables the fieldset, otherwise the
    // focused submit button is disabled out from under the visitor and focus
    // drops to <body>. Disabling the button on its own would do the same, so
    // excluding it from the fieldset would not have fixed this — and the
    // viewport is about to scroll here anyway, which keeps focus and view
    // together. scrollToResult() owns the scrolling (it honours
    // prefers-reduced-motion), so focus must not scroll on its own.
    const runId = ++runIdRef.current;
    focusContainer(resultRef.current, { preventScroll: true });
    setPhase('running');
    setStage(null);
    setPlanText('');
    // Same invariant resetResult holds: a new plan must never inherit the
    // previous plan's "Copied" confirmation, nor its pending timer.
    clearCopied();
    setRedFlagMessage(null);
    setErrorMessage(null);
    setErrorKind(null);
    setAnnouncement('Sending your answers to the planner.');
    scrollToResult();

    let terminal = false;
    try {
      for await (const sse of streamBetaPlan(payload)) {
        if (runIdRef.current !== runId) return;
        switch (sse.type) {
          case 'status':
            setStage(sse.stage);
            setAnnouncement(STAGE_ANNOUNCEMENTS[sse.stage]);
            break;
          case 'plan_delta':
            setPlanText((prev) => prev + sse.text);
            break;
          case 'plan_replace':
            // The coach's prose passed the guard and replaces the rendering
            // already on screen. Not announced to screen readers: the plan
            // is unchanged in substance, so re-reading it would be noise.
            setPlanText('');
            break;
          case 'red_flag':
            terminal = true;
            setPhase('red_flag');
            setRedFlagMessage(sse.message);
            setAnnouncement(
              'Screening found a warning sign, so no plan was drafted. Please read the guidance on screen.',
            );
            break;
          case 'done':
            terminal = true;
            setPhase('done');
            setAnnouncement('Your plan is ready.');
            break;
          case 'error':
            terminal = true;
            setPhase('error');
            setErrorKind('failure');
            setErrorMessage(sse.message);
            setAnnouncement('Something went wrong while drafting. Details are on screen.');
            break;
        }
      }
      if (!terminal && runIdRef.current === runId) {
        setPhase('error');
        setErrorKind('failure');
        setErrorMessage(NETWORK_ERROR_MESSAGE);
        setAnnouncement('The connection dropped before the plan finished.');
      }
    } catch (error) {
      if (runIdRef.current !== runId) return;
      if (error instanceof BetaRequestError && error.status === 503) {
        // Global demo budget spent (AC-5): banner state, form stays browsable.
        setCapNotice(error.message);
        setPhase('idle');
        setAnnouncement('Today’s demo budget is used up. The daily cap resets at midnight UTC.');
        return;
      }
      setPhase('error');
      if (error instanceof BetaRequestError && error.status === 429) {
        setErrorKind('limit');
        setErrorMessage(
          error.message.includes('ThrottlerException') ? HOURLY_THROTTLE_MESSAGE : error.message,
        );
      } else if (error instanceof BetaRequestError) {
        setErrorKind('failure');
        setErrorMessage(error.message);
      } else {
        setErrorKind('failure');
        setErrorMessage(NETWORK_ERROR_MESSAGE);
      }
      setAnnouncement('The request could not be completed. Details are on screen.');
    }
  }

  function chipState(chip: BetaStage): 'idle' | 'active' | 'done' {
    if (phase === 'done') return 'done';
    if (phase === 'red_flag') return chip === 'screening' ? 'done' : 'idle';
    const currentIndex = stage ? PIPELINE_STAGES.findIndex((s) => s.id === stage) : -1;
    const chipIndex = PIPELINE_STAGES.findIndex((s) => s.id === chip);
    if (chipIndex < currentIndex) return 'done';
    if (chipIndex === currentIndex && phase === 'running') return 'active';
    return 'idle';
  }

  const formDisabled = phase === 'running';
  const submitBlocked = formDisabled || capNotice !== null;
  const showPipeline = phase !== 'idle';
  // A failure with plan text already on screen means the stream died mid-plan.
  const planCutOff = phase === 'error' && planText.length > 0;
  const errorCount = FIELD_ORDER.filter((field) => errors[field]).length;

  return (
    <div>
      {/* Stage announcements for screen readers — batched per stage (AC-4). */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {capNotice && (
        <div className="beta-card beta-card--accent-edge mb-6 p-5 sm:p-6">
          <h3 className="text-[length:var(--beta-text-lg)]">Today’s demo budget is used up</h3>
          <p className="mt-2 beta-measure">{capNotice}</p>
        </div>
      )}

      {!acknowledged ? (
        <div className="beta-card p-6 sm:p-8">
          <h3 className="text-[length:var(--beta-text-xl)]">Before you start</h3>
          <div className="mt-4 beta-measure space-y-3">
            <p>
              Beta drafts <strong className="font-semibold text-[color:var(--beta-ink)]">educational</strong>{' '}
              return-to-climbing plans. It is not medical advice, a diagnosis, or physical
              therapy, and it has never met your finger.
            </p>
            <ul className="space-y-2">
              {[
                'It draws on common rehab patterns for three well-studied climbing injuries — nothing here is tailored by an examination.',
                'Warning-sign symptoms are hard-blocked: if you report one, Beta stops and points you to a professional instead of drafting a plan.',
                'It assumes a healthy adult. If you are under 18 (finger pain in young climbers can involve the growth plate), pregnant, diabetic, have an inflammatory condition, recently took fluoroquinolone antibiotics, or had surgery on this limb — see a professional instead of using a generic plan.',
                'If anything is getting worse week over week, skip this tool and see a physical therapist or sports-medicine doctor.',
              ].map((item) => (
                <li key={item} className="flex gap-2.5">
                  <span
                    aria-hidden="true"
                    className="mt-[0.6em] h-1.5 w-1.5 flex-none rounded-full bg-[color:var(--beta-accent)]"
                  />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <p className="beta-hint">
              Nothing you type into the planner is stored — the form clears when you leave.
            </p>
          </div>
          <button type="button" onClick={acknowledge} className="beta-btn beta-btn-primary mt-6">
            I understand — draft me a plan
          </button>
        </div>
      ) : (
        <form
          id="beta-form"
          ref={formRef}
          aria-label="Draft your plan"
          noValidate
          onSubmit={(event) => void submitWithValidation(handleValid)(event)}
          className="beta-card beta-focus-target p-6 sm:p-8"
        >
          {/* Outside the disabled fieldset so its links stay operable. */}
          {errorCount > 0 && (
            <div
              ref={errorSummaryRef}
              className="beta-error-summary beta-focus-target mb-8"
            >
              <h3 className="text-[length:var(--beta-text-lg)]">
                {errorCount === 1
                  ? 'One thing to fix before Beta can draft your plan'
                  : `${errorCount} things to fix before Beta can draft your plan`}
              </h3>
              <ul className="mt-3 space-y-1.5">
                {FIELD_ORDER.filter((field) => errors[field]).map((field) => (
                  <li key={field}>
                    <a href={`#${FIELD_ANCHORS[field]}`} className="beta-error-summary-link">
                      {errors[field]?.message}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <fieldset disabled={formDisabled} className="beta-fieldset space-y-10">
            {/* Injury area */}
            {/* role="radiogroup" rather than the fieldset's implicit "group":
                aria-invalid is supported on radiogroup and on neither group
                nor the individual radios. The legend still names it. */}
            <fieldset
              className="beta-fieldset"
              role="radiogroup"
              aria-labelledby="beta-injury-legend"
              aria-describedby={describedBy(
                'beta-injury-hint',
                !!errors.injuryArea && errorId('injuryArea'),
              )}
              aria-invalid={errors.injuryArea ? true : undefined}
            >
              <legend id="beta-injury-legend" className="beta-legend">
                Where does it hurt?
              </legend>
              <p id="beta-injury-hint" className="beta-hint mb-4">
                Beta covers the three most common climbing injuries.
              </p>
              <div className="grid gap-3 md:grid-cols-3">
                {INJURY_OPTIONS.map((option) => (
                  <label key={option.value} className="beta-choice">
                    <input
                      id={`beta-injury-${option.value}`}
                      type="radio"
                      value={option.value}
                      required
                      {...register('injuryArea')}
                    />
                    <span>
                      <span className="block font-medium text-[color:var(--beta-ink)]">
                        {option.label}
                      </span>
                      <span className="beta-hint mt-0.5 block">{option.hint}</span>
                    </span>
                  </label>
                ))}
              </div>
              <FieldError field="injuryArea" message={errors.injuryArea?.message} />
            </fieldset>

            {/* Onset */}
            <div className="max-w-xs">
              {/* The unit goes in the accessible name, not just a describedby:
                  the whole staged progression scales from this number, and
                  min=0/max=520 happily accepts a value the visitor meant as
                  months or years. The name is announced in every mode. */}
              <label htmlFor="beta-onset" className="beta-legend">
                When did it start? <span className="sr-only">(in weeks)</span>
              </label>
              <p id="beta-onset-hint" className="beta-hint mb-4">
                Your best guess is fine.
              </p>
              <div className="flex items-center gap-3">
                <input
                  id="beta-onset"
                  className="beta-input max-w-[7rem]"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={520}
                  step={1}
                  required
                  aria-describedby={describedBy(
                    'beta-onset-hint',
                    !!errors.onsetWeeks && errorId('onsetWeeks'),
                  )}
                  aria-invalid={errors.onsetWeeks ? true : undefined}
                  placeholder="6"
                  {...register('onsetWeeks')}
                />
                <span className="text-[color:var(--beta-muted)]">weeks ago</span>
              </div>
              <FieldError field="onsetWeeks" message={errors.onsetWeeks?.message} />
            </div>

            {/* Symptoms */}
            <fieldset className="beta-fieldset" aria-describedby="beta-symptoms-hint">
              <legend className="beta-legend">What are you noticing?</legend>
              <p id="beta-symptoms-hint" className="beta-hint mb-4">
                Check everything that applies.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {SYMPTOMS.map((symptom) => {
                  const isRedFlag = RED_FLAG_SYMPTOMS.includes(symptom);
                  return (
                    <label key={symptom} className="beta-choice">
                      <input
                        type="checkbox"
                        value={symptom}
                        {...register('symptoms')}
                      />
                      <span>
                        <span className="block font-medium text-[color:var(--beta-ink)]">
                          {SYMPTOM_LABELS[symptom]}
                        </span>
                        {isRedFlag && (
                          <span className="beta-hint mt-0.5 block">
                            Warning sign — we’ll stop and point you to a pro
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}
              </div>
            </fieldset>

            {/* Pain behavior */}
            <fieldset
              className="beta-fieldset"
              role="radiogroup"
              aria-labelledby="beta-pain-legend"
              aria-describedby={describedBy(
                'beta-pain-hint',
                !!errors.painBehavior && errorId('painBehavior'),
              )}
              aria-invalid={errors.painBehavior ? true : undefined}
            >
              <legend id="beta-pain-legend" className="beta-legend">
                How does the pain behave?
              </legend>
              <p id="beta-pain-hint" className="beta-hint mb-4">
                Pick the pattern that fits best.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {PAIN_BEHAVIORS.map((behavior) => (
                  <label key={behavior} className="beta-choice beta-choice--center">
                    <input
                      id={`beta-pain-${behavior}`}
                      type="radio"
                      value={behavior}
                      required
                      {...register('painBehavior')}
                    />
                    <span className="font-medium text-[color:var(--beta-ink)]">
                      {PAIN_BEHAVIOR_LABELS[behavior]}
                    </span>
                  </label>
                ))}
              </div>
              <FieldError field="painBehavior" message={errors.painBehavior?.message} />
            </fieldset>

            {/* Grade + discipline */}
            <div className="grid gap-10 md:grid-cols-2 md:gap-6">
              <div>
                <label htmlFor="beta-grade" className="beta-legend">
                  Your grade before the injury
                </label>
                <p id="beta-grade-hint" className="beta-hint mb-4">
                  Any system works — the plan scales from it.
                </p>
                <input
                  id="beta-grade"
                  className="beta-input max-w-[14rem]"
                  type="text"
                  required
                  aria-describedby={describedBy(
                    'beta-grade-hint',
                    !!errors.grade && errorId('grade'),
                  )}
                  aria-invalid={errors.grade ? true : undefined}
                  maxLength={12}
                  pattern="[A-Za-z0-9 .+\/\-]+"
                  title="A plain climbing grade like V5, 5.11a, or 6b+"
                  placeholder="V5 or 5.11a or 6b+"
                  {...register('grade')}
                />
                <FieldError field="grade" message={errors.grade?.message} />
              </div>
              <fieldset
                className="beta-fieldset"
                role="radiogroup"
                aria-labelledby="beta-discipline-legend"
                aria-describedby={describedBy(
                  'beta-discipline-hint',
                  !!errors.discipline && errorId('discipline'),
                )}
                aria-invalid={errors.discipline ? true : undefined}
              >
                <legend id="beta-discipline-legend" className="beta-legend">
                  Main discipline
                </legend>
                <p id="beta-discipline-hint" className="beta-hint mb-4">
                  Where do you mostly climb?
                </p>
                <div className="grid grid-cols-2 gap-3">
                  {DISCIPLINES.map((d) => (
                    <label key={d} className="beta-choice beta-choice--center">
                      <input
                        id={`beta-discipline-${d}`}
                        type="radio"
                        value={d}
                        required
                        {...register('discipline')}
                      />
                      <span className="font-medium text-[color:var(--beta-ink)]">
                        {DISCIPLINE_LABELS[d]}
                      </span>
                    </label>
                  ))}
                </div>
                <FieldError field="discipline" message={errors.discipline?.message} />
              </fieldset>
            </div>

            {/* Goals */}
            <div>
              <label htmlFor="beta-goals" className="beta-legend">
                What are you working toward?{' '}
                <span className="font-normal text-[color:var(--beta-muted)]">(optional)</span>
              </label>
              <p id="beta-goals-hint" className="beta-hint mb-4">
                A project, a trip, or just climbing without thinking about it.
              </p>
              <textarea
                id="beta-goals"
                className="beta-textarea beta-measure"
                maxLength={200}
                rows={3}
                aria-describedby="beta-goals-hint beta-goals-counter"
                placeholder="Back to steep bouldering by autumn…"
                {...register('goals')}
              />
              <p id="beta-goals-counter" className="beta-hint mt-1.5">
                {goals.length}/200
              </p>
            </div>

            {/* Training context */}
            <div className="grid gap-10 md:grid-cols-2 md:gap-6">
              <div>
                <label htmlFor="beta-sessions" className="beta-legend">
                  Sessions per week{' '}
                  <span className="font-normal text-[color:var(--beta-muted)]">(optional)</span>
                </label>
                <p id="beta-sessions-hint" className="beta-hint mb-4">
                  How often you can train right now.
                </p>
                <input
                  id="beta-sessions"
                  className="beta-input max-w-[7rem]"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={14}
                  step={1}
                  aria-describedby={describedBy(
                    'beta-sessions-hint',
                    !!errors.sessionsPerWeek && errorId('sessionsPerWeek'),
                  )}
                  aria-invalid={errors.sessionsPerWeek ? true : undefined}
                  placeholder="3"
                  {...register('sessionsPerWeek')}
                />
                <FieldError field="sessionsPerWeek" message={errors.sessionsPerWeek?.message} />
              </div>
              <fieldset className="beta-fieldset" aria-describedby="beta-equipment-hint">
                <legend className="beta-legend">
                  Equipment access{' '}
                  <span className="font-normal text-[color:var(--beta-muted)]">(optional)</span>
                </legend>
                <p id="beta-equipment-hint" className="beta-hint mb-4">
                  Check what you can get to.
                </p>
                <div className="flex flex-wrap gap-2.5">
                  {EQUIPMENT_ACCESS.map((item) => (
                    <label key={item} className="beta-choice beta-choice--chip">
                      <input
                        type="checkbox"
                        value={item}
                        {...register('equipment')}
                      />
                      <span className="font-medium text-[color:var(--beta-ink)]">
                        {EQUIPMENT_LABELS[item]}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            {/* Submit */}
            <div className="border-t border-[color:var(--beta-border)] pt-6">
              <button type="submit" className="beta-btn beta-btn-primary" disabled={submitBlocked}>
                {formDisabled ? 'Drafting…' : 'Draft my plan'}
              </button>
              <p className="beta-hint mt-3 beta-measure">
                Nothing you type into the planner is stored. The first request can take a few
                extra seconds while the demo server wakes up.
              </p>
            </div>
          </fieldset>
        </form>
      )}

      {/* Results: pipeline status, streamed plan, and the unhappy states. */}
      <div
        ref={resultRef}
        role="region"
        aria-label="Plan results"
        className="beta-focus-target scroll-mt-24"
      >
        {/*
          Hidden once the plan is FINISHED, not once text exists. Three chips
          all reading "complete" above the thing the visitor came for are a
          receipt nobody asked for, so they go — but only when there is
          genuinely nothing left to wait for.
          
          Gating on `!planText` alone was wrong in the mode that ships. Under
          `enforce` the api paints the whole validated plan before the coach
          even starts, then buffers the coach for a measured p50 of 8.5s: the
          chips vanished for that entire window, leaving a complete-looking
          plan under a "Your plan" heading with no sign more was coming. At
          mode `off` it is worse, since the coach streams live and they
          vanished on the first token.
        */}
        {showPipeline && phase === 'running' && (
          <div className="mt-8">
            <h3 className="sr-only">Plan generation progress</h3>
            <ol className="flex flex-wrap items-center gap-2 p-0" aria-label="Pipeline stages">
              {PIPELINE_STAGES.map((s, i) => {
                const state = chipState(s.id);
                return (
                  <li key={s.id} className="flex items-center gap-2">
                    {i > 0 && (
                      <span
                        aria-hidden="true"
                        className="h-px w-4 bg-[color:var(--beta-border-strong)]"
                      />
                    )}
                    <span className="beta-stage-chip" data-state={state}>
                      <span className="beta-stage-dot" aria-hidden="true" />
                      {s.label}
                      {state === 'done' && <span aria-hidden="true">✓</span>}
                      <span className="sr-only">
                        {state === 'done' ? ' complete' : state === 'active' ? ' in progress' : ' waiting'}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {redFlagMessage && (
          <div
            ref={redFlagRef}
            role="status"
            className="beta-card beta-card--error-edge beta-focus-target mt-6 p-6 sm:p-8"
          >
            <h3 className="text-[length:var(--beta-text-xl)]">Let’s pause here</h3>
            <p className="mt-3 beta-measure">{redFlagMessage}</p>
            <div className="mt-5 beta-measure rounded-lg bg-[color:var(--beta-surface-2)] p-4">
              <p className="font-medium text-[color:var(--beta-ink)]">
                This tool stops here on purpose.
              </p>
              <p className="mt-1.5 text-[0.9375rem]">
                What you reported is one of the warning signs Beta always hands off to a
                professional — not because it is necessarily serious, but because it deserves real
                eyes before anyone loads it. One good assessment now beats six careful weeks of
                the wrong plan.
              </p>
            </div>
            <button type="button" onClick={resetResult} className="beta-btn beta-btn-secondary mt-6">
              Start over
            </button>
          </div>
        )}

        {planText && (
          <section aria-labelledby="plan-heading" className="mt-8">
            {/*
              A VISIBLE heading, not just an aria-label. The label alone gave
              screen readers a landmark name and sighted users nothing, so the
              plan began with a muted disclaimer and no title. `aria-labelledby`
              now points at the real heading, so both audiences get the same
              structure instead of two different ones.
            */}
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
              {/*
                h3, not h2: BetaPlanner renders inside a section whose own
                heading is the page's h2, so h2 here would make the plan a
                sibling of its container rather than a child. h3 puts it level
                with "Before you start" and the other in-planner headings, and
                the stage titles below it step down to h4.
              */}
              <h3 id="plan-heading" className="text-[length:var(--beta-text-xl)]">
                Your plan
              </h3>
              {/*
                Offered because the plan is worth keeping and the visitor has
                nowhere to put it: nothing is stored server side, so closing
                the tab loses it. Copying is entirely client side — the text is
                already on screen, and no request is made.
              */}
              {/*
                Not offered while the plan is still arriving, and NOT offered
                at all when it was cut off: the page tells that visitor "don't
                follow a partial plan", and the copy would carry the plan
                without carrying the warning, which lives in a sibling card.
              */}
              <button
                type="button"
                onClick={() => void copyPlan()}
                disabled={phase === 'running' || planCutOff}
                className="beta-btn beta-btn-secondary beta-btn-sm"
              >
                {planCopied ? 'Copied' : 'Copy plan'}
              </button>
            </div>
            <div className="mt-5">
              <PlanDisplay text={planText} streaming={phase === 'running'} />
            </div>
            {/* Announced politely so the copy result is not silent for a
                screen reader; visually the button label already changed. */}
            <p aria-live="polite" className="sr-only">
              {planCopied ? 'Plan copied to the clipboard.' : ''}
            </p>
          </section>
        )}

        {phase === 'error' && errorMessage && (
          <div
            ref={errorRef}
            // Assertive only when a partial plan is already on screen: the
            // interruption lands on someone reading a protocol that is missing
            // its later stages and safety notes. Everywhere else the failure is
            // inert (nothing unsafe to un-read), so polite is the right volume.
            role={planCutOff ? 'alert' : 'status'}
            className="beta-card beta-card--error-edge beta-focus-target mt-6 p-6 sm:p-8"
          >
            <h3 className="text-[length:var(--beta-text-xl)]">
              {errorKind === 'limit' ? 'You’ve hit the demo’s limit' : 'That didn’t work'}
            </h3>
            <p className="mt-3 beta-measure">{errorMessage}</p>
            {planCutOff && (
              <p className="mt-3 beta-measure font-medium text-[color:var(--beta-error)]">
                The plan above was cut off before it finished — its later stages and safety
                notes are missing. Please don’t follow a partial plan; draft a fresh one instead.
              </p>
            )}
            {errorKind === 'failure' && (
              <button type="submit" form="beta-form" className="beta-btn beta-btn-secondary mt-6">
                Try again
              </button>
            )}
          </div>
        )}

        {phase === 'done' && (
          <div className="beta-card mt-6 p-6 sm:p-8">
            <h3 className="text-[length:var(--beta-text-lg)]">A starting point, not a finish line</h3>
            <p className="mt-3 beta-measure">{PLAN_PACING_RULE}</p>
            <div className="mt-4 beta-measure rounded-lg bg-[color:var(--beta-surface-2)] p-4">
              <p className="font-medium text-[color:var(--beta-ink)]">
                {PLAN_STOP_CONDITIONS_HEADING}
              </p>
              <ul className="mt-2 space-y-1 text-[0.9375rem]">
                {PLAN_STOP_CONDITIONS.map((item) => (
                  <li key={item} className="flex gap-2.5">
                    <span
                      aria-hidden="true"
                      className="mt-[0.6em] h-1.5 w-1.5 flex-none rounded-full bg-[color:var(--beta-error)]"
                    />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
            <button type="button" onClick={resetResult} className="beta-btn beta-btn-secondary mt-6">
              Start over
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
