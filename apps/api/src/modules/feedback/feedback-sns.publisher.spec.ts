import { Logger } from '@nestjs/common';
import { FeedbackSnsPublisher } from './feedback-sns.publisher';

const SEND_MOCK = jest.fn();

// The real @aws-sdk/client-sns makes network calls; these tests must never
// touch the network, so the client is stubbed entirely. PublishCommand is
// kept real (a plain input holder) so the publisher's call shape is
// verified end to end.
jest.mock('@aws-sdk/client-sns', () => {
  const actual = jest.requireActual('@aws-sdk/client-sns');
  return {
    ...actual,
    SNSClient: jest.fn().mockImplementation(() => ({ send: SEND_MOCK })),
  };
});

const SECRET_MESSAGE_TEXT = 'the visitor typed something very specific here';

const EVENT = {
  id: 'cfeedback1',
  source: 'portfolio' as const,
  category: 'bug' as const,
  message: SECRET_MESSAGE_TEXT,
  createdAt: '2026-08-19T12:00:00.000Z',
};

describe('FeedbackSnsPublisher', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  describe('construction', () => {
    it('logs a single WARN when SNS_FEEDBACK_TOPIC_ARN is absent', () => {
      delete process.env.SNS_FEEDBACK_TOPIC_ARN;
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      new FeedbackSnsPublisher();

      expect(warnSpy).toHaveBeenCalledTimes(1);
      expect(warnSpy.mock.calls[0][0]).toEqual(
        expect.stringContaining('SNS_FEEDBACK_TOPIC_ARN'),
      );
    });

    it('does not warn when the topic ARN is configured', () => {
      process.env.SNS_FEEDBACK_TOPIC_ARN = 'arn:aws:sns:us-east-2:1:topic';
      const warnSpy = jest
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);

      new FeedbackSnsPublisher();

      expect(warnSpy).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('is a no-op when the topic ARN is absent (no client constructed)', async () => {
      delete process.env.SNS_FEEDBACK_TOPIC_ARN;
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const publisher = new FeedbackSnsPublisher();

      publisher.publish(EVENT);
      await Promise.resolve();

      expect(SEND_MOCK).not.toHaveBeenCalled();
    });

    it('publishes the exact payload shape from the spec when the topic ARN is set', async () => {
      process.env.SNS_FEEDBACK_TOPIC_ARN = 'arn:aws:sns:us-east-2:1:topic';
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      SEND_MOCK.mockResolvedValue({});
      const publisher = new FeedbackSnsPublisher();

      publisher.publish(EVENT);
      await Promise.resolve();
      await Promise.resolve();

      expect(SEND_MOCK).toHaveBeenCalledTimes(1);
      const command = SEND_MOCK.mock.calls[0][0];
      expect(command.input.TopicArn).toBe('arn:aws:sns:us-east-2:1:topic');
      expect(JSON.parse(command.input.Message)).toEqual({
        id: 'cfeedback1',
        source: 'portfolio',
        category: 'bug',
        message: SECRET_MESSAGE_TEXT,
        createdAt: '2026-08-19T12:00:00.000Z',
      });
    });

    it('never throws when the publish call rejects, and logs the error name only — never the message text', async () => {
      process.env.SNS_FEEDBACK_TOPIC_ARN = 'arn:aws:sns:us-east-2:1:topic';
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const failure = new Error(
        `rejected while publishing: ${SECRET_MESSAGE_TEXT}`,
      );
      failure.name = 'ServiceUnavailableError';
      SEND_MOCK.mockRejectedValue(failure);
      const publisher = new FeedbackSnsPublisher();

      expect(() => publisher.publish(EVENT)).not.toThrow();
      // Let the fire-and-forget microtask chain settle.
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0][0] as string;
      expect(logged).toEqual(expect.stringContaining('ServiceUnavailableError'));
      expect(logged).not.toEqual(expect.stringContaining(SECRET_MESSAGE_TEXT));
    });

    it('swallows a synchronous client construction failure the same way as a publish failure (name only, no throw)', async () => {
      process.env.SNS_FEEDBACK_TOPIC_ARN = 'arn:aws:sns:us-east-2:1:topic';
      jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
      const errorSpy = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      const constructionFailure = new Error('missing AWS_REGION');
      constructionFailure.name = 'ConfigurationError';
      const { SNSClient } = jest.requireMock('@aws-sdk/client-sns') as {
        SNSClient: jest.Mock;
      };
      SNSClient.mockImplementationOnce(() => {
        throw constructionFailure;
      });
      const publisher = new FeedbackSnsPublisher();

      expect(() => publisher.publish(EVENT)).not.toThrow();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(errorSpy).toHaveBeenCalledTimes(1);
      const logged = errorSpy.mock.calls[0][0] as string;
      expect(logged).toEqual(expect.stringContaining('ConfigurationError'));
      expect(logged).not.toEqual(expect.stringContaining(SECRET_MESSAGE_TEXT));
    });
  });
});
