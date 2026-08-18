import { ImageResponse } from 'next/og';

// OG card in Beta's OWN identity (AC-10): chalk canvas, ink display type,
// one terracotta accent, hold-colored dots — deliberately not the
// portfolio's terminal theme. The font loader below is an inline copy of
// the src/lib/og-font.ts technique for a different family (that file is
// owned by the root OG image and stays untouched).

export const alt = 'Beta — a staged return-to-climbing planner by Tony Chou';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const TITLE = 'Beta';
const SUBTITLE = 'A staged return-to-climbing planner — three AI agents, hard safety rails';
const KICKER = 'Return-to-climbing rehab planner';
const CHIP = 'V0 → V5';

// Same approach as src/lib/og-font.ts: ask Google Fonts' css2 endpoint for
// the family without a browser Accept header so it returns a TTF/OTF src
// (Satori cannot parse WOFF2), subset to only the glyphs actually drawn.
async function loadBricolage(weight: 400 | 700, text: string): Promise<ArrayBuffer> {
  const family = encodeURIComponent(`Bricolage Grotesque:wght@${weight}`);
  const url = `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(opentype|truetype)'\)/);
  if (!match) throw new Error('Could not resolve Bricolage Grotesque font source');
  const response = await fetch(match[1]);
  if (response.status !== 200) {
    throw new Error('Failed to download Bricolage Grotesque font data');
  }
  return response.arrayBuffer();
}

const HOLD_COLORS = ['#0e7490', '#1d4ed8', '#7e22ce', '#a16207', '#c2410c'];

export default async function Image() {
  const [regular, bold] = await Promise.all([
    loadBricolage(400, SUBTITLE + KICKER + CHIP),
    loadBricolage(700, TITLE + CHIP),
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
          backgroundColor: '#faf7f2',
          padding: '80px',
          fontFamily: 'Bricolage Grotesque',
          position: 'relative',
        }}
      >
        {/* Topo contour flavor: nested rounded-border rings, Satori-safe. */}
        <div
          style={{
            position: 'absolute',
            right: '-260px',
            top: '-300px',
            width: '760px',
            height: '760px',
            border: '3px solid #e3dbcd',
            borderRadius: '380px',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: '-160px',
            top: '-210px',
            width: '560px',
            height: '560px',
            border: '3px solid #e3dbcd',
            borderRadius: '280px',
            display: 'flex',
          }}
        />
        <div
          style={{
            position: 'absolute',
            right: '-60px',
            top: '-120px',
            width: '360px',
            height: '360px',
            border: '3px solid #e3dbcd',
            borderRadius: '180px',
            display: 'flex',
          }}
        />

        <div style={{ display: 'flex', fontSize: 30, color: '#6f6757' }}>{KICKER}</div>

        <div style={{ display: 'flex', alignItems: 'flex-end' }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Bricolage Grotesque Bold',
              fontSize: 176,
              fontWeight: 700,
              color: '#241f16',
              lineHeight: 1.05,
            }}
          >
            {TITLE}
          </div>
          <div
            style={{
              display: 'flex',
              width: '30px',
              height: '30px',
              borderRadius: '15px',
              backgroundColor: '#c2410c',
              marginBottom: '38px',
              marginLeft: '12px',
            }}
          />
          <div
            style={{
              display: 'flex',
              marginLeft: '40px',
              marginBottom: '40px',
              padding: '10px 28px',
              border: '3px solid #c2410c',
              borderRadius: '999px',
              color: '#9a3412',
              fontFamily: 'Bricolage Grotesque Bold',
              fontSize: 34,
              fontWeight: 700,
            }}
          >
            {CHIP}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            fontSize: 38,
            color: '#453e31',
            marginTop: 24,
            maxWidth: '900px',
          }}
        >
          {SUBTITLE}
        </div>

        {/* Hold-dot row — the playful climbing note. */}
        <div style={{ display: 'flex', gap: '18px', marginTop: 48 }}>
          {HOLD_COLORS.map((color) => (
            <div
              key={color}
              style={{
                display: 'flex',
                width: '26px',
                height: '26px',
                borderRadius: '13px',
                backgroundColor: color,
              }}
            />
          ))}
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Bricolage Grotesque', data: regular, weight: 400, style: 'normal' },
        { name: 'Bricolage Grotesque Bold', data: bold, weight: 700, style: 'normal' },
      ],
    },
  );
}
