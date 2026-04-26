import * as THREE from 'three';

export class AxisIndicator {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera(-2, 2, 2, -2, 0.1, 10);
  private arrows = new THREE.Group();
  private materials: THREE.Material[] = [];
  private geometries: THREE.BufferGeometry[] = [];
  private textures: THREE.Texture[] = [];
  private _size = 300;

  constructor() {
    this.camera.position.set(0, 0, 5);
    this.camera.lookAt(0, 0, 0);
    const light = new THREE.AmbientLight(0xffffff, 1.0);
    this.scene.add(light);
    this.scene.add(this.arrows);
    this.build([1, 0, 0], [0, 1, 0], [0, 0, 1]);
  }

  // Position offset from the default bottom-right anchor (CSS pixels). dx
  // shifts the indicator left from the right edge; dy shifts it up from the
  // bottom edge. Persisted as offsets (not absolute coords) so canvas
  // resizing keeps the indicator near its placed corner instead of going
  // off-screen.
  private _dx = 0;
  private _dy = 0;

  get size(): number { return this._size; }
  setSize(px: number) { this._size = Math.max(60, Math.min(400, px)); }

  get offset(): { dx: number; dy: number } { return { dx: this._dx, dy: this._dy }; }
  setOffset(dx: number, dy: number) { this._dx = dx; this._dy = dy; }
  resetOffset() { this._dx = 0; this._dy = 0; }

  /** Indicator's bounding rect in CSS pixels (top-left origin), clamped to
   *  stay within the canvas. Used for both rendering (after Y flip) and
   *  pointer hit-testing on the DOM side. */
  getRect(canvasW: number, canvasH: number): { x: number; y: number; w: number; h: number } {
    const size = this._size;
    const margin = 16;
    const baseX = canvasW - margin - size;
    const baseY = canvasH - margin - size;
    const x = Math.max(0, Math.min(canvasW - size, baseX - this._dx));
    const y = Math.max(0, Math.min(canvasH - size, baseY - this._dy));
    return { x, y, w: size, h: size };
  }

  update(a: number[], b: number[], c: number[]) { this.build(a, b, c); }

  private disposeContents() {
    while (this.arrows.children.length > 0) this.arrows.remove(this.arrows.children[0]);
    for (const m of this.materials) m.dispose();
    for (const g of this.geometries) g.dispose();
    for (const t of this.textures) t.dispose();
    this.materials = [];
    this.geometries = [];
    this.textures = [];
  }

  private build(a: number[], b: number[], c: number[]) {
    this.disposeContents();

    const dirs = [
      { v: new THREE.Vector3(...a).normalize(), color: 0xff3333, label: 'a' },
      { v: new THREE.Vector3(...b).normalize(), color: 0x33cc33, label: 'b' },
      { v: new THREE.Vector3(...c).normalize(), color: 0x3377ff, label: 'c' },
    ];

    for (const { v, color, label } of dirs) {
      const shaftGeo = new THREE.CylinderGeometry(0.04, 0.04, 1.0, 8);
      shaftGeo.translate(0, 0.5, 0);
      shaftGeo.rotateX(Math.PI / 2);
      const shaftMat = new THREE.MeshBasicMaterial({ color });
      this.geometries.push(shaftGeo);
      this.materials.push(shaftMat);
      const shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.lookAt(v);
      this.arrows.add(shaft);

      const headGeo = new THREE.ConeGeometry(0.1, 0.25, 8);
      headGeo.translate(0, 0.125, 0);
      headGeo.rotateX(Math.PI / 2);
      const headMat = new THREE.MeshBasicMaterial({ color });
      this.geometries.push(headGeo);
      this.materials.push(headMat);
      const head = new THREE.Mesh(headGeo, headMat);
      head.position.copy(v.clone().multiplyScalar(1.0));
      head.lookAt(v.clone().multiplyScalar(2));
      this.arrows.add(head);

      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 64;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
      ctx.font = 'bold 48px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(label, 32, 32);
      const tex = new THREE.CanvasTexture(canvas);
      const spriteMat = new THREE.SpriteMaterial({ map: tex, depthTest: false });
      this.textures.push(tex);
      this.materials.push(spriteMat);
      const sprite = new THREE.Sprite(spriteMat);
      sprite.position.copy(v.clone().multiplyScalar(1.4));
      sprite.scale.set(0.4, 0.4, 1);
      this.arrows.add(sprite);
    }

    const originGeo = new THREE.SphereGeometry(0.06, 8, 6);
    const originMat = new THREE.MeshBasicMaterial({ color: 0xaaaaaa });
    this.geometries.push(originGeo);
    this.materials.push(originMat);
    this.arrows.add(new THREE.Mesh(originGeo, originMat));
  }

  syncToMainCamera(mainCam: THREE.Camera, target: THREE.Vector3) {
    const camDir = mainCam.position.clone().sub(target).normalize();
    this.camera.position.copy(camDir.multiplyScalar(5));
    this.camera.up.copy(mainCam.up);
    this.camera.lookAt(0, 0, 0);
  }

  render(renderer: THREE.WebGLRenderer) {
    const canvasW = renderer.domElement.clientWidth;
    const canvasH = renderer.domElement.clientHeight;
    const rect = this.getRect(canvasW, canvasH);
    // setViewport/setScissor use bottom-up Y in CSS pixels; getRect returns
    // a top-down DOM rect. Convert by reflecting around canvas height.
    const vy = canvasH - rect.y - rect.h;
    renderer.setViewport(rect.x, vy, rect.w, rect.h);
    renderer.setScissorTest(true);
    renderer.setScissor(rect.x, vy, rect.w, rect.h);
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
    renderer.setScissorTest(false);
  }

  dispose() { this.disposeContents(); }
}
