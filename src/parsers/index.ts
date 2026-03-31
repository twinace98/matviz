import { CrystalStructure } from './types';
import { parseCif } from './cifParser';
import { parsePoscar } from './poscarParser';
import { parseXsf } from './xsfParser';

export function parseStructureFile(content: string, filename: string): CrystalStructure {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.cif')) {
    return parseCif(content);
  }
  if (lower.endsWith('.xsf')) {
    return parseXsf(content);
  }
  if (
    lower.endsWith('.poscar') ||
    lower.endsWith('.vasp') ||
    lower === 'poscar' ||
    lower === 'contcar'
  ) {
    return parsePoscar(content);
  }

  // Try to auto-detect
  if (content.includes('_cell_length_a') || content.includes('_atom_site')) {
    return parseCif(content);
  }
  if (content.includes('PRIMVEC') || content.includes('PRIMCOORD') || content.includes('CRYSTAL')) {
    return parseXsf(content);
  }

  // Default: try POSCAR
  return parsePoscar(content);
}

export { CrystalStructure } from './types';
