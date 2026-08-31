import { ImageResponse } from 'next/og';
import { DIMENSIONS, loadPublished, loadRun } from '@/lib/evals';
import { loadIbmPlexMono } from '@/lib/og-font';

// The evals card in the portfolio's terminal identity, and the one card on
// this site that carries live numbers.
//
// They come from the same loader the page uses, for the same reason the page
// reads the record instead of restating it: a card with a hand typed score
// would be a second copy of the number, which is the exact failure the whole
// suite exists to argue against. It adds no failure mode the page does not
// already have, since a record too broken to render is a record too broken to
// draw.

export const alt =
  'Interview simulator evals — the published measurement record for the AI that answers as Tony Chou';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PROMPT = 'tonychou@portfolio:~/projects/interview-simulator/evals$ cat scoreboard.md';
const HEADLINE = 'Interview simulator evals';
const SUBTITLE = 'Every run published, including the phases where nothing moved.';

const CANVAS = '#0a0a0f';
const INK = '#39ff14';
const BODY = '#5fcc5f';
const MUTED = '#608c60';
const BORDER = '#458045';

export default async function Image() {
  const manifest = loadPublished();
  const latest = [...manifest.publishedRuns].reverse().find((entry) => entry.measured);
  const run = latest ? loadRun(latest) : null;
  const cells = DIMENSIONS.map((dimension) => ({
    label: dimension,
    value: run?.perDimension[dimension].mean ?? null
  }));

  const glyphs =
    PROMPT + SUBTITLE + cells.map((c) => c.label).join('') + cells.map((c) => c.value).join('');
  const [regular, bold] = await Promise.all([
    loadIbmPlexMono(400, glyphs),
    loadIbmPlexMono(700, HEADLINE + '0123456789.—')
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

        <div style={{ display: 'flex', fontSize: 22, color: MUTED, fontWeight: 400 }}>{PROMPT}</div>

        <div
          style={{
            display: 'flex',
            marginTop: 24,
            fontSize: 72,
            fontWeight: 700,
            color: INK,
            letterSpacing: '-0.02em'
          }}
        >
          {HEADLINE}
        </div>

        <div style={{ display: 'flex', marginTop: 20, fontSize: 28, color: BODY, lineHeight: 1.45 }}>
          {SUBTITLE}
        </div>

        <div style={{ display: 'flex', marginTop: 48, gap: '20px' }}>
          {cells.map((cell) => (
            <div
              key={cell.label}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'flex-start',
                justifyContent: 'center',
                width: '320px',
                padding: '24px 28px',
                border: `1px solid ${BORDER}`
              }}
            >
              <div style={{ display: 'flex', fontSize: 24, color: MUTED }}>{cell.label}</div>
              <div
                style={{ display: 'flex', marginTop: 10, fontSize: 64, fontWeight: 700, color: INK }}
              >
                {cell.value === null ? '—' : cell.value.toFixed(3)}
              </div>
            </div>
          ))}
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
