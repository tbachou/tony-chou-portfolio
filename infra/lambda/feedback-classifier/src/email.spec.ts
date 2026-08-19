import type { Classification, FeedbackPayload } from './types';

// Non-ASCII on purpose: accents, an em dash, and an emoji all round-trip
// only when SES is told the charset (AC-C1, "the full message").
const NON_ASCII_MESSAGE = 'Le bouton ne marche pas — écran cassé 😞';

const mockSesSend = jest.fn();

jest.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: jest.fn().mockImplementation(() => ({ send: mockSesSend })),
  SendEmailCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

const PAYLOAD: FeedbackPayload = {
  id: 'cuid_abc',
  source: 'beta',
  category: 'bug',
  message: NON_ASCII_MESSAGE,
  createdAt: '2026-08-19T12:00:00.000Z',
};

const CLASSIFICATION: Classification = { label: 'bug', summary: 'bouton cassé' };

function sentInput(): {
  Content: {
    Simple: {
      Subject: { Data: string; Charset?: string };
      Body: { Text: { Data: string; Charset?: string } };
    };
  };
} {
  return mockSesSend.mock.calls[0][0].input;
}

describe('sendFeedbackEmail', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.OWNER_EMAIL = 'owner@example.com';
  });

  it('sends the subject and body as UTF-8 so non-ASCII feedback is not garbled', async () => {
    mockSesSend.mockResolvedValueOnce({});

    const { sendFeedbackEmail } = await import('./email');
    await sendFeedbackEmail(PAYLOAD, CLASSIFICATION);

    expect(mockSesSend).toHaveBeenCalledTimes(1);
    const { Subject, Body } = sentInput().Content.Simple;
    expect(Subject.Charset).toBe('UTF-8');
    expect(Body.Text.Charset).toBe('UTF-8');
    expect(Body.Text.Data).toContain(NON_ASCII_MESSAGE);
  });

  it('throws and never calls SES when OWNER_EMAIL is unset', async () => {
    delete process.env.OWNER_EMAIL;

    const { sendFeedbackEmail } = await import('./email');
    await expect(sendFeedbackEmail(PAYLOAD, CLASSIFICATION)).rejects.toThrow('OWNER_EMAIL');
    expect(mockSesSend).not.toHaveBeenCalled();
  });
});
