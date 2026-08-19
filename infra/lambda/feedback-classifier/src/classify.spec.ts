import type { FeedbackPayload } from './types';

const mockBedrockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockBedrockSend })),
  ConverseCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

const PAYLOAD: FeedbackPayload = {
  id: 'cuid_abc',
  source: 'portfolio',
  category: 'bug',
  message: 'Plan generator stalls midway, requires restart',
  createdAt: '2026-08-19T12:00:00.000Z',
};

/** The shape Converse actually returns for a forced tool call. */
function toolUseResponse(input: unknown) {
  return {
    output: {
      message: {
        content: [{ toolUse: { name: 'report_classification', toolUseId: 'tu_1', input } }],
      },
    },
  };
}

describe('classify', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.resetModules();
    process.env.BEDROCK_MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
  });

  it('returns the classification from the toolUse input block', async () => {
    mockBedrockSend.mockResolvedValueOnce(
      toolUseResponse({ label: 'bug', summary: 'Plan generator stalls, needs restart' }),
    );

    const { classify } = await import('./classify');

    await expect(classify(PAYLOAD)).resolves.toEqual({
      label: 'bug',
      summary: 'Plan generator stalls, needs restart',
    });
  });

  it('forces the report_classification tool and constrains the label enum', async () => {
    mockBedrockSend.mockResolvedValueOnce(
      toolUseResponse({ label: 'praise', summary: 'nice site' }),
    );

    const { classify } = await import('./classify');
    await classify(PAYLOAD);

    expect(mockBedrockSend).toHaveBeenCalledTimes(1);
    const command = mockBedrockSend.mock.calls[0][0].input;

    // This is the assertion that actually prevents the regression: without a
    // forced toolChoice the model is free to answer in prose (it shipped a
    // markdown-fenced JSON blob in production, which never parsed).
    expect(command.toolConfig.toolChoice).toEqual({
      tool: { name: 'report_classification' },
    });

    const toolSpec = command.toolConfig.tools[0].toolSpec;
    expect(toolSpec.name).toBe('report_classification');
    expect(toolSpec.inputSchema.json.properties.label.enum).toEqual([
      'bug',
      'feature',
      'praise',
      'other',
    ]);
    expect(toolSpec.inputSchema.json.required).toEqual(['label', 'summary']);
  });

  it('falls back to unclassified when the response has no toolUse block', async () => {
    mockBedrockSend.mockResolvedValueOnce({
      output: {
        message: {
          content: [
            { text: '```json\n{"label": "bug", "summary": "stalls midway"}\n```' },
          ],
        },
      },
    });

    const { classify } = await import('./classify');

    await expect(classify(PAYLOAD)).resolves.toEqual({
      label: 'unclassified',
      summary: '',
    });
  });

  it('falls back to unclassified when the label is not one of the allowed values', async () => {
    mockBedrockSend.mockResolvedValueOnce(
      toolUseResponse({ label: 'spam', summary: 'whatever' }),
    );

    const { classify } = await import('./classify');

    await expect(classify(PAYLOAD)).resolves.toEqual({
      label: 'unclassified',
      summary: '',
    });
  });

  it('falls back to unclassified when the label is absent', async () => {
    mockBedrockSend.mockResolvedValueOnce(toolUseResponse({ summary: 'no label here' }));

    const { classify } = await import('./classify');

    await expect(classify(PAYLOAD)).resolves.toEqual({
      label: 'unclassified',
      summary: '',
    });
  });

  it('falls back to unclassified when summary is not a string', async () => {
    mockBedrockSend.mockResolvedValueOnce(toolUseResponse({ label: 'bug', summary: 42 }));

    const { classify } = await import('./classify');

    await expect(classify(PAYLOAD)).resolves.toEqual({
      label: 'unclassified',
      summary: '',
    });
  });

  it('falls back to unclassified when the tool input is not an object', async () => {
    mockBedrockSend.mockResolvedValueOnce(toolUseResponse('just a string'));

    const { classify } = await import('./classify');

    await expect(classify(PAYLOAD)).resolves.toEqual({
      label: 'unclassified',
      summary: '',
    });
  });

  it('never throws when the SDK call rejects (AC-C2)', async () => {
    mockBedrockSend.mockRejectedValueOnce(new Error('ThrottlingException'));

    const { classify } = await import('./classify');

    await expect(classify(PAYLOAD)).resolves.toEqual({
      label: 'unclassified',
      summary: '',
    });
  });
});
