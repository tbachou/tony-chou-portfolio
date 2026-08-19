import { Injectable, Logger } from '@nestjs/common';
import { PublishCommand, SNSClient } from '@aws-sdk/client-sns';
import type { FeedbackCategoryValue, FeedbackSourceValue } from './feedback.constants';

export type FeedbackPublishEvent = {
  id: string;
  source: FeedbackSourceValue;
  category: FeedbackCategoryValue | null;
  message: string;
  createdAt: string;
};

/**
 * Fire-and-forget SNS publisher for stored feedback (AC-I6). The topic ARN
 * gates everything: absent, publishing is disabled and a single WARN fires
 * at construction (Decision: "Missing topic config") — no per-request log
 * spam. When present, the SNS client is constructed lazily inside the same
 * guarded try/catch as the publish call (Decision: "Client construction
 * safety"), so a synchronous construction failure (e.g. missing
 * AWS_REGION) is swallowed and logged name-only exactly like a publish
 * failure, and can never throw into the request path.
 *
 * AC-I7: the message text must never appear in a log line. Every catch
 * below logs `error.name` only — never the error's message (which could
 * echo request data) and never the payload.
 */
@Injectable()
export class FeedbackSnsPublisher {
  private readonly logger = new Logger(FeedbackSnsPublisher.name);
  private readonly topicArn = process.env.SNS_FEEDBACK_TOPIC_ARN;

  constructor() {
    if (!this.topicArn) {
      this.logger.warn(
        'SNS_FEEDBACK_TOPIC_ARN is not configured; feedback publishing is disabled',
      );
    }
  }

  /** Never throws and never awaited by the caller's response path. */
  publish(event: FeedbackPublishEvent): void {
    if (!this.topicArn) return;

    void this.publishInternal(this.topicArn, event).catch((error: unknown) => {
      this.logger.error(
        `Feedback SNS publish failed: ${error instanceof Error ? error.name : 'unknown error'}`,
      );
    });
  }

  private async publishInternal(
    topicArn: string,
    event: FeedbackPublishEvent,
  ): Promise<void> {
    // Constructed here (not in the constructor) so a synchronous failure —
    // for example missing AWS_REGION — is caught by the same guarded path
    // as a publish failure, per the Decision's "Client construction safety"
    // resolution.
    const client = new SNSClient({});
    await client.send(
      new PublishCommand({
        TopicArn: topicArn,
        Message: JSON.stringify(event),
      }),
    );
  }
}
