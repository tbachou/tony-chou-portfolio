import { ImageResponse } from 'next/og';
import { loadIbmPlexMono } from '@/lib/og-font';

// The simulator's card in the portfolio's terminal identity: CRT canvas, one
// phosphor green, shell-output framing, same as the root and Grade Guesser
// cards. It leads with the honesty problem rather than with the demo, because
// that is what the project is actually about.

export const alt =
  'Interview Simulator — an AI that answers as Tony Chou, held to a git verified record';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PROMPT = 'tonychou@portfolio:~/projects/interview-simulator$ ./ask';
const HEADLINE = 'Interview simulator';
const SUBTITLE =
  'An AI answers interview questions as me. A deterministic guard decides what it is allowed to claim.';

const CANVAS = '#0a0a0f';
const INK = '#39ff14';
const BODY = '#5fcc5f';
const MUTED = '#608c60';

export default async function Image() {
  const [regular, bold] = await Promise.all([
    loadIbmPlexMono(400, PROMPT + SUBTITLE),
    loadIbmPlexMono(700, HEADLINE)
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          backgroundColor: CANVAS,
          padding: '80px',
          fontFamily: 'IBM Plex Mono',
          position: 'relative'
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            backgroundImage:
              'repeating-linear-gradient(180deg, rgba(57,255,20,0.05) 0px, rgba(57,255,20,0.05) 1px, transparent 1px, transparent 4px)'
          }}
        />

        <div style={{ display: 'flex', fontSize: 24, color: MUTED, fontWeight: 400 }}>{PROMPT}</div>

        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 84,
            fontWeight: 700,
            color: INK,
            letterSpacing: '-0.02em'
          }}
        >
          {HEADLINE}
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 30,
            color: BODY,
            maxWidth: '940px',
            lineHeight: 1.45
          }}
        >
          {SUBTITLE}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'IBM Plex Mono', data: regular, weight: 400, style: 'normal' },
        { name: 'IBM Plex Mono', data: bold, weight: 700, style: 'normal' }
      ]
    }
  );
}
