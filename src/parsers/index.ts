import { CrystalStructure, VolumetricData } from './types';
import { parseCif } from './cifParser';
import { parsePoscar } from './poscarParser';
import { parseXsf } from './xsfParser';
import { parseChgcar } from './chgcarParser';
import { parseCube } from './cubeParser';
import { parseXyz } from './xyzParser';
import { parsePdb } from './pdbParser';
import { parseQE } from './qeParser';
import { parseAims } from './aimsParser';

export interface ParseResult {
  structure: CrystalStructure;
  volumetric?: VolumetricData;
}

export function parseStructureFile(content: string, filename: string): ParseResult {
  const lower = filename.toLowerCase();

  if (lower.endsWith('.cif')) {
    return { structure: parseCif(content) };
  }
  if (lower.endsWith('.xsf') || lower.endsWith('.axsf')) {
    const result = parseXsf(content);
    const { volumetric, ...structure } = result;
    return { structure, volumetric };
  }
  if (lower.endsWith('.cube') || lower.endsWith('.cub')) {
    const result = parseCube(content);
    return result;
  }
  if (lower.endsWith('.xyz')) {
    return { structure: parseXyz(content) };
  }
  if (lower.endsWith('.pdb') || lower.endsWith('.ent')) {
    return { structure: parsePdb(content) };
  }
  if (
    lower.endsWith('.out') ||
    lower.endsWith('.pw') ||
    lower.endsWith('.stdout') ||
    lower.endsWith('.stdin')
  ) {
    return { structure: parseQE(content) };
  }
  if (lower === 'geometry.in' || lower.endsWith('.in')) {
    // FHI-aims signature
    if (content.includes('atom ') || content.includes('lattice_vector')) {
      return { structure: parseAims(content) };
    }
    // Otherwise treat as Quantum ESPRESSO input
    return { structure: parseQE(content) };
  }
  if (
    lower.endsWith('.poscar') ||
    lower.endsWith('.vasp') ||
    lower === 'poscar' ||
    lower === 'contcar'
  ) {
    return { structure: parsePoscar(content) };
  }
  if (lower === 'chgcar' || lower === 'aeccar0' || lower === 'aeccar2' || lower === 'parchg') {
    const result = parseChgcar(content);
    return result;
  }

  // Auto-detection
  if (content.includes('_cell_length_a') || content.includes('_atom_site')) {
    return { structure: parseCif(content) };
  }
  if (content.includes('PRIMVEC') || content.includes('PRIMCOORD') || content.includes('CRYSTAL')) {
    const result = parseXsf(content);
    const { volumetric, ...structure } = result;
    return { structure, volumetric };
  }

  // Default: try POSCAR
  return { structure: parsePoscar(content) };
}

export { CrystalStructure, VolumetricData } from './types';
