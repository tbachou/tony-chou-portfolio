import { ImageResponse } from 'next/og';
import { notFound } from 'next/navigation';
import { loadIbmPlexMono } from '@/lib/og-font';

// OG card in the portfolio's terminal identity (AC-10): CRT canvas, one
// glowing phosphor green, monospace throughout, shell-output framing. It
// reuses the root card's font loader rather than copying it, since this page
// shares the site's family.
//
// Deliberately names no grade and shows no photo. The card is the pre-guess
// surface as much as the page is, and a V-grade on a shared link would hand
// the answer over before anyone played (AC-2).

/**
 * Gated on the same flag as the route, and that is not belt and braces.
 *
 * An `opengraph-image` file is its OWN route in the App Router: `page.tsx`
 * calling `notFound()` does nothing for it, so while the game was dark this
 * card was served as a 200 to anyone who requested it. That is precisely the
 * failure spec 0006 already took once, when the feature flag gated the route
 * and the api module but NOT the static seed photos, and they sat on the open
 * internet for the whole time the game was supposedly hidden.
 *
 * The card carries no photo and no grade, so nothing here was sensitive. It
 * still advertised an unreleased feature, and the rule the earlier incident
 * bought is that the flag governs everything the route serves, not just the
 * page component.
 */
const gradeGameEnabled = process.env.GRADE_GAME_ENABLED === 'true';

export const alt = 'Grade Guesser — call the grade on a real boulder problem, then see how Claude read it';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PROMPT = 'tonychou@portfolio:~/grade$ ./grade-guesser';
const HEADLINE = 'Grade Guesser';
const SUBTITLE = 'Read the wall. Call the grade. See how Claude read the same photo.';

// The V scale as a row of cells, one of them "selected" the way a curses menu
// draws its current row — the same inversion design.md uses for hover.
const GRADES = ['V0', 'V1', 'V2', 'V3', 'V4', 'V5', 'V6', 'V7', 'V8'];
const SELECTED = 'V4';

const CANVAS = '#0a0a0f';
const INK = '#39ff14';
const BODY = '#5fcc5f';
const MUTED = '#608c60';
const BORDER = '#458045';

export default async function Image() {
  if (!gradeGameEnabled) notFound();

  const [regular, bold] = await Promise.all([
    loadIbmPlexMono(400, PROMPT + SUBTITLE + GRADES.join('')),
    loadIbmPlexMono(700, HEADLINE + GRADES.join('')),
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
          position: 'relative',
        }}
      >
        {/* Scanline texture, drawn as a repeating gradient rather than as many
            elements so Satori has one node to rasterise instead of hundreds. */}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            backgroundImage:
              'repeating-linear-gradient(180deg, rgba(57,255,20,0.05) 0px, rgba(57,255,20,0.05) 1px, transparent 1px, transparent 4px)',
          }}
        />

        <div style={{ display: 'flex', fontSize: 26, color: MUTED, fontWeight: 400 }}>
          {PROMPT}
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 28,
            fontSize: 92,
            fontWeight: 700,
            color: INK,
            letterSpacing: '-0.02em',
          }}
        >
          {HEADLINE}
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 24,
            fontSize: 30,
            color: BODY,
            maxWidth: '900px',
            lineHeight: 1.45,
          }}
        >
          {SUBTITLE}
        </div>

        <div style={{ display: 'flex', marginTop: 56, gap: '12px' }}>
          {GRADES.map((grade) => {
            const on = grade === SELECTED;
            return (
              <div
                key={grade}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '96px',
                  height: '72px',
                  fontSize: 30,
                  fontWeight: 700,
                  border: `1px solid ${BORDER}`,
                  backgroundColor: on ? INK : 'transparent',
                  color: on ? CANVAS : BODY,
                }}
              >
                {grade}
              </div>
            );
          })}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'IBM Plex Mono', data: regular, weight: 400, style: 'normal' },
        { name: 'IBM Plex Mono', data: bold, weight: 700, style: 'normal' },
      ],
    }
  );
}
