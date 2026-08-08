import { ImageResponse } from 'next/og';
import { loadIbmPlexMono } from '@/lib/og-font';
import { siteName } from '@/lib/site';

export const alt = siteName;
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const PROMPT = 'tonychou@portfolio:~$ whoami';
const HEADLINE = 'Tony Chou';
const SUBTITLE = 'Senior Software Engineer — TypeScript, React & AI-integrated products';

export default async function Image() {
  const [regular, bold] = await Promise.all([
    loadIbmPlexMono(400, PROMPT + SUBTITLE),
    loadIbmPlexMono(700, HEADLINE),
  ]);

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: '#0a0a0f',
          padding: '64px',
        }}
      >
        <div
          style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            border: '2px solid #458045',
            borderRadius: '6px',
            padding: '72px',
            fontFamily: 'IBM Plex Mono',
          }}
        >
          <div style={{ display: 'flex', fontSize: 30, color: '#608c60' }}>{PROMPT}</div>
          <div
            style={{
              display: 'flex',
              fontFamily: 'IBM Plex Mono Bold',
              fontSize: 104,
              fontWeight: 700,
              color: '#39ff14',
              marginTop: 20,
            }}
          >
            {HEADLINE}
          </div>
          <div style={{ display: 'flex', fontSize: 34, color: '#5fcc5f', marginTop: 28 }}>
            {SUBTITLE}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'IBM Plex Mono', data: regular, weight: 400, style: 'normal' },
        { name: 'IBM Plex Mono Bold', data: bold, weight: 700, style: 'normal' },
      ],
    },
  );
}
