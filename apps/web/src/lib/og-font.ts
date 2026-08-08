// Resolves a Google Fonts family to raw TTF bytes for use with next/og's
// ImageResponse (Satori, which renders text, needs the actual font data
// passed in - it has no access to system/browser fonts). The `text` param
// asks Google Fonts to subset the response to only the glyphs actually
// used, keeping the fetch small. Omitting a browser-like Accept header is
// what gets Google Fonts to return a TTF/OTF src instead of WOFF2, which
// Satori can't parse - this is the same approach Vercel's own OG image
// docs use.
export async function loadIbmPlexMono(
  weight: 400 | 500 | 700,
  text: string,
): Promise<ArrayBuffer> {
  const family = encodeURIComponent(`IBM Plex Mono:wght@${weight}`);
  const url = `https://fonts.googleapis.com/css2?family=${family}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const match = css.match(/src: url\(([^)]+)\) format\('(opentype|truetype)'\)/);
  if (!match) throw new Error('Could not resolve IBM Plex Mono font source');
  const response = await fetch(match[1]);
  if (response.status !== 200) {
    throw new Error('Failed to download IBM Plex Mono font data');
  }
  return response.arrayBuffer();
}
