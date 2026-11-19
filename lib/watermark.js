// Draws the evidence band below the captured image using OffscreenCanvas (works in the service worker).

const FONT_FAMILY = 'ui-monospace, Consolas, Menlo, "DejaVu Sans Mono", monospace';
const COLORS = { band: '#111418', accent: '#d32f2f', title: '#ffffff', text: '#d7dce2' };

/**
 * Band height for a capture of the given width. Mirrored in verifier/proof-shot-verify.py
 * (band_height): keep both in sync, the E2E test runs the verifier on real captures.
 */
export function bandLayout(width, lineCount) {
  const fontSize = Math.max(12, Math.min(28, Math.round(width / 100)));
  const lineHeight = Math.round(fontSize * 1.45);
  const padding = Math.round(fontSize * 0.9);
  const accentHeight = Math.max(2, Math.round(fontSize / 5));
  const bandHeight = accentHeight + padding * 2 + lineHeight * lineCount;
  return { fontSize, lineHeight, padding, accentHeight, bandHeight };
}

/**
 * @returns {Promise<{png: Uint8Array, width: number, height: number, pixels: Uint8ClampedArray}>}
 *   `pixels` is the RGBA buffer of the captured area (rows 0..height-1) exactly as encoded in `png`.
 */
export async function renderWatermark(pngBytes, lines) {
  const bitmap = await createImageBitmap(new Blob([pngBytes], { type: 'image/png' }));
  const { width, height } = bitmap;

  const { fontSize, lineHeight, padding, accentHeight, bandHeight } = bandLayout(width, lines.length);

  const canvas = new OffscreenCanvas(width, height + bandHeight);
  const ctx = canvas.getContext('2d');

  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  ctx.fillStyle = COLORS.band;
  ctx.fillRect(0, height, width, bandHeight);
  ctx.fillStyle = COLORS.accent;
  ctx.fillRect(0, height, width, accentHeight);

  ctx.textBaseline = 'top';
  const maxTextWidth = width - padding * 2;
  const top = height + accentHeight + padding + Math.round((lineHeight - fontSize) / 2);

  lines.forEach((line, i) => {
    const isTitle = i === 0;
    ctx.font = `${isTitle ? 'bold ' : ''}${fontSize}px ${FONT_FAMILY}`;
    ctx.fillStyle = isTitle ? COLORS.title : COLORS.text;
    ctx.fillText(fitText(ctx, line, maxTextWidth), padding, top + i * lineHeight);
  });

  const pixels = ctx.getImageData(0, 0, width, height).data;
  const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return { png, width, height, pixels };
}

function fitText(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}
