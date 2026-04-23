import * as vscode from 'vscode';
import { CrystalEditorProvider } from './editor/crystalEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new CrystalEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      'matviz.crystalViewer',
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.openInViewer', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showWarningMessage('MatViz: no active file to open.');
        return;
      }
      await vscode.commands.executeCommand('vscode.openWith', target, 'matviz.crystalViewer');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.resetCamera', () => {
      provider.postMessageToActive({ type: 'resetCamera' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.toggleBonds', () => {
      provider.postMessageToActive({ type: 'toggleBonds' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.viewAlongDirection', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter crystallographic direction [u v w]',
        placeHolder: '1 0 0',
      });
      if (!input) return;
      const parts = input.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 3 && parts.every(n => !isNaN(n))) {
        provider.postMessageToActive({
          type: 'viewAlongDirection',
          uvw: parts as [number, number, number],
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.viewNormalToPlane', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter Miller indices (h k l)',
        placeHolder: '1 1 1',
      });
      if (!input) return;
      const parts = input.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 3 && parts.every(n => !isNaN(n))) {
        provider.postMessageToActive({
          type: 'viewNormalToPlane',
          hkl: parts as [number, number, number],
        });
      }
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.addLatticePlane', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter Miller indices (h k l)',
        placeHolder: '1 1 1',
      });
      if (!input) return;
      const parts = input.trim().split(/[\s,]+/).map(Number);
      if (parts.length === 3 && parts.every(n => !isNaN(n))) {
        provider.postMessageToActive({
          type: 'addLatticePlane',
          hkl: parts as [number, number, number],
        });
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.clearLatticePlanes', () => {
      provider.postMessageToActive({ type: 'clearLatticePlanes' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.exportCif', () => {
      provider.exportStructure('cif');
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.exportPoscar', () => {
      provider.exportStructure('poscar');
    })
  );

  // 16.4 Wulff construction
  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.showWulff', async () => {
      const input = await vscode.window.showInputBox({
        prompt: 'Enter Miller-index + surface-energy tuples (h,k,l,γ; …) separated by ";"',
        placeHolder: '1,0,0,1.0; -1,0,0,1.0; 0,1,0,1.0; 0,-1,0,1.0; 0,0,1,1.0; 0,0,-1,1.0',
        value: '1,0,0,1.0; -1,0,0,1.0; 0,1,0,1.0; 0,-1,0,1.0; 0,0,1,1.0; 0,0,-1,1.0',
      });
      if (!input) return;
      const planes: Array<{ h: number; k: number; l: number; gamma: number }> = [];
      for (const segment of input.split(';')) {
        const tokens = segment.trim().split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
        if (tokens.length === 4) {
          planes.push({ h: tokens[0], k: tokens[1], l: tokens[2], gamma: tokens[3] });
        }
      }
      if (planes.length === 0) {
        vscode.window.showErrorMessage('No valid (h,k,l,γ) tuples parsed.');
        return;
      }
      provider.postMessageToActive({ type: 'setWulff', planes });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.clearWulff', () => {
      provider.postMessageToActive({ type: 'clearWulff' });
    })
  );

  // 17.2 multi-phase overlay
  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.addPhase', async () => {
      const picks = await vscode.window.showOpenDialog({
        canSelectMany: false,
        openLabel: 'Add as overlay phase',
        filters: {
          'Crystal structures': ['cif', 'xsf', 'axsf', 'poscar', 'vasp', 'xyz', 'pdb'],
        },
      });
      if (!picks || picks.length === 0) return;
      const uri = picks[0];
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const content = new TextDecoder('utf-8').decode(data);
        const filename = uri.path.split('/').pop() || 'phase';
        // Lazy import to avoid circular module load order with parsers
        const { parseStructureFile } = await import('./parsers/index.js');
        const parsed = parseStructureFile(content, filename);
        // Default offset 0 (overlap), opacity 0.5. User can re-invoke
        // with different offsets via subsequent add — first cut keeps
        // input simple; offset/opacity slider is a v0.17.x side-panel UI.
        provider.postMessageToActive({
          type: 'addPhase',
          data: parsed.structure,
          offset: [0, 0, 0],
          opacity: 0.5,
        });
      } catch (err: any) {
        vscode.window.showErrorMessage(`Could not load phase: ${err?.message ?? String(err)}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.clearPhases', () => {
      provider.postMessageToActive({ type: 'clearPhases' });
    })
  );

  // v0.17.1 (17.3) comparison mode
  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.compareToPhase', () => {
      provider.postMessageToActive({ type: 'compareToPhase' });
    })
  );
  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.clearComparison', () => {
      provider.postMessageToActive({ type: 'clearComparison' });
    })
  );
}

export function deactivate() {}
