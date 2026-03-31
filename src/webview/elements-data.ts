// Duplicated element data for webview context (browser bundle, no Node.js imports)
export interface WebElementData {
  color: string;
  covalentRadius: number;
  displayRadius: number; // for rendering (scaled down from vdW)
}

const E: Record<string, WebElementData> = {
  H:  { color: '#FFFFFF', covalentRadius: 0.31, displayRadius: 0.30 },
  He: { color: '#D9FFFF', covalentRadius: 0.28, displayRadius: 0.30 },
  Li: { color: '#CC80FF', covalentRadius: 1.28, displayRadius: 0.50 },
  Be: { color: '#C2FF00', covalentRadius: 0.96, displayRadius: 0.42 },
  B:  { color: '#FFB5B5', covalentRadius: 0.84, displayRadius: 0.40 },
  C:  { color: '#909090', covalentRadius: 0.76, displayRadius: 0.38 },
  N:  { color: '#3050F8', covalentRadius: 0.71, displayRadius: 0.36 },
  O:  { color: '#FF0D0D', covalentRadius: 0.66, displayRadius: 0.35 },
  F:  { color: '#90E050', covalentRadius: 0.57, displayRadius: 0.33 },
  Ne: { color: '#B3E3F5', covalentRadius: 0.58, displayRadius: 0.33 },
  Na: { color: '#AB5CF2', covalentRadius: 1.66, displayRadius: 0.55 },
  Mg: { color: '#8AFF00', covalentRadius: 1.41, displayRadius: 0.52 },
  Al: { color: '#BFA6A6', covalentRadius: 1.21, displayRadius: 0.48 },
  Si: { color: '#F0C8A0', covalentRadius: 1.11, displayRadius: 0.46 },
  P:  { color: '#FF8000', covalentRadius: 1.07, displayRadius: 0.44 },
  S:  { color: '#FFFF30', covalentRadius: 1.05, displayRadius: 0.44 },
  Cl: { color: '#1FF01F', covalentRadius: 1.02, displayRadius: 0.43 },
  Ar: { color: '#80D1E3', covalentRadius: 1.06, displayRadius: 0.44 },
  K:  { color: '#8F40D4', covalentRadius: 2.03, displayRadius: 0.60 },
  Ca: { color: '#3DFF00', covalentRadius: 1.76, displayRadius: 0.57 },
  Sc: { color: '#E6E6E6', covalentRadius: 1.70, displayRadius: 0.55 },
  Ti: { color: '#BFC2C7', covalentRadius: 1.60, displayRadius: 0.53 },
  V:  { color: '#A6A6AB', covalentRadius: 1.53, displayRadius: 0.52 },
  Cr: { color: '#8A99C7', covalentRadius: 1.39, displayRadius: 0.50 },
  Mn: { color: '#9C7AC7', covalentRadius: 1.39, displayRadius: 0.50 },
  Fe: { color: '#E06633', covalentRadius: 1.32, displayRadius: 0.48 },
  Co: { color: '#F090A0', covalentRadius: 1.26, displayRadius: 0.47 },
  Ni: { color: '#50D050', covalentRadius: 1.24, displayRadius: 0.46 },
  Cu: { color: '#C88033', covalentRadius: 1.32, displayRadius: 0.48 },
  Zn: { color: '#7D80B0', covalentRadius: 1.22, displayRadius: 0.46 },
  Ga: { color: '#C28F8F', covalentRadius: 1.22, displayRadius: 0.46 },
  Ge: { color: '#668F8F', covalentRadius: 1.20, displayRadius: 0.45 },
  As: { color: '#BD80E3', covalentRadius: 1.19, displayRadius: 0.45 },
  Se: { color: '#FFA100', covalentRadius: 1.20, displayRadius: 0.45 },
  Br: { color: '#A62929', covalentRadius: 1.20, displayRadius: 0.45 },
  Kr: { color: '#5CB8D1', covalentRadius: 1.16, displayRadius: 0.44 },
  Rb: { color: '#702EB0', covalentRadius: 2.20, displayRadius: 0.62 },
  Sr: { color: '#00FF00', covalentRadius: 1.95, displayRadius: 0.58 },
  Y:  { color: '#94FFFF', covalentRadius: 1.90, displayRadius: 0.57 },
  Zr: { color: '#94E0E0', covalentRadius: 1.75, displayRadius: 0.55 },
  Nb: { color: '#73C2C9', covalentRadius: 1.64, displayRadius: 0.53 },
  Mo: { color: '#54B5B5', covalentRadius: 1.54, displayRadius: 0.52 },
  Ru: { color: '#248F8F', covalentRadius: 1.46, displayRadius: 0.51 },
  Rh: { color: '#0A7D8C', covalentRadius: 1.42, displayRadius: 0.50 },
  Pd: { color: '#006985', covalentRadius: 1.39, displayRadius: 0.50 },
  Ag: { color: '#C0C0C0', covalentRadius: 1.45, displayRadius: 0.51 },
  Cd: { color: '#FFD98F', covalentRadius: 1.44, displayRadius: 0.51 },
  In: { color: '#A67573', covalentRadius: 1.42, displayRadius: 0.50 },
  Sn: { color: '#668080', covalentRadius: 1.39, displayRadius: 0.50 },
  Sb: { color: '#9E63B5', covalentRadius: 1.39, displayRadius: 0.50 },
  Te: { color: '#D47A00', covalentRadius: 1.38, displayRadius: 0.50 },
  I:  { color: '#940094', covalentRadius: 1.39, displayRadius: 0.50 },
  Xe: { color: '#429EB0', covalentRadius: 1.40, displayRadius: 0.50 },
  Cs: { color: '#57178F', covalentRadius: 2.44, displayRadius: 0.65 },
  Ba: { color: '#00C900', covalentRadius: 2.15, displayRadius: 0.60 },
  La: { color: '#70D4FF', covalentRadius: 2.07, displayRadius: 0.58 },
  Ce: { color: '#FFFFC7', covalentRadius: 2.04, displayRadius: 0.58 },
  Hf: { color: '#4DC2FF', covalentRadius: 1.75, displayRadius: 0.55 },
  Ta: { color: '#4DA6FF', covalentRadius: 1.70, displayRadius: 0.54 },
  W:  { color: '#2194D6', covalentRadius: 1.62, displayRadius: 0.53 },
  Re: { color: '#267DAB', covalentRadius: 1.51, displayRadius: 0.51 },
  Os: { color: '#266696', covalentRadius: 1.44, displayRadius: 0.51 },
  Ir: { color: '#175487', covalentRadius: 1.41, displayRadius: 0.50 },
  Pt: { color: '#D0D0E0', covalentRadius: 1.36, displayRadius: 0.49 },
  Au: { color: '#FFD123', covalentRadius: 1.36, displayRadius: 0.49 },
  Pb: { color: '#575961', covalentRadius: 1.46, displayRadius: 0.51 },
  Bi: { color: '#9E4FB5', covalentRadius: 1.48, displayRadius: 0.51 },
  U:  { color: '#008FFF', covalentRadius: 1.96, displayRadius: 0.58 },
};

const DEFAULT: WebElementData = { color: '#FF69B4', covalentRadius: 1.50, displayRadius: 0.50 };

export function getWebElement(symbol: string): WebElementData {
  const normalized = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
  return E[normalized] || DEFAULT;
}
