import { z } from 'zod';
import {
  DISCIPLINES,
  EQUIPMENT_ACCESS,
  INJURY_AREAS,
  PAIN_BEHAVIORS,
  SYMPTOMS,
} from '@/lib/beta-api';
import { INJURY_OPTIONS } from './options';

export type Phase = 'idle' | 'running' | 'done' | 'red_flag' | 'error';

// The form sets noValidate and owns its errors: native bubbles are
// transient, one at a time, and often render off-screen at 200% zoom. The
// required/min/max attributes stay — they still feed aria-required.

export type FieldName =
  | 'injuryArea'
  | 'onsetWeeks'
  | 'painBehavior'
  | 'grade'
  | 'discipline'
  | 'sessionsPerWeek';

// DOM order, so the error summary reads the form top to bottom.
export const FIELD_ORDER: FieldName[] = [
  'injuryArea',
  'onsetWeeks',
  'painBehavior',
  'grade',
  'discipline',
  'sessionsPerWeek',
];

// Where an error-summary link sends focus. Radio groups have no single
// control, so the link targets the first option in the group.
export const FIELD_ANCHORS: Record<FieldName, string> = {
  injuryArea: `beta-injury-${INJURY_OPTIONS[0].value}`,
  onsetWeeks: 'beta-onset',
  painBehavior: `beta-pain-${PAIN_BEHAVIORS[0]}`,
  grade: 'beta-grade',
  discipline: `beta-discipline-${DISCIPLINES[0]}`,
  sessionsPerWeek: 'beta-sessions',
};

export const GRADE_PATTERN = /^[A-Za-z0-9 .+/-]+$/;

/**
 * The form's first gate; the server re-validates everything (spec 0004).
 *
 * The numeric answers stay strings so an empty box is distinguishable from
 * a deliberate zero (Number('') is 0). The required choices have no default,
 * so an untouched group reports the sentence below, not "invalid option".
 */
export const plannerSchema = z.object({
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

export type PlannerValues = z.infer<typeof plannerSchema>;
