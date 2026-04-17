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
}

export function deactivate() {}
