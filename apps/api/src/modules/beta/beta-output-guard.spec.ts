import {
  evaluateCoachOutput,
  evaluatePlanContent,
  renderDose,
  renderPlanFallback,
  resolveGuardMode,
  splitCoachSections,
  toCoachPlan,
  type DraftPlan,
  type GuardInput,
} from './beta-output-guard';

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

// ---------------------------------------------------------------------------
// Layer 2 (AC-G8). Every rule gets a test for what it must catch AND a test
// for the legitimate rehab language the spec names as its false-positive
// risk. The second half is the one that matters: on this surface a false
// positive means an injured person gets a plainer plan than they should have.
// ---------------------------------------------------------------------------

/**
 * A realistic finger-pulley plan. Written out by hand rather than generated,
 * so these tests do not inherit any assumption the implementation makes.
 */
const PULLEY_PLAN: DraftPlan = {
  stages: [
    {
      rationale: 'Fresh and irritable, so calm it before loading it.',
      title: 'Calm it down',
      timeWindow: 'Weeks 1-2',
      exercises: [
        {
          name: 'Tendon glides',
          equipmentUsed: 'none',
          dose: { sets: 3, reps: 10, frequencyPerWeek: 7 },
        },
        {
          name: 'Open-hand putty squeezes',
          equipmentUsed: 'none',
          dose: { sets: 2, reps: 15, frequencyPerWeek: 3 },
        },
      ],
      allowedClimbing: 'No climbing yet, and no crimping of any kind.',
      advanceWhen: [
        'Daily tasks are pain-free',
        'No added morning stiffness for a week',
      ],
    },
    {
      rationale: 'Start protected loading once it has settled.',
      title: 'Wake it up',
      timeWindow: 'Weeks 3-5',
      exercises: [
        {
          name: 'Open-hand pick-up block holds',
          equipmentUsed: 'none',
          dose: { sets: 4, reps: 5, holdSeconds: 7, frequencyPerWeek: 3 },
        },
        {
          name: 'Finger extensions against a rubber band',
          equipmentUsed: 'resistance_bands',
          dose: { sets: 3, reps: 20, frequencyPerWeek: 3 },
        },
      ],
      allowedClimbing:
        'Big open-hand holds on vertical terrain, several grades below your max.',
      advanceWhen: [
        'Pain during activity no more than about 3 out of 10',
        'Settling by the next morning',
      ],
    },
    {
      rationale: 'Reintroduce the half crimp under control.',
      title: 'Rebuild the base',
      timeWindow: 'Weeks 6-8',
      exercises: [
        {
          name: 'Half-crimp isometric holds',
          equipmentUsed: 'hangboard',
          dose: { sets: 5, reps: 1, holdSeconds: 8, frequencyPerWeek: 2 },
        },
        {
          name: 'Slow-lowering wrist curls',
          equipmentUsed: 'weights',
          dose: { sets: 3, reps: 12, frequencyPerWeek: 2 },
        },
      ],
      allowedClimbing: 'Smaller holds on vertical terrain, still no dynos.',
      advanceWhen: [
        'A full session with no flare-up',
        'Full pain-free range in the finger',
      ],
    },
    {
      rationale: 'Return to normal climbing on your own terms.',
      title: 'Back to the wall',
      timeWindow: 'Weeks 9-12',
      exercises: [
        {
          name: 'Half-crimp holds at bodyweight',
          equipmentUsed: 'hangboard',
          dose: { sets: 5, reps: 1, holdSeconds: 10, frequencyPerWeek: 2 },
        },
        {
          name: 'Maintenance finger extensions',
          equipmentUsed: 'resistance_bands',
          dose: { sets: 2, reps: 20, frequencyPerWeek: 2 },
        },
      ],
      allowedClimbing: 'Cautious return to normal bouldering on open grips.',
      advanceWhen: [
        'Half crimp is comfortable under load',
        'Two normal sessions in a row with no reaction',
      ],
    },
  ],
};

const PULLEY_INPUT: GuardInput = {
  injuryArea: 'finger_pulley',
  painBehavior: 'none_at_rest_hurts_under_load',
};

const DEFAULT_OPENING =
  'Sounds like a frustrating few weeks off the wall. Here is a steady way back.';
const DEFAULT_CLOSING =
  'Climbers usually find this kind of injury responds well to patience. If anything gets worse instead of better, a physical therapist or sports medicine doctor is the right next step.';

/**
 * Builds a document in coach.md's contracted format from a plan. Written
 * independently of renderPlanFallback so the guard is not merely being
 * tested against its own renderer.
 */
function coachOutput(
  plan: DraftPlan,
  overrides: {
    opening?: string;
    closing?: string;
    /** Rewrites one stage's section lines after they are built. */
    mutateStage?: (lines: string[], index: number) => string[];
  } = {},
): string {
  const blocks: string[] = [overrides.opening ?? DEFAULT_OPENING];
  const coachPlan = toCoachPlan(plan);

  coachPlan.stages.forEach((stage, index) => {
    let lines = [
      `## Stage ${index + 1}: ${stage.title}`,
      '',
      `**When:** ${stage.timeWindow}`,
      '',
      `**Climbing:** ${stage.allowedClimbing}`,
      '',
      '**Do this:**',
      ...stage.exercises.map((e) => `- ${e.name} — ${e.dose}`),
      '',
      '**Move on when:**',
      ...stage.advanceWhen.map((c) => `- ${c}`),
    ];
    if (overrides.mutateStage) lines = overrides.mutateStage(lines, index);
    blocks.push(lines.join('\n'));
  });

  blocks.push(overrides.closing ?? DEFAULT_CLOSING);
  return blocks.join('\n\n');
}

function evaluate(text: string, input: GuardInput = PULLEY_INPUT) {
  return evaluateCoachOutput(text, PULLEY_PLAN, input);
}

describe('splitCoachSections', () => {
  it('separates opening, one section per stage, and the trailing closing', () => {
    const sections = splitCoachSections(coachOutput(PULLEY_PLAN));
    expect(sections.stages).toHaveLength(4);
    expect(sections.stages.map((s) => s.number)).toEqual([1, 2, 3, 4]);
    expect(sections.opening.join(' ')).toContain('frustrating few weeks');
    expect(sections.closing.join(' ')).toContain('Climbers usually find');
    // The closing must not be left inside the last stage, or R3 would scan it.
    expect(sections.stages[3].lines.join('\n')).not.toContain(
      'Climbers usually find',
    );
  });
});

describe('the guard passes a conformant coach output', () => {
  it('accepts a well-formed plan end to end', () => {
    expect(evaluate(coachOutput(PULLEY_PLAN))).toEqual({ ok: true });
  });
});

describe('R1 contraindicated pain phrasing', () => {
  it.each([
    'Some days you just have to push through the pain.',
    'It will ache at first — work through the pain.',
    'Just power through the soreness for a fortnight.',
    'Fight through the discomfort and it will settle.',
    'Push through it even on the bad days.',
    'No pain no gain applies here.',
    'Ignore the pain in the first week.',
    'Tough it out for the first fortnight.',
    'Pain is nothing to worry about at this stage.',
  ])('CATCHES %j', (sentence) => {
    const result = evaluate(coachOutput(PULLEY_PLAN, { closing: sentence }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R1/);
  });

  // ---- The regression the verb x object cross product introduced. ----
  // Its first version listed only article-prefixed objects ("the pain"), so
  // it matched "push through THE pain" and nothing else. Rehab prose reaches
  // for the bare noun at least as often, and two of these ("power through",
  // "work through it") were blocked outright before the cross product
  // existed — so the rewrite moved them from caught to allowed.
  it.each([
    'Power through soreness and keep loading.',
    'Work through pain in the first two weeks.',
    'Push through pain on the hangboard.',
    // The object was listed but the verb was not.
    'Train through the pain.',
    'Fight through discomfort and it will settle.',
    // Control: already covered by the article-prefixed form.
    'Work through the ache rather than resting it.',
  ])('CATCHES the bare-object form in %j', (closing) => {
    const result = evaluate(coachOutput(PULLEY_PLAN, { closing }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R1/);
  });

  // The two false positives an audit found in the bare-substring version.
  // Both are ordinary, correct rehab prose; a guard that rejected them would
  // hand a plainer plan to a visitor whose coach did everything right. They
  // are also what makes the bare objects above safe: the VERB is doing the
  // work, and neither of these names a pain object in any form.
  it.each([
    'You rebuild power through progressive loading, not through big jumps.',
    'Take your time and work through it one stage at a time.',
  ])('does NOT catch the benign verb sense in %j', (closing) => {
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });

  it('does NOT catch the pain traffic-light language the skill files mandate', () => {
    // These are drafter.md's own words. A rule that fired on them would
    // reject exactly the plans that followed the prompt correctly.
    const closing = [
      'Let pain set the pace: no more than about 3 out of 10 during activity,',
      'settling by the next morning. Some discomfort is normal and expected —',
      "'no pain' is not required for tendon work.",
    ].join(' ');
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });

  it('does NOT catch the traffic-light criteria inside a stage section', () => {
    // Stage 2's advanceWhen carries "no more than about 3 out of 10" and
    // "Settling by the next morning" verbatim from the drafter.
    expect(evaluate(coachOutput(PULLEY_PLAN))).toEqual({ ok: true });
  });
});

describe('R2 full-crimp programming, scoped to prescription lines', () => {
  it('CATCHES full crimp introduced into a **Do this:** bullet', () => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 3
            ? lines.map((line) =>
                line.startsWith('- Half-crimp holds')
                  ? '- Full-crimp hangs — 5 sets of 1, holding 10 seconds, twice a week'
                  : line,
              )
            : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R2/);
  });

  it('does NOT catch "no crimping of any kind" in a Climbing line', () => {
    // Stage 1's allowedClimbing carries the skill file's own safety language.
    // A document-wide substring match would fire on it; the scope is what
    // makes this rule safe.
    expect(evaluate(coachOutput(PULLEY_PLAN))).toEqual({ ok: true });
  });

  it('does NOT catch "half crimp", which is correct in later stages', () => {
    // Stages 3 and 4 prescribe half-crimp holds in **Do this:** bullets.
    expect(evaluate(coachOutput(PULLEY_PLAN))).toEqual({ ok: true });
  });

  // The three cases below all put the phrase where R2 does not look — a
  // Climbing line, a closing paragraph — or use wording that never contains
  // "full crimp" at all. None of them exercised a NEGATED full crimp inside a
  // **Do this:** bullet, which is where a coach actually writes the
  // prohibition, so the rule fired on safety-correct copy for as long as the
  // suite was green. Found live in a shadow corpus run, not by these tests.
  // Each variant is spliced into the EXISTING stage 4 bullet so the drafted
  // dose survives untouched — inventing numbers here trips R3 instead and
  // would test the wrong rule.
  it.each([
    'Open-hand hangs only, no full crimp',
    'Avoid full crimping',
    'Half-crimp holds, not full crimp',
    'Never full crimp',
  ])('does NOT catch the prohibition in a **Do this:** bullet: "%s"', (phrase) => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 3
            ? lines.map((line) =>
                line.startsWith('- Half-crimp holds')
                  ? line.replace('- Half-crimp holds', `- ${phrase}`)
                  : line,
              )
            : lines,
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('does NOT catch "full crimp moves are the very last thing to return"', () => {
    const closing =
      'Full crimp moves are the very last thing to return, so stay patient with them.';
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });
});

describe('R3 numeric fidelity', () => {
  it('CATCHES an inflated dose', () => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 0
            ? lines.map((line) =>
                line.replace('3 sets of 10', '3 sets of 30'),
              )
            : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R3/);
  });

  it('CATCHES a changed week count', () => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 1
            ? lines.map((line) =>
                line.replace('**When:** Weeks 3-5', '**When:** Weeks 3-6'),
              )
            : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R3/);
  });

  it('is a set-membership check, so a number used elsewhere in the same stage masks a change', () => {
    // Honest limitation, documented rather than hidden: stage 2 already
    // contains 4 (four sets of pick-up block holds), so "Weeks 3-4" reads as
    // a legitimate number and passes. R3 catches invented numbers, not every
    // reshuffle of numbers the stage already had. Positional checking is not
    // what the spec defines this rule as.
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 1
            ? lines.map((line) =>
                line.replace('**When:** Weeks 3-5', '**When:** Weeks 3-4'),
              )
            : lines,
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('does NOT catch the stage heading number itself', () => {
    // "## Stage 4:" is the only place 4 appears in that section — its time
    // window is Weeks 9-12 — so the exclusion is what keeps this passing.
    expect(evaluate(coachOutput(PULLEY_PLAN))).toEqual({ ok: true });
  });

  it('does NOT catch a forward cross-reference to another stage number', () => {
    // The false positive an audit found: the allowed set is per stage, so a
    // coach pointing forward from one stage to another tripped numeric
    // fidelity. Stage 3's own numbers are 1, 2, 3, 5, 6, 8 and 12 — 4 appears
    // nowhere in it — so this line passes only because the `stage 4` phrase
    // is stripped before tokenizing.
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 2
            ? [...lines, '', 'Stage 4 builds directly on this one.']
            : lines,
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('does NOT catch a backward cross-reference to another stage number', () => {
    // Stage 4's own numbers are 1, 2, 5, 9, 10, 12 and 20 — 3 appears nowhere
    // in it, so "stage 3" here is only tolerated by the strip.
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 3
            ? [
                ...lines,
                '',
                'If it flares, drop back and move on to stage 3 again when it settles.',
              ]
            : lines,
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  // ---- The regression the stage-ordinal loosening introduced. ----
  // Exempting the cross-reference by adding every ordinal to every stage's
  // allowed set put "1".."4" beyond this rule's reach document-wide, and
  // rehab dose integers live almost entirely in that range. These cases are
  // small integers that are ALSO stage ordinals of this four-stage plan, so
  // each of them passed under that version while the drafter's real dose
  // said something else. They are the point of the strip.

  it('CATCHES a fabricated number written into the stage HEADING', () => {
    // The heading is visitor-facing: PlanDisplay renders it as the stage
    // card's title. splitCoachSections used to keep only the parsed ordinal
    // and discard the text, and R3 scanned a SYNTHETIC heading instead, so a
    // dose invented here reached the page having passed numeric fidelity.
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 1
            ? lines.map((line, i) =>
                i === 0 ? `${line} — hang for 99 seconds daily` : line,
              )
            : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R3/);
  });

  it('does NOT fire on a heading carrying a number the drafter did draft', () => {
    // Guards the fix against over-correction: scanning the heading must not
    // reject a title that legitimately restates one of the stage's own values.
    const drafted = PULLEY_PLAN.stages[1].timeWindow.match(/\d+/)?.[0];
    expect(drafted).toBeDefined();
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 1
            ? lines.map((line, i) => (i === 0 ? `${line} (week ${drafted})` : line))
            : lines,
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('CATCHES a fabricated frequency whose digit is also a stage ordinal', () => {
    // The auditor's case exactly: the drafter prescribed `frequencyPerWeek: 2`
    // for stage 4's second exercise, rendered by code as "twice a week", and
    // the coach doubled it. 4 is a stage ordinal here and nothing in stage 4.
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 3
            ? lines.map((line) =>
                line.replace(
                  '2 sets of 20, twice a week',
                  '2 sets of 20, 4 times a week',
                ),
              )
            : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R3/);
  });

  it('CATCHES a fabricated set count whose digit is also a stage ordinal', () => {
    // Stage 3 was drafted "3 sets of 12"; 4 is a stage ordinal and appears
    // nowhere in stage 3.
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 2
            ? lines.map((line) => line.replace('3 sets of 12', '4 sets of 12'))
            : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R3/);
  });

  it('still CATCHES a number that is neither drafted nor a stage ordinal', () => {
    // 9 is not a stage ordinal in a four-stage plan and stage 3 never drafted
    // it. Kept alongside the two above, which are the stronger cases: this
    // one passed even under the version that admitted every ordinal.
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 2 ? [...lines, '', 'Give this about 9 sessions.'] : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R3/);
  });

  it('does NOT scan the opening or closing paragraphs', () => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        opening: 'You said this started about 4 weeks ago.',
        closing: 'Most climbers are back on the wall within 3 to 6 months.',
      }),
    );
    expect(result).toEqual({ ok: true });
  });

  it('does NOT catch a frequency the coach spells out in digits', () => {
    // Code renders frequencyPerWeek 2 as "twice a week"; a coach writing
    // "2 times a week" must still pass, because 2 is the drafter's number.
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 2
            ? lines.map((line) => line.replace('twice a week', '2 times a week'))
            : lines,
      }),
    );
    expect(result).toEqual({ ok: true });
  });
});

describe('R4 structural conformance', () => {
  it('CATCHES a dropped stage', () => {
    const full = coachOutput(PULLEY_PLAN);
    const withoutLast = full.slice(0, full.indexOf('## Stage 4:'));
    const result = evaluate(withoutLast);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R4 stage count/);
  });

  it('CATCHES a reordered stage', () => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN).replace('## Stage 2:', '## Stage 3:'),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R4 stage order/);
  });

  it('CATCHES a missing label', () => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 1
            ? lines.filter((line) => !line.startsWith('**Climbing:**'))
            : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R4 missing/);
  });

  it('CATCHES an added exercise bullet', () => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 0
            ? lines.flatMap((line) =>
                line.startsWith('- Tendon glides')
                  ? [line, '- Extra mystery exercise — 3 sets of 10, 3 times a week']
                  : [line],
              )
            : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R4 exercise count/);
  });

  it('CATCHES a dropped exercise bullet', () => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        mutateStage: (lines, index) =>
          index === 0
            ? lines.filter((line) => !line.startsWith('- Open-hand putty'))
            : lines,
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R4 exercise count/);
  });

  it('does NOT catch a conformant document (the whole non-catch set)', () => {
    expect(evaluate(coachOutput(PULLEY_PLAN))).toEqual({ ok: true });
  });
});

describe('R5 medication naming', () => {
  it.each([
    'Take ibuprofen for the first few days.',
    'A short course of anti-inflammatories can help.',
    'Ask about a cortisone injection.',
    'NSAIDs are fine here.',
  ])('CATCHES %j', (closing) => {
    const result = evaluate(coachOutput(PULLEY_PLAN, { closing }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R5/);
  });

  it('does NOT catch ordinary talk of inflammation', () => {
    const closing =
      'As the inflammation settles down, the stiffness usually eases with it.';
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });
});

describe('R6 diagnosis asserted as fact', () => {
  it.each([
    'From what you describe, you have torn the pulley.',
    'You have a grade II injury here.',
    // Both notations of the clinical ordinal, which is what separates the
    // injury sense of "grade" from the climbing one.
    'You have a grade 2 pulley strain.',
    'You have a grade III tear of the A2.',
    'It sounds like you have ruptured it.',
    'You have a tear in the A2.',
    'You tore it when you heard the pop.',
    'The pulley is definitely torn, so take it slowly.',
    'The pulley is clearly torn.',
    'People diagnosed with this do well.',
    'This is definitely a pulley problem.',
  ])('CATCHES %j', (closing) => {
    const result = evaluate(coachOutput(PULLEY_PLAN, { closing }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R6/);
  });

  it('does NOT catch hypothetical education framed as a conditional', () => {
    // The false positive an audit found in the bare "is torn" substring.
    // Teaching what a torn pulley feels like is the opposite of asserting
    // that this visitor has one.
    const closing =
      'If a pulley is torn, you would usually feel a pop at the time, which is not what you described.';
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });

  it("does NOT catch the visitor's own injury label", () => {
    const closing =
      "Your finger pulley strain and a climber's elbow have a lot in common: both reward patience.";
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });

  it('does NOT catch general education about the injury type', () => {
    const closing =
      'Pulley strains usually settle with graded loading, and this kind of injury often feels worse before it feels better.';
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });

  it('does NOT catch the climbing sense of "grade"', () => {
    // "Grade" is the most common noun in climbing, and drafter.md asks for it
    // by name: `allowedClimbing` is phrased relative to `pre_injury_grade`
    // (line 18) and progression runs "several number grades below their max"
    // (line 41). The unqualified "you have a grade" entry fired on this.
    const closing =
      'Once you have a grade you can climb comfortably, stay there for a few sessions before pushing up.';
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });
});

describe('R7 recovery promised as fact', () => {
  it.each([
    'You will be back on your projects by spring.',
    'You will be climbing again in eight weeks.',
    'You will fully recover from this.',
    'Follow this and you are guaranteed to be back on your projects.',
    'Guaranteed recovery if you keep to the doses.',
    'You are guaranteed to heal by the end of it.',
    'By the end of this you will be healed.',
  ])('CATCHES %j', (closing) => {
    const result = evaluate(coachOutput(PULLEY_PLAN, { closing }));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R7/);
  });

  it('does NOT catch the hedged language coach.md asks for', () => {
    const closing =
      'Climbers usually find this settles; most climbers typically notice the change first on easy ground. You will feel it warm up, and you will notice the stiffness fade.';
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });

  it('does NOT catch a negated "guaranteed", which IS the under-promising', () => {
    // The false positive an audit found in the bare "guaranteed" substring.
    // These are the exact sentences coach.md's "confidence without promises"
    // asks for, and the old rule rejected them.
    const closing =
      'No timeline here is guaranteed, and nothing about recovery is guaranteed either — the criteria are what decide, not the calendar.';
    expect(evaluate(coachOutput(PULLEY_PLAN, { closing }))).toEqual({
      ok: true,
    });
  });

  it('does NOT catch the stage time windows, which are explicitly guidance', () => {
    expect(evaluate(coachOutput(PULLEY_PLAN))).toEqual({ ok: true });
  });
});

describe('R7 recovery promised as fact, in the voice a coach actually writes', () => {
  // The blocklist is written in full English — "you will be back" — but
  // coach.md tells the coach to write warmly, and warm English contracts.
  // "you'll be back to V5 climbing soon" was written by the live coach and
  // walked straight through the rule that exists to stop it, because nothing
  // expanded the contraction before matching.
  it.each([
    "Otherwise, stick with this, trust the stages, and you'll be back to V5 climbing soon.",
    "Stay patient \u2014 you'll be climbing again before you know it.",
    "Follow this and you\u2019ll be back on the wall.",
  ])('CATCHES the contracted promise: %s', (closing) => {
    const result = evaluateCoachOutput(
      coachOutput(PULLEY_PLAN, { closing }),
      PULLEY_PLAN,
      PULLEY_INPUT,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R7/);
  });

  it('still does NOT catch the hedged phrasing coach.md asks for', () => {
    expect(
      evaluateCoachOutput(
        coachOutput(PULLEY_PLAN, {
          closing:
            "Climbers usually find they're back on the wall around this timeline, though it varies.",
        }),
        PULLEY_PLAN,
        PULLEY_INPUT,
      ),
    ).toEqual({ ok: true });
  });
});

describe('R8 mandatory caution carried into the closing', () => {
  const caution =
    'Pain that stays constant at rest and does not improve within a couple of weeks deserves a professional assessment.';
  const planWithCaution: DraftPlan = {
    ...PULLEY_PLAN,
    overallCaution: caution,
  };
  const restPainInput: GuardInput = {
    injuryArea: 'finger_pulley',
    painBehavior: 'constant_even_at_rest',
  };

  function evaluateRestPain(closing: string) {
    return evaluateCoachOutput(
      coachOutput(planWithCaution, { closing }),
      planWithCaution,
      restPainInput,
    );
  }

  it('CATCHES a closing that drops the caution entirely', () => {
    const result = evaluateRestPain(
      'Keep going steadily. You are doing the right things.',
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R8/);
    // The plan HAS the caution, so re-rendering it puts the caution back:
    // this is the failure the fallback exists to repair.
    expect(result.ok === false && result.source).toBe('coach');
  });

  // The bug: R8 used to read `painBehavior === '...' && plan.overallCaution`,
  // so a drafter that omitted the caution could not trip the rule that exists
  // for exactly that omission. The visitor it protects — constant pain at
  // rest, too recent for the code hard block — got a confident staged plan
  // with no caution anywhere, in any mode.
  it('CATCHES an overallCaution the drafter never produced', () => {
    const planWithout: DraftPlan = { ...PULLEY_PLAN };
    delete planWithout.overallCaution;
    const result = evaluateCoachOutput(
      coachOutput(planWithout, { closing: 'Keep going steadily.' }),
      planWithout,
      restPainInput,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R8/);
    // Not repairable by the fallback: its closing is conditional on the same
    // missing field, so substituting it would ship a plan with no caution.
    expect(result.ok === false && result.source).toBe('plan');
  });

  it.each(['', '   ', '\n'])(
    'CATCHES an empty overallCaution (%j), which is an omission by another name',
    (overallCaution) => {
      const emptied: DraftPlan = { ...PULLEY_PLAN, overallCaution };
      const result = evaluateCoachOutput(
        coachOutput(emptied, { closing: 'Keep going steadily.' }),
        emptied,
        restPainInput,
      );
      expect(result.ok).toBe(false);
      expect(result.ok === false && result.reason).toMatch(/^R8/);
      expect(result.ok === false && result.source).toBe('plan');
    },
  );

  it('does NOT fire on a missing caution for any other pain behavior', () => {
    // drafter.md only calls it MANDATORY for constant_even_at_rest; making it
    // mandatory everywhere would encode a rule the skill file does not state.
    const planWithout: DraftPlan = { ...PULLEY_PLAN };
    delete planWithout.overallCaution;
    expect(
      evaluateCoachOutput(
        coachOutput(planWithout, { closing: 'Keep going steadily.' }),
        planWithout,
        PULLEY_INPUT,
      ),
    ).toEqual({ ok: true });
  });

  // Real coach closings, captured from live shadow runs on the AC-G9 corpus.
  // The first FIRED under the previous key-term overlap rule while carrying
  // every clinical element, which is what sent that rule to be replaced; the
  // other two fired under the first attempt at a replacement, because the
  // coach drops "at rest" as implied and says "constant pain" instead. All
  // three are correct copy and must pass.
  it.each([
    [
      // Verbatim apart from the closing clause, which was "and you'll be back
      // to V5 climbing soon" — a real R7 promise once contractions expand, and
      // this case is about R8's carry check, not R7.
      'omits "professional", scored 0.47 under the old ratio',
      "You're working with a solid timeline and a proven path back. If your rest pain hasn't clearly improved by about three weeks from now, that's the moment to see a hand therapist or sports medicine doctor—they can rule out anything that needs their hands-on eye. Otherwise, stick with this and trust the stages.",
    ],
    [
      'says "constant pain" rather than naming rest',
      "You're coming back from early, constant pain, so patience in the first few weeks pays off later. If pain hasn't clearly improved in about three weeks, a hand therapist or sports medicine doctor should take a look before you load the finger any more.",
    ],
    [
      'says "pain stays constant"',
      'This is a steady return. Most climbers find that the first three weeks are the hardest — just letting it settle — and then the steps back to the wall feel quick. If pain stays constant through week three or gets worse instead of better, a hand therapist or sports medicine doctor can give you a clearer picture and get you back faster.',
    ],
  ])('does NOT catch a real coach closing that %s', (_label, closing) => {
    expect(evaluateRestPain(closing)).toEqual({ ok: true });
  });

  it.each([
    ['no time bound', 'If your pain stays constant at rest, see a hand therapist.'],
    ['no referral', 'If your pain stays constant at rest for three weeks, ease off.'],
    ['no pain condition', 'If things have not improved in three weeks, see a doctor.'],
  ])('still CATCHES a closing missing the %s', (_label, closing) => {
    const result = evaluateRestPain(closing);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R8/);
    expect(result.ok === false && result.source).toBe('coach');
  });

  it('does NOT catch a rephrasing, which the coach is supposed to do', () => {
    const result = evaluateRestPain(
      'Because your pain is constant even at rest, keep an eye on it: if it does not improve over the next couple of weeks, a professional assessment is worth getting.',
    );
    expect(result).toEqual({ ok: true });
  });

  it('does NOT catch a verbatim carry-through', () => {
    expect(evaluateRestPain(caution)).toEqual({ ok: true });
  });

  it('does not apply at all for other pain behaviors', () => {
    const result = evaluateCoachOutput(
      coachOutput(planWithCaution, { closing: 'Nice work so far.' }),
      planWithCaution,
      PULLEY_INPUT,
    );
    expect(result).toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// The content rules over the DRAFTER's own free text.
//
// The spec's key invariant: "The guard fallback is only safe because the
// drafter side checks run first. Any rule that protects the plan's content
// must sit on the drafter's output, never only on the coach's." R1, R5, R6
// and R7 used to run only over the coach's prose, so in `enforce` mode a
// violation that originated in the plan object was laundered: the coach's
// hedged sentence was discarded and the drafter's raw field was rendered in
// its place, by the fallback, verbatim.
// ---------------------------------------------------------------------------

describe('drafter free text is held to the same content rules (R1/R5/R6/R7)', () => {
  /** Returns a copy of PULLEY_PLAN with one drafter field rewritten. */
  function planWith(mutate: (plan: DraftPlan) => void): DraftPlan {
    const plan: DraftPlan = JSON.parse(
      JSON.stringify(PULLEY_PLAN),
    ) as DraftPlan;
    mutate(plan);
    return plan;
  }

  const MEDICATED_NOTE = 'take ibuprofen if it flares up';
  const medicatedPlan = planWith((plan) => {
    plan.stages[0].exercises[0].notes = MEDICATED_NOTE;
  });

  it('CATCHES a medication name in an exercise note (R5)', () => {
    const result = evaluatePlanContent(medicatedPlan);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R5/);
    expect(result.ok === false && result.source).toBe('plan');
  });

  it.each([
    [
      'overallCaution carrying a diagnosis (R6)',
      /^R6/,
      planWith((plan) => {
        plan.overallCaution = 'You have torn the pulley, so see someone.';
      }),
    ],
    [
      'allowedClimbing carrying a promise (R7)',
      /^R7/,
      planWith((plan) => {
        plan.stages[3].allowedClimbing =
          'Back to normal bouldering — you will be back on your projects.';
      }),
    ],
    [
      'advanceWhen carrying contraindicated pain advice (R1)',
      /^R1/,
      planWith((plan) => {
        plan.stages[1].advanceWhen = ['You can push through the pain for a set'];
      }),
    ],
    [
      'an exercise name carrying a promise (R7)',
      /^R7/,
      planWith((plan) => {
        plan.stages[2].exercises[0].name = 'Guaranteed recovery hangs';
      }),
    ],
    [
      'a stage title carrying a diagnosis (R6)',
      /^R6/,
      planWith((plan) => {
        plan.stages[0].title = 'You have a grade II strain';
      }),
    ],
  ])('CATCHES %s', (_label, rule, plan) => {
    const result = evaluatePlanContent(plan);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(rule);
    expect(result.ok === false && result.source).toBe('plan');
  });

  it('passes a realistic plan whose free text is ordinary rehab prose', () => {
    expect(evaluatePlanContent(PULLEY_PLAN)).toEqual({ ok: true });
  });

  it('does NOT fire R6 on the climbing sense of "grade" in the fields drafter.md puts it in', () => {
    // The surface where this regression actually bit. R6 was calibrated as a
    // coach-prose rule, where a hit costs the warmth of the plan and the
    // fallback still ships. Applied here it costs the visitor the whole plan
    // — `source: 'plan'` is a hard error — and "once you have a grade you can
    // climb comfortably" is what a legitimate `advanceWhen` criterion looks
    // like. drafter.md line 18 requires `allowedClimbing` to be phrased in
    // the visitor's own grade, so this vocabulary is mandated, not incidental.
    const graded = planWith((plan) => {
      plan.stages[2].advanceWhen = [
        'Once you have a grade you can climb comfortably, you are ready',
        'Full pain-free range in the finger',
      ];
      plan.stages[3].allowedClimbing =
        'Cautious return to normal bouldering, several number grades below your max.';
    });
    expect(evaluatePlanContent(graded)).toEqual({ ok: true });
  });

  it('still CATCHES the clinical grading sense in a plan field', () => {
    // Narrowing the phrase must not disarm it: this is the assertion R6 was
    // written for, and it must not reach a visitor through the fallback.
    const result = evaluatePlanContent(
      planWith((plan) => {
        plan.stages[0].exercises[0].notes =
          'You have a grade 2 strain, so keep the load light.';
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R6/);
    expect(result.ok === false && result.source).toBe('plan');
  });

  it('does NOT fire on the traffic-light and safety language the drafter is told to write', () => {
    // drafter.md's own words, in the fields it writes them in. A rule that
    // rejected these would reject the plans that followed the prompt.
    const conformant = planWith((plan) => {
      plan.stages[0].allowedClimbing = 'No climbing yet, and no crimping of any kind.';
      plan.stages[1].advanceWhen = [
        'Pain during activity no more than about 3 out of 10, settling by the next morning',
        'Take your time and work through it one stage at a time',
      ];
      plan.stages[2].exercises[0].notes =
        'You rebuild power through progressive loading, not through big jumps.';
      plan.overallCaution =
        'Pain at rest that does not improve within a couple of weeks deserves a professional assessment; no timeline here is guaranteed.';
    });
    expect(evaluatePlanContent(conformant)).toEqual({ ok: true });
  });

  it('is reached by evaluateCoachOutput before any coach-side rule', () => {
    const result = evaluateCoachOutput(
      coachOutput(medicatedPlan),
      medicatedPlan,
      PULLEY_INPUT,
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.source).toBe('plan');
  });

  it('CATCHES it even when the coach quietly dropped the offending note', () => {
    // coachOutput never renders `notes`, so this document is clean prose.
    // A coach-only rule set would pass it and ship the plan — and the
    // fallback would still have been holding the medication advice.
    const text = coachOutput(medicatedPlan);
    expect(text).not.toContain('ibuprofen');
    const result = evaluateCoachOutput(text, medicatedPlan, PULLEY_INPUT);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/^R5/);
  });

  it('marks a coach-only violation as repairable, so the fallback still runs', () => {
    const result = evaluate(
      coachOutput(PULLEY_PLAN, {
        closing: 'Take ibuprofen for the first few days.',
      }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.source).toBe('coach');
  });

  it('proves why the source matters: the fallback would re-ship the text', () => {
    // This is the laundering the invariant forbids, demonstrated rather than
    // asserted. renderPlanFallback prints drafter fields verbatim, so a
    // caller answering a `plan`-source failure with it would hand the visitor
    // the medication advice — without even the coach's hedging.
    expect(renderPlanFallback(medicatedPlan)).toContain(MEDICATED_NOTE);
  });
});

describe('renderPlanFallback', () => {
  it('produces a complete plan in the format the page already parses', () => {
    const text = renderPlanFallback(PULLEY_PLAN);
    expect(text.match(/^## Stage \d+:/gm)).toHaveLength(4);
    for (const label of [
      '**When:**',
      '**Climbing:**',
      '**Do this:**',
      '**Move on when:**',
    ]) {
      expect(text.split(label)).toHaveLength(5); // one per stage
    }
    // The doses are the drafter's, rendered by code.
    expect(text).toContain('- Tendon glides — 3 sets of 10, 7 times a week');
    // No stage is dropped, so no partial-plan state is possible here.
    expect(text).toContain('Back to the wall');
  });

  it('carries the drafted overallCaution into its closing', () => {
    const text = renderPlanFallback({
      ...PULLEY_PLAN,
      overallCaution: 'Rest pain that lingers deserves a professional look.',
    });
    expect(text).toContain('Rest pain that lingers deserves a professional look.');
  });

  it('is itself clean under the guard, on both pain behaviors', () => {
    // The fallback must never trip the rules it exists to satisfy.
    expect(
      evaluateCoachOutput(
        renderPlanFallback(PULLEY_PLAN),
        PULLEY_PLAN,
        PULLEY_INPUT,
      ),
    ).toEqual({ ok: true });

    const withCaution: DraftPlan = {
      ...PULLEY_PLAN,
      overallCaution:
        'Pain that stays constant at rest and does not improve within a couple of weeks deserves a professional assessment.',
    };
    expect(
      evaluateCoachOutput(renderPlanFallback(withCaution), withCaution, {
        injuryArea: 'finger_pulley',
        painBehavior: 'constant_even_at_rest',
      }),
    ).toEqual({ ok: true });
  });
});

describe('resolveGuardMode', () => {
  const original = process.env.BETA_OUTPUT_GUARD_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.BETA_OUTPUT_GUARD_MODE;
    else process.env.BETA_OUTPUT_GUARD_MODE = original;
  });

  it.each([
    [undefined, 'off'],
    ['', 'off'],
    ['off', 'off'],
    ['nonsense', 'off'],
    ['shadow', 'shadow'],
    ['enforce', 'enforce'],
  ])('resolves %j to %j', (value, expected) => {
    if (value === undefined) delete process.env.BETA_OUTPUT_GUARD_MODE;
    else process.env.BETA_OUTPUT_GUARD_MODE = value;
    expect(resolveGuardMode()).toBe(expected);
  });
});
