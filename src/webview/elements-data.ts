// Element data for webview context (browser bundle, no Node.js imports).
// Conventional CPK-derived element colors.
// Covalent radii: Cordero et al., Dalton Trans. (2008) 2832-2838.
// vdW radii: Bondi, J. Phys. Chem. 68 (1964) 441; Mantina et al., J. Phys. Chem. A 113 (2009) 5806.
export interface WebElementData {
  color: string;
  covalentRadius: number;
  vdwRadius: number;
  displayRadius: number; // for rendering (scaled down from vdW)
}

const E: Record<string, WebElementData> = {
  H:  { color: '#FFFFFF', covalentRadius: 0.31, vdwRadius: 1.20, displayRadius: 0.30 },
  He: { color: '#D9FFFF', covalentRadius: 0.28, vdwRadius: 1.40, displayRadius: 0.30 },
  Li: { color: '#CC80FF', covalentRadius: 1.28, vdwRadius: 1.82, displayRadius: 0.50 },
  Be: { color: '#C2FF00', covalentRadius: 0.96, vdwRadius: 1.53, displayRadius: 0.42 },
  B:  { color: '#FFB5B5', covalentRadius: 0.84, vdwRadius: 1.92, displayRadius: 0.40 },
  C:  { color: '#909090', covalentRadius: 0.76, vdwRadius: 1.70, displayRadius: 0.38 },
  N:  { color: '#3050F8', covalentRadius: 0.71, vdwRadius: 1.55, displayRadius: 0.36 },
  O:  { color: '#FF0D0D', covalentRadius: 0.66, vdwRadius: 1.52, displayRadius: 0.35 },
  F:  { color: '#90E050', covalentRadius: 0.57, vdwRadius: 1.47, displayRadius: 0.33 },
  Ne: { color: '#B3E3F5', covalentRadius: 0.58, vdwRadius: 1.54, displayRadius: 0.33 },
  Na: { color: '#AB5CF2', covalentRadius: 1.66, vdwRadius: 2.27, displayRadius: 0.55 },
  Mg: { color: '#8AFF00', covalentRadius: 1.41, vdwRadius: 1.73, displayRadius: 0.52 },
  Al: { color: '#BFA6A6', covalentRadius: 1.21, vdwRadius: 1.84, displayRadius: 0.48 },
  Si: { color: '#F0C8A0', covalentRadius: 1.11, vdwRadius: 2.10, displayRadius: 0.46 },
  P:  { color: '#FF8000', covalentRadius: 1.07, vdwRadius: 1.80, displayRadius: 0.44 },
  S:  { color: '#FFFF30', covalentRadius: 1.05, vdwRadius: 1.80, displayRadius: 0.44 },
  Cl: { color: '#1FF01F', covalentRadius: 1.02, vdwRadius: 1.75, displayRadius: 0.43 },
  Ar: { color: '#80D1E3', covalentRadius: 1.06, vdwRadius: 1.88, displayRadius: 0.44 },
  K:  { color: '#8F40D4', covalentRadius: 2.03, vdwRadius: 2.75, displayRadius: 0.60 },
  Ca: { color: '#3DFF00', covalentRadius: 1.76, vdwRadius: 2.31, displayRadius: 0.57 },
  Sc: { color: '#E6E6E6', covalentRadius: 1.70, vdwRadius: 2.15, displayRadius: 0.55 },
  Ti: { color: '#BFC2C7', covalentRadius: 1.60, vdwRadius: 2.11, displayRadius: 0.53 },
  V:  { color: '#A6A6AB', covalentRadius: 1.53, vdwRadius: 2.07, displayRadius: 0.52 },
  Cr: { color: '#8A99C7', covalentRadius: 1.39, vdwRadius: 2.06, displayRadius: 0.50 },
  Mn: { color: '#9C7AC7', covalentRadius: 1.39, vdwRadius: 2.05, displayRadius: 0.50 },
  Fe: { color: '#E06633', covalentRadius: 1.32, vdwRadius: 2.04, displayRadius: 0.48 },
  Co: { color: '#F090A0', covalentRadius: 1.26, vdwRadius: 2.00, displayRadius: 0.47 },
  Ni: { color: '#50D050', covalentRadius: 1.24, vdwRadius: 1.97, displayRadius: 0.46 },
  Cu: { color: '#C88033', covalentRadius: 1.32, vdwRadius: 1.96, displayRadius: 0.48 },
  Zn: { color: '#7D80B0', covalentRadius: 1.22, vdwRadius: 2.01, displayRadius: 0.46 },
  Ga: { color: '#C28F8F', covalentRadius: 1.22, vdwRadius: 1.87, displayRadius: 0.46 },
  Ge: { color: '#668F8F', covalentRadius: 1.20, vdwRadius: 2.11, displayRadius: 0.45 },
  As: { color: '#BD80E3', covalentRadius: 1.19, vdwRadius: 1.85, displayRadius: 0.45 },
  Se: { color: '#FFA100', covalentRadius: 1.20, vdwRadius: 1.90, displayRadius: 0.45 },
  Br: { color: '#A62929', covalentRadius: 1.20, vdwRadius: 1.85, displayRadius: 0.45 },
  Kr: { color: '#5CB8D1', covalentRadius: 1.16, vdwRadius: 2.02, displayRadius: 0.44 },
  Rb: { color: '#702EB0', covalentRadius: 2.20, vdwRadius: 3.03, displayRadius: 0.62 },
  Sr: { color: '#00FF00', covalentRadius: 1.95, vdwRadius: 2.49, displayRadius: 0.58 },
  Y:  { color: '#94FFFF', covalentRadius: 1.90, vdwRadius: 2.32, displayRadius: 0.57 },
  Zr: { color: '#94E0E0', covalentRadius: 1.75, vdwRadius: 2.23, displayRadius: 0.55 },
  Nb: { color: '#73C2C9', covalentRadius: 1.64, vdwRadius: 2.18, displayRadius: 0.53 },
  Mo: { color: '#54B5B5', covalentRadius: 1.54, vdwRadius: 2.17, displayRadius: 0.52 },
  Ru: { color: '#248F8F', covalentRadius: 1.46, vdwRadius: 2.13, displayRadius: 0.51 },
  Rh: { color: '#0A7D8C', covalentRadius: 1.42, vdwRadius: 2.10, displayRadius: 0.50 },
  Pd: { color: '#006985', covalentRadius: 1.39, vdwRadius: 2.10, displayRadius: 0.50 },
  Ag: { color: '#C0C0C0', covalentRadius: 1.45, vdwRadius: 2.11, displayRadius: 0.51 },
  Cd: { color: '#FFD98F', covalentRadius: 1.44, vdwRadius: 2.18, displayRadius: 0.51 },
  In: { color: '#A67573', covalentRadius: 1.42, vdwRadius: 1.93, displayRadius: 0.50 },
  Sn: { color: '#668080', covalentRadius: 1.39, vdwRadius: 2.17, displayRadius: 0.50 },
  Sb: { color: '#9E63B5', covalentRadius: 1.39, vdwRadius: 2.06, displayRadius: 0.50 },
  Te: { color: '#D47A00', covalentRadius: 1.38, vdwRadius: 2.06, displayRadius: 0.50 },
  I:  { color: '#940094', covalentRadius: 1.39, vdwRadius: 1.98, displayRadius: 0.50 },
  Xe: { color: '#429EB0', covalentRadius: 1.40, vdwRadius: 2.16, displayRadius: 0.50 },
  Cs: { color: '#57178F', covalentRadius: 2.44, vdwRadius: 3.43, displayRadius: 0.65 },
  Ba: { color: '#00C900', covalentRadius: 2.15, vdwRadius: 2.68, displayRadius: 0.60 },
  La: { color: '#70D4FF', covalentRadius: 2.07, vdwRadius: 2.43, displayRadius: 0.58 },
  Ce: { color: '#FFFFC7', covalentRadius: 2.04, vdwRadius: 2.42, displayRadius: 0.58 },
  Hf: { color: '#4DC2FF', covalentRadius: 1.75, vdwRadius: 2.23, displayRadius: 0.55 },
  Ta: { color: '#4DA6FF', covalentRadius: 1.70, vdwRadius: 2.22, displayRadius: 0.54 },
  W:  { color: '#2194D6', covalentRadius: 1.62, vdwRadius: 2.18, displayRadius: 0.53 },
  Re: { color: '#267DAB', covalentRadius: 1.51, vdwRadius: 2.16, displayRadius: 0.51 },
  Os: { color: '#266696', covalentRadius: 1.44, vdwRadius: 2.16, displayRadius: 0.51 },
  Ir: { color: '#175487', covalentRadius: 1.41, vdwRadius: 2.13, displayRadius: 0.50 },
  Pt: { color: '#D0D0E0', covalentRadius: 1.36, vdwRadius: 2.13, displayRadius: 0.49 },
  Au: { color: '#FFD123', covalentRadius: 1.36, vdwRadius: 2.14, displayRadius: 0.49 },
  Pb: { color: '#575961', covalentRadius: 1.46, vdwRadius: 2.02, displayRadius: 0.51 },
  Bi: { color: '#9E4FB5', covalentRadius: 1.48, vdwRadius: 2.07, displayRadius: 0.51 },
  U:  { color: '#008FFF', covalentRadius: 1.96, vdwRadius: 2.41, displayRadius: 0.58 },
};

const DEFAULT: WebElementData = { color: '#FF69B4', covalentRadius: 1.50, vdwRadius: 2.00, displayRadius: 0.50 };

export type ColorPalette = 'dark' | 'light';

/** Brighten a hex color by lifting its HSL lightness (min 0.35, boost ~20%) */
function brighten(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0, l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }

  // Boost lightness: ensure minimum 0.35, then push up by 20%
  l = Math.max(l, 0.35);
  l = Math.min(l + (1 - l) * 0.2, 0.92);

  // HSL to hex
  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1; if (t > 1) t -= 1;
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

// Build dark palette by brightening the base colors
const darkPalette: Record<string, string> = {};
for (const [sym, data] of Object.entries(E)) {
  darkPalette[sym] = brighten(data.color);
}

export function getWebElement(symbol: string): WebElementData {
  const normalized = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
  return E[normalized] || DEFAULT;
}

/** Get element color for a specific palette. Light = base, Dark = brightened */
export function getElementPaletteColor(symbol: string, palette: ColorPalette): string {
  const normalized = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
  if (palette === 'dark') {
    return darkPalette[normalized] || brighten(DEFAULT.color);
  }
  return (E[normalized] || DEFAULT).color;
}

/** Get line/wireframe colors for a specific palette */
export function getPaletteLineColors(palette: ColorPalette): { line: number; dash: number; bondUnicolor: string; isoPos: number; isoNeg: number } {
  return palette === 'dark'
    ? { line: 0xaaaaaa, dash: 0x888888, bondUnicolor: '#aaaaaa', isoPos: 0x6666ff, isoNeg: 0xff6666 }
    : { line: 0x555555, dash: 0x444444, bondUnicolor: '#666666', isoPos: 0x2222cc, isoNeg: 0xcc2222 };
}
