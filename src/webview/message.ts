import { CrystalStructure } from '../parsers/types';

export type ExtensionMessage =
  | { type: 'loadStructure'; data: CrystalStructure }
  | { type: 'resetCamera' }
  | { type: 'toggleBonds' };

export type WebviewMessage =
  | { type: 'ready' };
