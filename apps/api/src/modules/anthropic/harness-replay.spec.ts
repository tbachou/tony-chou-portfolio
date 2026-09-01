import { toolLoopRefusalReason } from './harness-replay';

describe('toolLoopRefusalReason', () => {
  it('refuses replay, where a live call would contradict the run', () => {
    const reason = toolLoopRefusalReason('replay');
    expect(reason).toContain('replay');
    expect(reason).toContain('live model call');
  });

  it('allows record, which is a live run that saves what it spends', () => {
    // The bug this pins: refusing everything that was not `live` aborted a
    // record run, with a message telling it that it was pretending to be a
    // replay. Nothing about a record run misreports its spending.
    expect(toolLoopRefusalReason('record')).toBeNull();
  });

  it('allows live', () => {
    expect(toolLoopRefusalReason('live')).toBeNull();
  });
});
