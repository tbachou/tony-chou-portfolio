'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  BetaRequestError,
  DISCIPLINES,
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
  'Beta caps itself at 40 plans a day so a portfolio demo can’t run away with the AI bill. Today’s budget is spent — it resets at midnight UTC. The form below stays open if you want to look around.';

const HOURLY_THROTTLE_MESSAGE =
  'You’ve hit the hourly attempt limit — Beta allows 3 attempts per hour per visitor. Take a breather and try again in a little while.';

const NETWORK_ERROR_MESSAGE =
  'Couldn’t reach the planner service. It runs on a small demo server that sometimes naps between visitors — give it a few seconds and try again.';

type Phase = 'idle' | 'running' | 'done' | 'red_flag' | 'error';

export function BetaPlanner() {
  // Disclaimer gate (AC-3). Read in useEffect to stay hydration-safe.
  const [acknowledged, setAcknowledged] = useState(false);

  // Status pre-check (AC-5): non-null means the global cap is spent.
  const [capNotice, setCapNotice] = useState<string | null>(null);

  // Pipeline / result state (AC-4, AC-2, AC-8).
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState<BetaStage | null>(null);
  const [planText, setPlanText] = useState('');
  const [redFlagMessage, setRedFlagMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<'limit' | 'failure' | null>(null);
  const [announcement, setAnnouncement] = useState('');

  // Form state.
  const [injuryArea, setInjuryArea] = useState<InjuryArea | ''>('');
  const [onsetWeeks, setOnsetWeeks] = useState('');
  const [symptoms, setSymptoms] = useState<Symptom[]>([]);
  const [painBehavior, setPainBehavior] = useState<PainBehavior | ''>('');
  const [grade, setGrade] = useState('');
  const [discipline, setDiscipline] = useState<Discipline | ''>('');
  const [goals, setGoals] = useState('');
  const [sessionsPerWeek, setSessionsPerWeek] = useState('');
  const [equipment, setEquipment] = useState<EquipmentAccess[]>([]);

  const runIdRef = useRef(0);
  const resultRef = useRef<HTMLDivElement>(null);

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

  function acknowledge() {
    setAcknowledged(true);
    try {
      localStorage.setItem(ACK_STORAGE_KEY, 'true');
    } catch {
      // Best effort: this visit is unlocked either way.
    }
  }

  function toggleInList<T>(list: T[], value: T): T[] {
    return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
  }

  function resetResult() {
    runIdRef.current += 1;
    setPhase('idle');
    setStage(null);
    setPlanText('');
    setRedFlagMessage(null);
    setErrorMessage(null);
    setErrorKind(null);
    setAnnouncement('');
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

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (phase === 'running' || capNotice) return;
    if (!injuryArea || !painBehavior || !discipline) return; // native `required` backstop

    const payload: BetaPlanPayload = {
      injuryArea,
      onsetWeeksAgo: Number(onsetWeeks),
      symptoms,
      painBehavior,
      preInjuryGrade: grade.trim(),
      discipline,
    };
    const trimmedGoals = goals.trim();
    if (trimmedGoals) payload.goals = trimmedGoals;
    if (sessionsPerWeek !== '') payload.sessionsPerWeek = Number(sessionsPerWeek);
    if (equipment.length > 0) payload.equipmentAccess = equipment;

    const runId = ++runIdRef.current;
    setPhase('running');
    setStage(null);
    setPlanText('');
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

  return (
    <div>
      {/* Stage announcements for screen readers — batched per stage (AC-4). */}
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {capNotice && (
        <div className="beta-card beta-card--accent-edge mb-6 p-5 sm:p-6">
          <h3 className="text-[length:var(--beta-text-lg)]">Today’s demo budget is used up</h3>
          <p className="mt-2 max-w-[65ch]">{capNotice}</p>
        </div>
      )}

      {!acknowledged ? (
        <div className="beta-card p-6 sm:p-8">
          <h3 className="text-[length:var(--beta-text-xl)]">Before you start</h3>
          <div className="mt-4 max-w-[65ch] space-y-3">
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
            <p className="beta-hint">Nothing you type is stored — the form clears when you leave.</p>
          </div>
          <button type="button" onClick={acknowledge} className="beta-btn beta-btn-primary mt-6">
            I understand — draft me a plan
          </button>
        </div>
      ) : (
        <form id="beta-form" onSubmit={handleSubmit} className="beta-card p-6 sm:p-8">
          <fieldset disabled={formDisabled} className="beta-fieldset space-y-10">
            {/* Injury area */}
            <fieldset className="beta-fieldset">
              <legend className="beta-legend">Where does it hurt?</legend>
              <p className="beta-hint mb-4">Beta covers the three most common climbing injuries.</p>
              <div className="grid gap-3 md:grid-cols-3">
                {INJURY_OPTIONS.map((option) => (
                  <label key={option.value} className="beta-choice">
                    <input
                      type="radio"
                      name="injuryArea"
                      value={option.value}
                      checked={injuryArea === option.value}
                      onChange={() => setInjuryArea(option.value)}
                      required
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
            </fieldset>

            {/* Onset */}
            <div className="max-w-xs">
              <label htmlFor="beta-onset" className="beta-legend">
                When did it start?
              </label>
              <p className="beta-hint mb-4">Your best guess is fine.</p>
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
                  value={onsetWeeks}
                  onChange={(e) => setOnsetWeeks(e.target.value)}
                  placeholder="6"
                />
                <span className="text-[color:var(--beta-muted)]">weeks ago</span>
              </div>
            </div>

            {/* Symptoms */}
            <fieldset className="beta-fieldset">
              <legend className="beta-legend">What are you noticing?</legend>
              <p className="beta-hint mb-4">Check everything that applies.</p>
              <div className="grid gap-3 md:grid-cols-2">
                {SYMPTOMS.map((symptom) => {
                  const isRedFlag = RED_FLAG_SYMPTOMS.includes(symptom);
                  return (
                    <label key={symptom} className="beta-choice">
                      <input
                        type="checkbox"
                        name="symptoms"
                        value={symptom}
                        checked={symptoms.includes(symptom)}
                        onChange={() => setSymptoms((prev) => toggleInList(prev, symptom))}
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
            <fieldset className="beta-fieldset">
              <legend className="beta-legend">How does the pain behave?</legend>
              <p className="beta-hint mb-4">Pick the pattern that fits best.</p>
              <div className="grid gap-3 md:grid-cols-2">
                {PAIN_BEHAVIORS.map((behavior) => (
                  <label key={behavior} className="beta-choice beta-choice--center">
                    <input
                      type="radio"
                      name="painBehavior"
                      value={behavior}
                      checked={painBehavior === behavior}
                      onChange={() => setPainBehavior(behavior)}
                      required
                    />
                    <span className="font-medium text-[color:var(--beta-ink)]">
                      {PAIN_BEHAVIOR_LABELS[behavior]}
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>

            {/* Grade + discipline */}
            <div className="grid gap-10 md:grid-cols-2 md:gap-6">
              <div>
                <label htmlFor="beta-grade" className="beta-legend">
                  Your grade before the injury
                </label>
                <p className="beta-hint mb-4">Any system works — the plan scales from it.</p>
                <input
                  id="beta-grade"
                  className="beta-input max-w-[14rem]"
                  type="text"
                  required
                  maxLength={12}
                  pattern="[A-Za-z0-9 .+\/\-]+"
                  title="A plain climbing grade like V5, 5.11a, or 6b+"
                  value={grade}
                  onChange={(e) => setGrade(e.target.value)}
                  placeholder="V5 or 5.11a or 6b+"
                />
              </div>
              <fieldset className="beta-fieldset">
                <legend className="beta-legend">Main discipline</legend>
                <p className="beta-hint mb-4">Where do you mostly climb?</p>
                <div className="grid grid-cols-2 gap-3">
                  {DISCIPLINES.map((d) => (
                    <label key={d} className="beta-choice beta-choice--center">
                      <input
                        type="radio"
                        name="discipline"
                        value={d}
                        checked={discipline === d}
                        onChange={() => setDiscipline(d)}
                        required
                      />
                      <span className="font-medium text-[color:var(--beta-ink)]">
                        {DISCIPLINE_LABELS[d]}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>

            {/* Goals */}
            <div>
              <label htmlFor="beta-goals" className="beta-legend">
                What are you working toward?{' '}
                <span className="font-normal text-[color:var(--beta-muted)]">(optional)</span>
              </label>
              <p className="beta-hint mb-4">
                A project, a trip, or just climbing without thinking about it.
              </p>
              <textarea
                id="beta-goals"
                className="beta-textarea max-w-[40rem]"
                maxLength={200}
                rows={3}
                value={goals}
                onChange={(e) => setGoals(e.target.value)}
                placeholder="Back to steep bouldering by autumn…"
              />
              <p className="beta-hint mt-1.5">{goals.length}/200</p>
            </div>

            {/* Training context */}
            <div className="grid gap-10 md:grid-cols-2 md:gap-6">
              <div>
                <label htmlFor="beta-sessions" className="beta-legend">
                  Sessions per week{' '}
                  <span className="font-normal text-[color:var(--beta-muted)]">(optional)</span>
                </label>
                <p className="beta-hint mb-4">How often you can train right now.</p>
                <input
                  id="beta-sessions"
                  className="beta-input max-w-[7rem]"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={14}
                  step={1}
                  value={sessionsPerWeek}
                  onChange={(e) => setSessionsPerWeek(e.target.value)}
                  placeholder="3"
                />
              </div>
              <fieldset className="beta-fieldset">
                <legend className="beta-legend">
                  Equipment access{' '}
                  <span className="font-normal text-[color:var(--beta-muted)]">(optional)</span>
                </legend>
                <p className="beta-hint mb-4">Check what you can get to.</p>
                <div className="flex flex-wrap gap-2.5">
                  {EQUIPMENT_ACCESS.map((item) => (
                    <label key={item} className="beta-choice beta-choice--chip">
                      <input
                        type="checkbox"
                        name="equipmentAccess"
                        value={item}
                        checked={equipment.includes(item)}
                        onChange={() => setEquipment((prev) => toggleInList(prev, item))}
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
              <p className="beta-hint mt-3 max-w-[65ch]">
                Nothing you type is stored. The first request can take a few extra seconds while
                the demo server wakes up.
              </p>
            </div>
          </fieldset>
        </form>
      )}

      {/* Results: pipeline status, streamed plan, and the unhappy states. */}
      <div ref={resultRef} className="scroll-mt-24">
        {showPipeline && (
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
          <div className="beta-card beta-card--error-edge mt-6 p-6 sm:p-8">
            <h3 className="text-[length:var(--beta-text-xl)]">Let’s pause here</h3>
            <p className="mt-3 max-w-[65ch]">{redFlagMessage}</p>
            <div className="mt-5 max-w-[65ch] rounded-lg bg-[color:var(--beta-surface-2)] p-4">
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
          <section aria-label="Your plan" className="mt-6">
            <PlanDisplay text={planText} streaming={phase === 'running'} />
          </section>
        )}

        {phase === 'error' && errorMessage && (
          <div className="beta-card beta-card--error-edge mt-6 p-6 sm:p-8">
            <h3 className="text-[length:var(--beta-text-xl)]">
              {errorKind === 'limit' ? 'You’ve hit the demo’s limit' : 'That didn’t work'}
            </h3>
            <p className="mt-3 max-w-[65ch]">{errorMessage}</p>
            {planText && (
              <p className="mt-3 max-w-[65ch] font-medium text-[color:var(--beta-error)]">
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
            <p className="mt-3 max-w-[65ch]">
              This plan is drawn from common rehab patterns, not an assessment of you. Let pain set
              the pace: if a stage stirs things up, drop back a stage and give it another week.
            </p>
            <div className="mt-4 max-w-[65ch] rounded-lg bg-[color:var(--beta-surface-2)] p-4">
              <p className="font-medium text-[color:var(--beta-ink)]">
                Stop the plan and see a professional if any of these show up:
              </p>
              <ul className="mt-2 space-y-1 text-[0.9375rem]">
                {[
                  'new numbness or tingling',
                  'pain that starts waking you at night',
                  'a new pop or snap',
                  'swelling that increases',
                  'pain above 3 out of 10 that isn’t settling by the next morning, two sessions in a row',
                ].map((item) => (
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
