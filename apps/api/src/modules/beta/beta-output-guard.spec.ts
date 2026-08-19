import { renderDose, toCoachPlan, type DraftPlan } from './beta-output-guard';

function makeStage(n: number) {
  return {
    rationale: `Why stage ${n} looks the way it does.`,
    title: `Stage ${n}`,
    timeWindow: `Weeks ${n * 2 - 1}-${n * 2}`,
    exercises: [
      {
        name: 'Tendon glides',
        equipmentUsed: 'none',
        dose: { sets: 3, reps: 10, frequencyPerWeek: 7 },
      },
    ],
    allowedClimbing: 'Easy vertical jugs',
    advanceWhen: ['Pain-free daily activities', 'No added morning stiffness'],
  };
}

function makePlan(overrides: Partial<DraftPlan> = {}): DraftPlan {
  return { stages: [1, 2, 3, 4].map(makeStage), ...overrides };
}

describe('renderDose (AC-G5): dose prose is produced by code, never the model', () => {
  it.each([
    [{ sets: 3, reps: 10, frequencyPerWeek: 3 }, '3 sets of 10, 3 times a week'],
    [{ sets: 1, reps: 8, frequencyPerWeek: 1 }, '1 set of 8, once a week'],
    [{ sets: 2, reps: 12, frequencyPerWeek: 2 }, '2 sets of 12, twice a week'],
    [
      { sets: 3, reps: 5, holdSeconds: 7, frequencyPerWeek: 3 },
      '3 sets of 5, holding 7 seconds, 3 times a week',
    ],
    [
      { sets: 4, reps: 1, holdSeconds: 1, frequencyPerWeek: 4 },
      '4 sets of 1, holding 1 second, 4 times a week',
    ],
  ])('renders %j as %j', (dose, expected) => {
    expect(renderDose(dose)).toBe(expected);
  });
});

describe('toCoachPlan: what the coach is actually handed', () => {
  it('replaces the structured dose with the rendered string, exactly', () => {
    const plan = makePlan();
    const coachPlan = toCoachPlan(plan);
    expect(coachPlan.stages[0].exercises[0].dose).toBe(
      renderDose(plan.stages[0].exercises[0].dose),
    );
    expect(coachPlan.stages[0].exercises[0].dose).toBe(
      '3 sets of 10, 7 times a week',
    );
  });

  it('withholds rationale and equipmentUsed, which are drafting scaffolding', () => {
    const stage = toCoachPlan(makePlan()).stages[0] as Record<string, unknown>;
    expect(stage).not.toHaveProperty('rationale');
    expect(stage.exercises).toEqual([
      { name: 'Tendon glides', dose: '3 sets of 10, 7 times a week' },
    ]);
  });

  it('carries overallCaution through when the drafter set one', () => {
    expect(
      toCoachPlan(makePlan({ overallCaution: 'Rest pain deserves a look.' }))
        .overallCaution,
    ).toBe('Rest pain deserves a look.');
    expect(toCoachPlan(makePlan())).not.toHaveProperty('overallCaution');
  });
});
