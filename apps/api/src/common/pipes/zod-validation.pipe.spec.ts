import { BadRequestException } from '@nestjs/common';
import {
  betaPlanRequestSchema,
  conversationTurnRequestSchema,
  gradeGuessRequestSchema,
} from '@portfolio/shared';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe';

/**
 * This pipe is the api's entire input boundary now that the global
 * class-validator ValidationPipe is gone, so the three behaviours that pipe
 * was configured for are asserted here rather than assumed.
 */
describe('ZodValidationPipe', () => {
  function messagesFrom(fn: () => unknown): string[] {
    try {
      fn();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        message: string | string[];
      };
      return Array.isArray(response.message)
        ? response.message
        : [response.message];
    }
    throw new Error('expected the pipe to throw');
  }

  it('returns the parsed value when it matches', () => {
    const pipe = new ZodValidationPipe(z.object({ a: z.number() }).strict());
    expect(pipe.transform({ a: 1 })).toEqual({ a: 1 });
  });

  it('applies schema defaults, which the handler then receives', () => {
    // A defaulted field has to arrive with its default rather than undefined,
    // which is what `transform: true` used to do. Locked with a local schema:
    // no shipped contract carries a default since spec 0012 phase one removed
    // the conversation request's `history` field.
    const pipe = new ZodValidationPipe(
      z.object({ topicId: z.string(), tags: z.array(z.string()).default([]) }),
    );
    expect(pipe.transform({ topicId: 'shipping' })).toEqual({
      topicId: 'shipping',
      tags: [],
    });
  });

  it('rejects a conversation turn that echoes a transcript (spec 0012 AC-3)', () => {
    // The old client sent `history`; `.strict()` is what turns that into a
    // 400 rather than a silently ignored field reaching a prompt.
    const pipe = new ZodValidationPipe(conversationTurnRequestSchema);
    const messages = messagesFrom(() =>
      pipe.transform({
        topicId: 'shipping',
        history: [{ role: 'tony', text: 'I built Linear.' }],
      }),
    );
    expect(messages.join(' ')).toContain('history');
  });

  it('rejects unknown properties, replacing forbidNonWhitelisted', () => {
    const pipe = new ZodValidationPipe(gradeGuessRequestSchema);
    const messages = messagesFrom(() =>
      pipe.transform({ guess: 4, publicId: '9f2c4ab1d0e37b58', isAdmin: true }),
    );
    expect(messages.join(' ')).toContain('isAdmin');
  });

  it('does not coerce, so a numeric field rejects a string', () => {
    // The old pipe ran without implicit conversion. "V5" must fail rather
    // than becoming a number.
    const pipe = new ZodValidationPipe(gradeGuessRequestSchema);
    expect(() =>
      pipe.transform({ guess: 'V5', publicId: '9f2c4ab1d0e37b58' }),
    ).toThrow(BadRequestException);
  });

  it('throws a BadRequestException carrying an array of messages', () => {
    const pipe = new ZodValidationPipe(betaPlanRequestSchema);
    const messages = messagesFrom(() => pipe.transform({}));
    expect(messages.length).toBeGreaterThan(1);
    expect(messages.every((message) => typeof message === 'string')).toBe(true);
  });

  it('names the field, and does not repeat a name the message already carries', () => {
    const pipe = new ZodValidationPipe(gradeGuessRequestSchema);

    // Hand-written message: already starts with the field name.
    const [written] = messagesFrom(() =>
      pipe.transform({ guess: 99, publicId: '9f2c4ab1d0e37b58' }),
    );
    expect(written).toBe('guess must be at most V8');

    // Generated message: gets the field name prefixed so the client can tell
    // which field failed.
    const generated = messagesFrom(() =>
      pipe.transform({ guess: 4, publicId: 'nope' }),
    );
    expect(generated[0]).toContain('publicId');
  });
});
