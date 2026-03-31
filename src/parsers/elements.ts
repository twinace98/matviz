import { ElementData } from './types';

// CPK/Jmol colors, covalent radii from Cordero et al., vdW from Bondi/Mantina
const ELEMENTS: Record<string, ElementData> = {
  H:  { symbol: 'H',  number: 1,  color: '#FFFFFF', covalentRadius: 0.31, vdwRadius: 1.20 },
  He: { symbol: 'He', number: 2,  color: '#D9FFFF', covalentRadius: 0.28, vdwRadius: 1.40 },
  Li: { symbol: 'Li', number: 3,  color: '#CC80FF', covalentRadius: 1.28, vdwRadius: 1.82 },
  Be: { symbol: 'Be', number: 4,  color: '#C2FF00', covalentRadius: 0.96, vdwRadius: 1.53 },
  B:  { symbol: 'B',  number: 5,  color: '#FFB5B5', covalentRadius: 0.84, vdwRadius: 1.92 },
  C:  { symbol: 'C',  number: 6,  color: '#909090', covalentRadius: 0.76, vdwRadius: 1.70 },
  N:  { symbol: 'N',  number: 7,  color: '#3050F8', covalentRadius: 0.71, vdwRadius: 1.55 },
  O:  { symbol: 'O',  number: 8,  color: '#FF0D0D', covalentRadius: 0.66, vdwRadius: 1.52 },
  F:  { symbol: 'F',  number: 9,  color: '#90E050', covalentRadius: 0.57, vdwRadius: 1.47 },
  Ne: { symbol: 'Ne', number: 10, color: '#B3E3F5', covalentRadius: 0.58, vdwRadius: 1.54 },
  Na: { symbol: 'Na', number: 11, color: '#AB5CF2', covalentRadius: 1.66, vdwRadius: 2.27 },
  Mg: { symbol: 'Mg', number: 12, color: '#8AFF00', covalentRadius: 1.41, vdwRadius: 1.73 },
  Al: { symbol: 'Al', number: 13, color: '#BFA6A6', covalentRadius: 1.21, vdwRadius: 1.84 },
  Si: { symbol: 'Si', number: 14, color: '#F0C8A0', covalentRadius: 1.11, vdwRadius: 2.10 },
  P:  { symbol: 'P',  number: 15, color: '#FF8000', covalentRadius: 1.07, vdwRadius: 1.80 },
  S:  { symbol: 'S',  number: 16, color: '#FFFF30', covalentRadius: 1.05, vdwRadius: 1.80 },
  Cl: { symbol: 'Cl', number: 17, color: '#1FF01F', covalentRadius: 1.02, vdwRadius: 1.75 },
  Ar: { symbol: 'Ar', number: 18, color: '#80D1E3', covalentRadius: 1.06, vdwRadius: 1.88 },
  K:  { symbol: 'K',  number: 19, color: '#8F40D4', covalentRadius: 2.03, vdwRadius: 2.75 },
  Ca: { symbol: 'Ca', number: 20, color: '#3DFF00', covalentRadius: 1.76, vdwRadius: 2.31 },
  Sc: { symbol: 'Sc', number: 21, color: '#E6E6E6', covalentRadius: 1.70, vdwRadius: 2.15 },
  Ti: { symbol: 'Ti', number: 22, color: '#BFC2C7', covalentRadius: 1.60, vdwRadius: 2.11 },
  V:  { symbol: 'V',  number: 23, color: '#A6A6AB', covalentRadius: 1.53, vdwRadius: 2.07 },
  Cr: { symbol: 'Cr', number: 24, color: '#8A99C7', covalentRadius: 1.39, vdwRadius: 2.06 },
  Mn: { symbol: 'Mn', number: 25, color: '#9C7AC7', covalentRadius: 1.39, vdwRadius: 2.05 },
  Fe: { symbol: 'Fe', number: 26, color: '#E06633', covalentRadius: 1.32, vdwRadius: 2.04 },
  Co: { symbol: 'Co', number: 27, color: '#F090A0', covalentRadius: 1.26, vdwRadius: 2.00 },
  Ni: { symbol: 'Ni', number: 28, color: '#50D050', covalentRadius: 1.24, vdwRadius: 1.97 },
  Cu: { symbol: 'Cu', number: 29, color: '#C88033', covalentRadius: 1.32, vdwRadius: 1.96 },
  Zn: { symbol: 'Zn', number: 30, color: '#7D80B0', covalentRadius: 1.22, vdwRadius: 2.01 },
  Ga: { symbol: 'Ga', number: 31, color: '#C28F8F', covalentRadius: 1.22, vdwRadius: 1.87 },
  Ge: { symbol: 'Ge', number: 32, color: '#668F8F', covalentRadius: 1.20, vdwRadius: 2.11 },
  As: { symbol: 'As', number: 33, color: '#BD80E3', covalentRadius: 1.19, vdwRadius: 1.85 },
  Se: { symbol: 'Se', number: 34, color: '#FFA100', covalentRadius: 1.20, vdwRadius: 1.90 },
  Br: { symbol: 'Br', number: 35, color: '#A62929', covalentRadius: 1.20, vdwRadius: 1.85 },
  Kr: { symbol: 'Kr', number: 36, color: '#5CB8D1', covalentRadius: 1.16, vdwRadius: 2.02 },
  Rb: { symbol: 'Rb', number: 37, color: '#702EB0', covalentRadius: 2.20, vdwRadius: 3.03 },
  Sr: { symbol: 'Sr', number: 38, color: '#00FF00', covalentRadius: 1.95, vdwRadius: 2.49 },
  Y:  { symbol: 'Y',  number: 39, color: '#94FFFF', covalentRadius: 1.90, vdwRadius: 2.32 },
  Zr: { symbol: 'Zr', number: 40, color: '#94E0E0', covalentRadius: 1.75, vdwRadius: 2.23 },
  Nb: { symbol: 'Nb', number: 41, color: '#73C2C9', covalentRadius: 1.64, vdwRadius: 2.18 },
  Mo: { symbol: 'Mo', number: 42, color: '#54B5B5', covalentRadius: 1.54, vdwRadius: 2.17 },
  Ru: { symbol: 'Ru', number: 44, color: '#248F8F', covalentRadius: 1.46, vdwRadius: 2.13 },
  Rh: { symbol: 'Rh', number: 45, color: '#0A7D8C', covalentRadius: 1.42, vdwRadius: 2.10 },
  Pd: { symbol: 'Pd', number: 46, color: '#006985', covalentRadius: 1.39, vdwRadius: 2.10 },
  Ag: { symbol: 'Ag', number: 47, color: '#C0C0C0', covalentRadius: 1.45, vdwRadius: 2.11 },
  Cd: { symbol: 'Cd', number: 48, color: '#FFD98F', covalentRadius: 1.44, vdwRadius: 2.18 },
  In: { symbol: 'In', number: 49, color: '#A67573', covalentRadius: 1.42, vdwRadius: 1.93 },
  Sn: { symbol: 'Sn', number: 50, color: '#668080', covalentRadius: 1.39, vdwRadius: 2.17 },
  Sb: { symbol: 'Sb', number: 51, color: '#9E63B5', covalentRadius: 1.39, vdwRadius: 2.06 },
  Te: { symbol: 'Te', number: 52, color: '#D47A00', covalentRadius: 1.38, vdwRadius: 2.06 },
  I:  { symbol: 'I',  number: 53, color: '#940094', covalentRadius: 1.39, vdwRadius: 1.98 },
  Xe: { symbol: 'Xe', number: 54, color: '#429EB0', covalentRadius: 1.40, vdwRadius: 2.16 },
  Cs: { symbol: 'Cs', number: 55, color: '#57178F', covalentRadius: 2.44, vdwRadius: 3.43 },
  Ba: { symbol: 'Ba', number: 56, color: '#00C900', covalentRadius: 2.15, vdwRadius: 2.68 },
  La: { symbol: 'La', number: 57, color: '#70D4FF', covalentRadius: 2.07, vdwRadius: 2.43 },
  Ce: { symbol: 'Ce', number: 58, color: '#FFFFC7', covalentRadius: 2.04, vdwRadius: 2.42 },
  Pr: { symbol: 'Pr', number: 59, color: '#D9FFC7', covalentRadius: 2.03, vdwRadius: 2.40 },
  Nd: { symbol: 'Nd', number: 60, color: '#C7FFC7', covalentRadius: 2.01, vdwRadius: 2.39 },
  Sm: { symbol: 'Sm', number: 62, color: '#8FFFC7', covalentRadius: 1.98, vdwRadius: 2.36 },
  Eu: { symbol: 'Eu', number: 63, color: '#61FFC7', covalentRadius: 1.98, vdwRadius: 2.35 },
  Gd: { symbol: 'Gd', number: 64, color: '#45FFC7', covalentRadius: 1.96, vdwRadius: 2.34 },
  Tb: { symbol: 'Tb', number: 65, color: '#30FFC7', covalentRadius: 1.94, vdwRadius: 2.33 },
  Dy: { symbol: 'Dy', number: 66, color: '#1FFFC7', covalentRadius: 1.92, vdwRadius: 2.31 },
  Ho: { symbol: 'Ho', number: 67, color: '#00FF9C', covalentRadius: 1.92, vdwRadius: 2.30 },
  Er: { symbol: 'Er', number: 68, color: '#00E675', covalentRadius: 1.89, vdwRadius: 2.29 },
  Tm: { symbol: 'Tm', number: 69, color: '#00D452', covalentRadius: 1.90, vdwRadius: 2.27 },
  Yb: { symbol: 'Yb', number: 70, color: '#00BF38', covalentRadius: 1.87, vdwRadius: 2.26 },
  Lu: { symbol: 'Lu', number: 71, color: '#00AB24', covalentRadius: 1.87, vdwRadius: 2.24 },
  Hf: { symbol: 'Hf', number: 72, color: '#4DC2FF', covalentRadius: 1.75, vdwRadius: 2.23 },
  Ta: { symbol: 'Ta', number: 73, color: '#4DA6FF', covalentRadius: 1.70, vdwRadius: 2.22 },
  W:  { symbol: 'W',  number: 74, color: '#2194D6', covalentRadius: 1.62, vdwRadius: 2.18 },
  Re: { symbol: 'Re', number: 75, color: '#267DAB', covalentRadius: 1.51, vdwRadius: 2.16 },
  Os: { symbol: 'Os', number: 76, color: '#266696', covalentRadius: 1.44, vdwRadius: 2.16 },
  Ir: { symbol: 'Ir', number: 77, color: '#175487', covalentRadius: 1.41, vdwRadius: 2.13 },
  Pt: { symbol: 'Pt', number: 78, color: '#D0D0E0', covalentRadius: 1.36, vdwRadius: 2.13 },
  Au: { symbol: 'Au', number: 79, color: '#FFD123', covalentRadius: 1.36, vdwRadius: 2.14 },
  Pb: { symbol: 'Pb', number: 82, color: '#575961', covalentRadius: 1.46, vdwRadius: 2.02 },
  Bi: { symbol: 'Bi', number: 83, color: '#9E4FB5', covalentRadius: 1.48, vdwRadius: 2.07 },
  U:  { symbol: 'U',  number: 92, color: '#008FFF', covalentRadius: 1.96, vdwRadius: 2.41 },
};

// Lookup by atomic number
const BY_NUMBER: Record<number, ElementData> = {};
for (const el of Object.values(ELEMENTS)) {
  BY_NUMBER[el.number] = el;
}

const DEFAULT_ELEMENT: ElementData = {
  symbol: 'X', number: 0, color: '#FF69B4', covalentRadius: 1.50, vdwRadius: 2.00
};

export function getElement(symbol: string): ElementData {
  // Normalize: capitalize first letter, lowercase rest
  const normalized = symbol.charAt(0).toUpperCase() + symbol.slice(1).toLowerCase();
  return ELEMENTS[normalized] || DEFAULT_ELEMENT;
}

export function getElementByNumber(atomicNumber: number): ElementData {
  return BY_NUMBER[atomicNumber] || DEFAULT_ELEMENT;
}

export { ELEMENTS };
