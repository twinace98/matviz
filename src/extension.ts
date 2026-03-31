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
    vscode.commands.registerCommand('matviz.resetCamera', () => {
      provider.postMessageToActive({ type: 'resetCamera' });
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('matviz.toggleBonds', () => {
      provider.postMessageToActive({ type: 'toggleBonds' });
    })
  );
}

export function deactivate() {}
