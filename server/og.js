import sharp from 'sharp';

const imageCache = new Map();
const maxCacheEntries = 100;

function escapeXml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function wrapText(text, maxChars, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';

  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > maxChars && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
    if (lines.length === maxLines) break;
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (words.length && lines.length === maxLines) {
    const consumed = lines.join(' ').split(/\s+/).length;
    if (consumed < words.length) lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:]?$/, '')}...`;
  }
  return lines;
}

function cacheSet(key, value) {
  if (imageCache.size >= maxCacheEntries) {
    const oldest = imageCache.keys().next().value;
    imageCache.delete(oldest);
  }
  imageCache.set(key, value);
}

export function getOgImageCacheKey(article) {
  return `${article.slug}:${article.updated_at || article.created_at || ''}`;
}

export async function renderArticleOgImage(article) {
  const cacheKey = getOgImageCacheKey(article);
  if (imageCache.has(cacheKey)) return imageCache.get(cacheKey);

  const titleLines = wrapText(article.title, 22, 4);
  const subtitleLines = wrapText(article.subtitle || article.summary || '', 38, 2);
  const category = escapeXml(article.category || 'Research');
  const date = article.created_at ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(article.created_at)) : '';

  const titleSvg = titleLines.map((line, index) => (
    `<text x="326" y="${168 + index * 56}" font-size="48" font-weight="900" fill="#f7f7f2">${escapeXml(line)}</text>`
  )).join('');

  const subtitleY = Math.min(168 + titleLines.length * 56 + 28, 438);
  const subtitleSvg = subtitleLines.map((line, index) => (
    `<text x="330" y="${subtitleY + index * 29}" font-size="24" font-weight="500" fill="rgba(247,247,242,0.70)">${escapeXml(line)}</text>`
  )).join('');

  const svg = `
    <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#0b0c0b"/>
          <stop offset="0.58" stop-color="#14170d"/>
          <stop offset="1" stop-color="#222a11"/>
        </linearGradient>
        <pattern id="grid" width="52" height="52" patternUnits="userSpaceOnUse">
          <path d="M 52 0 L 0 0 0 52" fill="none" stroke="rgba(230,255,63,0.08)" stroke-width="1"/>
        </pattern>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="22" result="blur"/>
          <feMerge>
            <feMergeNode in="blur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      <rect width="1200" height="630" fill="url(#bg)"/>
      <rect width="1200" height="630" fill="url(#grid)"/>
      <circle cx="1018" cy="116" r="170" fill="rgba(230,255,63,0.10)" filter="url(#glow)"/>
      <circle cx="96" cy="510" r="150" fill="rgba(230,255,63,0.08)" filter="url(#glow)"/>
      <rect x="790" y="82" width="300" height="420" rx="8" fill="rgba(0,0,0,0.18)" stroke="rgba(255,255,255,0.08)"/>
      <path d="M830 392 L870 330 L912 358 L952 250 L1002 312 L1038 205 L1072 348" fill="none" stroke="#e6ff3f" stroke-width="15" stroke-linecap="round" stroke-linejoin="round"/>
      <rect x="830" y="442" width="66" height="34" rx="5" fill="#c92605"/>
      <rect x="912" y="424" width="66" height="52" rx="5" fill="#657400"/>
      <rect x="994" y="390" width="66" height="86" rx="5" fill="#e6ff3f"/>
      <rect x="1060" y="350" width="30" height="126" rx="5" fill="#c92605"/>
      <rect x="326" y="60" width="220" height="48" rx="24" fill="rgba(230,255,63,0.12)" stroke="rgba(230,255,63,0.42)"/>
      <text x="352" y="92" font-size="21" font-weight="800" fill="#e6ff3f">${category}</text>
      ${titleSvg}
      ${subtitleSvg}
      <rect x="326" y="520" width="500" height="1" fill="rgba(230,255,63,0.24)"/>
      <text x="330" y="560" font-size="28" font-weight="900" fill="#e6ff3f">CiteDrop</text>
      <text x="458" y="560" font-size="21" font-weight="600" fill="rgba(247,247,242,0.56)">Evidence-backed debate page${date ? ` / ${escapeXml(date)}` : ''}</text>
    </svg>
  `;

  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  cacheSet(cacheKey, png);
  return png;
}
