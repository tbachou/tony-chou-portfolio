import type { SNSEvent } from 'aws-lambda';

const SECRET_MESSAGE_TEXT = 'my very secret feedback text 8f3c1a';

const mockBedrockSend = jest.fn();
const mockSesSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockBedrockSend })),
  ConverseCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

jest.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn().mockImplementation(() => ({ send: mockSesSend })),
  SendEmailCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

function buildEvent(overrides: Partial<Record<string, unknown>> = {}): SNSEvent {
  const payload = {
    id: 'cuid_abc',
    source: 'beta',
    category: 'feature',
    message: SECRET_MESSAGE_TEXT,
    createdAt: '2026-08-19T12:00:00.000Z',
    ...overrides,
  };
  return {
    Records: [
      {
        EventSource: 'aws:sns',
        EventVersion: '1.0',
        EventSubscriptionArn: 'arn:aws:sns:us-east-2:123456789012:portfolio-feedback-topic',
        Sns: {
          Type: 'Notification',
          MessageId: 'msg-1',
          TopicArn: 'arn:aws:sns:us-east-2:123456789012:portfolio-feedback-topic',
          Message: JSON.stringify(payload),
          Timestamp: '2026-08-19T12:00:00.000Z',
          SignatureVersion: '1',
          Signature: 'sig',
          SigningCertUrl: 'https://example.com/cert.pem',
          UnsubscribeUrl: 'https://example.com/unsubscribe',
          MessageAttributes: {},
          Subject: undefined,
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    ],
  };
}

describe('handler', () => {
  let consoleLogSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
    process.env.OWNER_EMAIL = 'owner@example.com';
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it('sends a classified email on the happy path and never logs message text', async () => {
    mockBedrockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [{ text: JSON.stringify({ label: 'feature', summary: 'wants dark mode' }) }],
        },
      },
    });
    mockSesSend.mockResolvedValueOnce({});

    const { handler } = await import('./index');
    await handler(buildEvent());

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const sesInput = mockSesSend.mock.calls[0][0].input;
    expect(sesInput.Content.Simple.Body.Text.Data).toContain(SECRET_MESSAGE_TEXT);

    // Log discipline (AC-C4): no log call may contain the message text.
    for (const call of consoleLogSpy.mock.calls) {
      const serialized = JSON.stringify(call);
      expect(serialized).not.toContain(SECRET_MESSAGE_TEXT);
    }
    // And the log line has exactly the allowed shape.
    const logged = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(Object.keys(logged).sort()).toEqual(['durationMs', 'id', 'label', 'outcome']);
    expect(logged).toMatchObject({ id: 'cuid_abc', label: 'feature', outcome: 'sent' });
  });

  it('still sends the email, marked unclassified, when Bedrock fails', async () => {
    mockBedrockSend.mockRejectedValueOnce(new Error('ThrottlingException'));
    mockSesSend.mockResolvedValueOnce({});

    const { handler } = await import('./index');
    await handler(buildEvent());

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const sesInput = mockSesSend.mock.calls[0][0].input;
    expect(sesInput.Content.Simple.Subject.Data).toContain('unclassified');

    const logged = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ label: 'unclassified', outcome: 'sent' });
  });

  it('still sends the email, marked unclassified, when Bedrock returns unparseable JSON', async () => {
    mockBedrockSend.mockResolvedValueOnce({
      output: { message: { content: [{ text: 'not json at all' }] } },
    });
    mockSesSend.mockResolvedValueOnce({});

    const { handler } = await import('./index');
    await handler(buildEvent());

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const logged = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(logged.label).toBe('unclassified');
  });

  it('throws and never calls SES when the payload is invalid, without logging message text', async () => {
    const { handler } = await import('./index');
    const badEvent = buildEvent({ source: 'not-a-real-source' });

    await expect(handler(badEvent)).rejects.toThrow();
    expect(mockSesSend).not.toHaveBeenCalled();

    for (const call of consoleLogSpy.mock.calls) {
      expect(JSON.stringify(call)).not.toContain(SECRET_MESSAGE_TEXT);
    }
    const logged = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ id: 'unknown', outcome: 'failed' });
  });

  it('propagates an SES failure so the invocation errors (AC-C3)', async () => {
    mockBedrockSend.mockResolvedValueOnce({
      output: { message: { content: [{ text: JSON.stringify({ label: 'bug', summary: 's' }) }] } },
    });
    mockSesSend.mockRejectedValueOnce(new Error('MessageRejected'));

    const { handler } = await import('./index');
    await expect(handler(buildEvent())).rejects.toThrow('MessageRejected');

    const logged = JSON.parse(consoleLogSpy.mock.calls[0][0] as string);
    expect(logged).toMatchObject({ id: 'cuid_abc', outcome: 'failed' });
  });
});
