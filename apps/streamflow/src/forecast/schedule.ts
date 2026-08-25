import { ISSUE_INTERVAL_HOURS } from '../config';

const HOUR_MS = 60 * 60 * 1000;

/**
 * When a forecast claims to have been made.
 *
 * The live pipeline runs on a six hourly cron, and GitHub is candid that it
 * runs scheduled workflows late under load. A prediction stamped with the
 * wall clock would drift: 06:00 one week, 06:11 the next, and the hindcast,
 * which walks exact six hourly slots, would then be issuing at instants the
 * live record never uses. Snapping to the slot the run was *for* keeps the
 * two comparable, and it makes the unique key on
 * (gauge, model, issuedAt, targetTime) do real work: a retried run lands on
 * the same slot and writes nothing new, which is what AC-I11 needs, since a
 * prediction's bounds are written once and never recomputed.
 */
export function mostRecentIssueSlot(now: Date): Date {
  const step = ISSUE_INTERVAL_HOURS * HOUR_MS;
  return new Date(Math.floor(now.getTime() / step) * step);
}

/**
 * Every issue slot from `from` up to and including `to`, oldest first.
 *
 * The seeding hindcast walks these so its simulated issue times land on the
 * same instants the live cron uses. `from` is rounded up to a slot, so a
 * backfill start that is not itself on one cannot produce an off cadence
 * first prediction.
 */
export function issueSlots(from: Date, to: Date): Date[] {
  const step = ISSUE_INTERVAL_HOURS * HOUR_MS;
  const first = Math.ceil(from.getTime() / step) * step;
  const last = mostRecentIssueSlot(to).getTime();

  const slots: Date[] = [];
  for (let instant = first; instant <= last; instant += step) {
    slots.push(new Date(instant));
  }
  return slots;
}
