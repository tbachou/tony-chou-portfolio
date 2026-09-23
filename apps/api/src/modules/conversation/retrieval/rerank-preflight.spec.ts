import { RERANK_MODEL_ID, type SystemOneCaller } from './reranker.js';
import { rerankPreflight } from './rerank-preflight.js';

/** The eval's reranking preflight (spec 0012 phase six, AC-10). Fully mocked. */

const answering = (noul: number) =>
  ({
    systemOne: vi.fn(() =>
      Promise.resolve({
        model: RERANK_MODEL_ID,
        answers: { c0: { type: 'noul', noul } },
        usage: { input_tokens: 40, output_tokens: 0 },
      }),
    ),
  }) as unknown as SystemOneCaller;

describe('rerankPreflight', () => {
  const saved = process.env.TYPESAFE_API_KEY;
  beforeEach(() => {
    process.env.TYPESAFE_API_KEY = 'test-key';
  });
  afterEach(() => {
    if (saved === undefined) delete process.env.TYPESAFE_API_KEY;
    else process.env.TYPESAFE_API_KEY = saved;
  });

  it('refuses without a key, before calling anything', async () => {
    delete process.env.TYPESAFE_API_KEY;
    const caller = answering(0.9);
    const result = await rerankPreflight(caller);
    expect(result).toEqual({ ok: false, reason: 'TYPESAFE_API_KEY is not set' });
    expect((caller as unknown as { systemOne: ReturnType<typeof vi.fn> }).systemOne).not.toHaveBeenCalled();
  });

  it('refuses when the provider does not answer, naming why', async () => {
    const failing = {
      systemOne: vi.fn(() =>
        Promise.reject(Object.assign(new Error('nope'), { name: 'AuthenticationError', status: 401 })),
      ),
    } as unknown as SystemOneCaller;
    const result = await rerankPreflight(failing);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toContain('AuthenticationError:401');
  });

  it('passes when a judgement comes back, whatever its value', async () => {
    // A preflight checks the path works, not the model's opinion of a fixed
    // sentence, so a low judgement is still a pass.
    expect(await rerankPreflight(answering(0.9))).toEqual({ ok: true });
    expect(await rerankPreflight(answering(0.1))).toEqual({ ok: true });
  });
});
