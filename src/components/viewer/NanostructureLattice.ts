import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { opticsStore, OpticsState } from '@/lib/store/useOpticsStore';
import { targetPhaseToDiameter } from '@/lib/optics/rcwaLut';
import { aperturePhase } from '@/lib/optics/farField';

export function latticePositions(diameter: number, pitch: number): Array<[number, number]> {
  const radius = diameter / 2;
  const limit = Math.floor(radius / pitch);
  const positions: Array<[number, number]> = [];
  for (let i = -limit; i <= limit; i++) {
    for (let j = -limit; j <= limit; j++) {
      const x = i * pitch;
      const y = j * pitch;
      if (x * x + y * y <= radius * radius) positions.push([x, y]);
    }
  }
  return positions;
}

export function latticeTargetPhase(state: OpticsState, x: number, y: number): number {
  const phase = aperturePhase({ ...state, ...state.activeGradients }, x, y);
  return ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
}

/** Geometry is designed at λ0; changing the illumination must not resize it. */
export function latticePillarGeometry(state: OpticsState, x: number, y: number) {
  const targetPhase = latticeTargetPhase(state, x, y);
  const diameterNm = targetPhaseToDiameter(targetPhase, state.designWavelength * 1000,
    state.heightNm, state.pitchNm, state.material);
  return { targetPhase, diameterNm };
}

/** Phase-map pixel in a top view: screen up is physical +y. */
export function latticePhaseMapCoordinates(row: number, col: number, size: number, diameter: number): [number, number] {
  return [((col + 0.5) / size - 0.5) * diameter, (0.5 - (row + 0.5) / size) * diameter];
}

export class NanostructureLatticeViewer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pillarMesh: THREE.InstancedMesh | null = null;
  private substrate: THREE.Mesh | null = null;
  private animId: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private needsRender: boolean = true;
  private phaseMapKey = '';
  private phaseMapMask: number[][] | null = null;

  private readonly MAX_GRID_SIZE = 127; // 50 µm aperture at 400 nm pitch
  private dummy = new THREE.Object3D();
  private color = new THREE.Color();

  constructor(container: HTMLElement, canvas: HTMLCanvasElement) {
    this.container = container;
    this.canvas = canvas;

    // Renderer
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;

    // Scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x070913);

    // Camera
    const aspect = this.container.clientWidth / Math.max(1, this.container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 300);
    this.camera.position.set(47, -55, 47);
    this.camera.up.set(0, 0, 1); // Z is vertical

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1; // Don't flip below ground
    this.controls.minDistance = 5;
    this.controls.maxDistance = 170;
    this.controls.target.set(0, 0, 0.3);
    this.controls.addEventListener('change', () => {
      this.needsRender = true;
    });

    this.setupLighting();
    this.setupSubstrate();
    this.setupLatticeMeshes();

    // Subscribe to store updates
    this.unsubscribe = opticsStore.subscribe(() => {
      this.updateLattice();
    });

    this.start();
  }

  private setupLighting(): void {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const dirLight1 = new THREE.DirectionalLight(0xffffff, 1.8);
    dirLight1.position.set(10, -10, 20);
    this.scene.add(dirLight1);

    const dirLight2 = new THREE.DirectionalLight(0x38bdf8, 0.8);
    dirLight2.position.set(-10, 10, -5);
    this.scene.add(dirLight2);
  }

  private setupSubstrate(): void {
    const size = 30;
    const substrateGeom = new THREE.BoxGeometry(size * 1.15, size * 1.15, 0.5);
    const substrateMat = new THREE.MeshPhysicalMaterial({
      color: 0x94a3b8,
      transparent: true,
      opacity: 0.35,
      roughness: 0.1,
      metalness: 0.05,
      transmission: 0.7,
      ior: 1.45 // Fused silica
    });
    this.substrate = new THREE.Mesh(substrateGeom, substrateMat);
    this.substrate.position.set(0, 0, -0.25);
    this.scene.add(this.substrate);


  }

  private setupLatticeMeshes(): void {
    const count = this.MAX_GRID_SIZE * this.MAX_GRID_SIZE;

    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.25,
      metalness: 0.2,
      envMapIntensity: 1.0
    });

    // Circular nanopillars encode the phase for every device mode.
    const cylGeom = new THREE.CylinderGeometry(1, 1, 1, 16);
    cylGeom.rotateX(Math.PI / 2); // Orient along Z axis
    this.pillarMesh = new THREE.InstancedMesh(cylGeom, mat, count);
    this.pillarMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.pillarMesh);

    this.updateLattice();
  }

  public updateLattice(): void {
    if (!this.pillarMesh) return;
    const state = opticsStore.getState();
    const ag = state.activeGradients;
    const key = [state.diameter, state.designWavelength, state.focalLength,
      state.deflectionAngle, state.topologicalCharge, state.heightNm, state.pitchNm,
      state.material,
      ag.lens, ag.deflect, ag.vortex, ag.hologram].join(':');
    if (key === this.phaseMapKey && state.cghPhaseMask === this.phaseMapMask) return;

    const markerScale = state.diameter / 30;
    this.substrate?.scale.set(markerScale, markerScale, 1);
    const heightUm = state.heightNm / 1000;
    const pitch = state.pitchNm / 1000;
    const positions = latticePositions(state.diameter, pitch);
    if (positions.length > this.pillarMesh.instanceMatrix.count) {
      const old = this.pillarMesh;
      this.pillarMesh = new THREE.InstancedMesh(old.geometry, old.material, positions.length);
      this.pillarMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.scene.remove(old);
      old.dispose();
      this.scene.add(this.pillarMesh);
    }
    const targetMesh = this.pillarMesh;
    let index = 0;
    for (const [x, y] of positions) {
      const sample = latticePillarGeometry(state, x, y);
      this.dummy.position.set(x, y, heightUm / 2);
      this.dummy.scale.set(sample.diameterNm / 2000, sample.diameterNm / 2000, heightUm);
      this.dummy.rotation.set(0, 0, 0);
      this.dummy.updateMatrix();
      targetMesh.setMatrixAt(index, this.dummy.matrix);
      // CSS map colors are sRGB; convert the same hues for Three's linear scene.
      this.color.setHSL(sample.targetPhase / (2 * Math.PI), 0.85, 0.52, THREE.SRGBColorSpace);
      targetMesh.setColorAt(index++, this.color);
    }
    targetMesh.count = index;
    targetMesh.computeBoundingSphere();
    targetMesh.instanceMatrix.needsUpdate = true;
    if (targetMesh.instanceColor) targetMesh.instanceColor.needsUpdate = true;
    this.updatePhaseMap(state);
    this.phaseMapKey = key;
    this.phaseMapMask = state.cghPhaseMask;
    this.needsRender = true;
  }

  private updatePhaseMap(state: OpticsState): void {
    const canvas = this.container.querySelector<HTMLCanvasElement>('#lattice-phase-map');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const size = canvas.width;
    ctx.clearRect(0, 0, size, size);
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        const [x, y] = latticePhaseMapCoordinates(row, col, size, state.diameter);
        if (x * x + y * y > state.diameter * state.diameter / 4) continue;
        const phase = latticeTargetPhase(state, x, y);
        ctx.fillStyle = `hsl(${phase / (2 * Math.PI) * 360}, 85%, 52%)`;
        ctx.fillRect(col, row, 1, 1);
      }
    }
  }

  public resetCamera(): void {
    this.controls.target.set(0, 0, 0.3);
    this.camera.position.set(47, -55, 47);
    this.controls.update();
    this.needsRender = true;
  }

  public resize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    if (width === 0 || height === 0) return;
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    this.needsRender = true;
  }

  public start(): void {
    if (this.animId !== null) return;
    this.needsRender = true;
    const animate = () => {
      const controlsChanged = this.controls.update();
      if (controlsChanged || this.needsRender) {
        this.renderer.render(this.scene, this.camera);
        this.needsRender = false;
      }
      this.animId = requestAnimationFrame(animate);
    };
    this.animId = requestAnimationFrame(animate);
  }

  public stop(): void {
    if (this.animId !== null) {
      cancelAnimationFrame(this.animId);
      this.animId = null;
    }
  }

  public destroy(): void {
    this.stop();
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    this.controls.dispose();
    this.renderer.dispose();
  }
}
