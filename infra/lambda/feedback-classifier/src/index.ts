import type { SNSEvent, SNSEventRecord } from 'aws-lambda';

import { classify } from './classify';
import { sendFeedbackEmail } from './email';
import { parsePayload } from './payload';

// CRITICAL invariant (AC-C4 / umbrella cross-child contract): no log line
// may ever contain feedback message text. Log only this shape.
interface LogLine {
  id: string;
  label: string;
  outcome: 'sent' | 'failed';
  durationMs: number;
}

function log(line: LogLine): void {
  console.log(JSON.stringify(line));
}

async function processRecord(record: SNSEventRecord): Promise<void> {
  const start = Date.now();
  let id = 'unknown';

  try {
    // Throws on malformed payload — a shape violation from our own
    // publisher is itself worth surfacing via the Errors alarm.
    const payload = parsePayload(record.Sns.Message);
    id = payload.id;

    // classify() never throws (AC-C2): a Bedrock failure or unparseable
    // response falls back to { label: "unclassified", summary: "" }, so
    // email delivery below never depends on classification succeeding.
    const classification = await classify(payload);

    // sendFeedbackEmail() is allowed to throw: an SES failure should fail
    // this invocation so the CloudWatch Errors alarm fires (AC-C3).
    await sendFeedbackEmail(payload, classification);

    log({ id, label: classification.label, outcome: 'sent', durationMs: Date.now() - start });
  } catch (err) {
    log({ id, label: 'error', outcome: 'failed', durationMs: Date.now() - start });
    throw err;
  }
}

export async function handler(event: SNSEvent): Promise<void> {
  for (const record of event.Records) {
    await processRecord(record);
  }
}
