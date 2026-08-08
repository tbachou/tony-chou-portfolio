import { ImageResponse } from 'next/og';

export const size = { width: 64, height: 64 };
export const contentType = 'image/png';

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0a0a0f',
          border: '3px solid #39ff14',
          borderRadius: '6px',
          color: '#39ff14',
          fontSize: 36,
          fontWeight: 700,
        }}
      >
        {'>_'}
      </div>
    ),
    size,
  );
}
