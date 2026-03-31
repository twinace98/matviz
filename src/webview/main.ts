import { CrystalRenderer } from './renderer';
import { ExtensionMessage } from './message';

declare function acquireVsCodeApi(): {
  postMessage(msg: unknown): void;
  getState(): unknown;
  setState(state: unknown): void;
};

const vscode = acquireVsCodeApi();

const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const info = document.getElementById('info') as HTMLDivElement;

// Size canvas to fill viewport
function sizeCanvas() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
sizeCanvas();
window.addEventListener('resize', sizeCanvas);

const renderer = new CrystalRenderer(canvas);

// Supercell controls
const scA = document.getElementById('sc-a') as HTMLInputElement;
const scB = document.getElementById('sc-b') as HTMLInputElement;
const scC = document.getElementById('sc-c') as HTMLInputElement;

function updateSupercell() {
  renderer.setSupercell([
    parseInt(scA.value) || 1,
    parseInt(scB.value) || 1,
    parseInt(scC.value) || 1,
  ]);
}

scA.addEventListener('change', updateSupercell);
scB.addEventListener('change', updateSupercell);
scC.addEventListener('change', updateSupercell);

// Message handling
window.addEventListener('message', (event) => {
  const msg = event.data as ExtensionMessage;

  switch (msg.type) {
    case 'loadStructure':
      renderer.loadStructure(msg.data);
      info.textContent = `${msg.data.species.length} atoms | ${msg.data.title || ''}`;
      break;
    case 'resetCamera':
      renderer.resetCamera();
      break;
    case 'toggleBonds':
      renderer.toggleBonds();
      break;
  }
});

// Signal ready
vscode.postMessage({ type: 'ready' });
