import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

import type { Classification, FeedbackPayload } from './types';

let client: SESv2Client | undefined;

function getClient(): SESv2Client {
  if (!client) {
    client = new SESv2Client({});
  }
  return client;
}

function buildSubject(payload: FeedbackPayload, classification: Classification): string {
  return `[Feedback:${classification.label}] ${payload.source}${
    payload.category ? ` / ${payload.category}` : ''
  }`;
}

function buildBody(payload: FeedbackPayload, classification: Classification): string {
  const lines = [
    `Source: ${payload.source}`,
    `Category: ${payload.category ?? '(none)'}`,
    `Created at: ${payload.createdAt}`,
    `Classification: ${classification.label}`,
  ];
  if (classification.summary) {
    lines.push(`Summary: ${classification.summary}`);
  }
  lines.push('', 'Message:', payload.message);
  return lines.join('\n');
}

/**
 * Sends the classified feedback email via SES v2. Deliberately does not
 * catch: a send failure here is meant to fail the Lambda invocation so the
 * CloudWatch Errors alarm fires (AC-C3). Classification failures must never
 * reach this function without a fallback — see classify.ts.
 */
export async function sendFeedbackEmail(
  payload: FeedbackPayload,
  classification: Classification,
): Promise<void> {
  const ownerEmail = process.env.OWNER_EMAIL;
  if (!ownerEmail) {
    throw new Error('OWNER_EMAIL env var is not set');
  }

  await getClient().send(
    new SendEmailCommand({
      FromEmailAddress: ownerEmail,
      Destination: { ToAddresses: [ownerEmail] },
      Content: {
        Simple: {
          // Charset is required on both: SES falls back to 7-bit ASCII when
          // it is unspecified, which mangles non-ASCII feedback (accents,
          // em dashes, emoji) before it reaches the owner. AC-C1 requires
          // the email to carry the full message.
          Subject: { Data: buildSubject(payload, classification), Charset: 'UTF-8' },
          Body: { Text: { Data: buildBody(payload, classification), Charset: 'UTF-8' } },
        },
      },
    }),
  );
}
