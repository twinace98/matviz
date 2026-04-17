import { ELEMENTS, DEFAULT_ELEMENT, getElement } from './elements-data';

export type ColorPalette = 'dark' | 'light';

/** Brighten a hex color by lifting its HSL lightness for dark-background palettes. */
export function brighten(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  let l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  l = Math.max(l, 0.35);
  l = Math.min(l + (1 - l) * 0.2, 0.92);

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1/6) return p + (q - p) * 6 * t;
    if (t < 1/2) return q;
    if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
    return p;
  };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const ro = Math.round(hue2rgb(p, q, h + 1/3) * 255);
  const go = Math.round(hue2rgb(p, q, h) * 255);
  const bo = Math.round(hue2rgb(p, q, h - 1/3) * 255);
  return '#' + ((1 << 24) + (ro << 16) + (go << 8) + bo).toString(16).slice(1).toUpperCase();
}

const darkPalette: Record<string, string> = {};
for (const [sym, data] of Object.entries(ELEMENTS)) {
  darkPalette[sym] = brighten(data.color);
}
const DEFAULT_DARK = brighten(DEFAULT_ELEMENT.color);

export function getElementPaletteColor(symbol: string, palette: ColorPalette): string {
  const normalized = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
  if (palette === 'dark') {
    return darkPalette[normalized] || DEFAULT_DARK;
  }
  return getElement(normalized).color;
}

export interface PaletteLineColors {
  line: number;
  dash: number;
  bondUnicolor: string;
  isoPos: number;
  isoNeg: number;
}

export function getPaletteLineColors(palette: ColorPalette): PaletteLineColors {
  return palette === 'dark'
    ? { line: 0xaaaaaa, dash: 0x888888, bondUnicolor: '#aaaaaa', isoPos: 0x6666ff, isoNeg: 0xff6666 }
    : { line: 0x555555, dash: 0x444444, bondUnicolor: '#666666', isoPos: 0x2222cc, isoNeg: 0xcc2222 };
}
