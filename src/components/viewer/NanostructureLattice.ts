import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { opticsStore, OpticsState } from '@/lib/store/useOpticsStore';
import { getMetalensTargetPhase, getBeamDeflectorPhase, getVortexBeamPhase, getPBRotationAngle } from '@/lib/optics/phaseProfiles';
import { queryUnitCellLUT, targetPhaseToDiameter } from '@/lib/optics/rcwaLut';
import { generateTargetBitmap, runGerchbergSaxton } from '@/lib/optics/gerchbergSaxton';

export class NanostructureLatticeViewer {
  private container: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pillarMesh: THREE.InstancedMesh | null = null;
  private finMesh: THREE.InstancedMesh | null = null;
  private substrate: THREE.Mesh | null = null;
  private animId: number | null = null;
  private unsubscribe: (() => void) | null = null;
  private needsRender: boolean = true;

  private readonly GRID_SIZE = 32;
  private readonly PITCH = 0.4; // 400 nm in um
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
    this.camera = new THREE.PerspectiveCamera(40, aspect, 0.1, 100);
    this.camera.position.set(12, -14, 12);
    this.camera.up.set(0, 0, 1); // Z is vertical

    // Controls
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.maxPolarAngle = Math.PI / 2 + 0.1; // Don't flip below ground
    this.controls.minDistance = 5;
    this.controls.maxDistance = 40;
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
    const size = this.GRID_SIZE * this.PITCH;
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

    // Subtle coordinate grid on substrate surface
    const gridHelper = new THREE.GridHelper(size, this.GRID_SIZE, 0x38bdf8, 0x1e293b);
    gridHelper.rotation.x = Math.PI / 2;
    gridHelper.position.set(0, 0, 0.005);
    this.scene.add(gridHelper);
  }

  private setupLatticeMeshes(): void {
    const count = this.GRID_SIZE * this.GRID_SIZE;

    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.25,
      metalness: 0.2,
      envMapIntensity: 1.0
    });

    // 1. Circular Nanopillar Mesh (for propagation phase: metalens, deflector, hologram)
    const cylGeom = new THREE.CylinderGeometry(1, 1, 1, 16);
    cylGeom.rotateX(Math.PI / 2); // Orient along Z axis
    this.pillarMesh = new THREE.InstancedMesh(cylGeom, mat, count);
    this.pillarMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.scene.add(this.pillarMesh);

    // 2. Anisotropic Rectangular Nanofin Mesh (for Pancharatnam-Berry geometric phase)
    const finGeom = new THREE.BoxGeometry(1, 1, 1);
    this.finMesh = new THREE.InstancedMesh(finGeom, mat.clone(), count);
    this.finMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.finMesh.visible = false;
    this.scene.add(this.finMesh);

    this.updateLattice();
  }

  public updateLattice(): void {
    if (!this.pillarMesh || !this.finMesh) return;
    const state = opticsStore.getState();
    const halfWidth = (this.GRID_SIZE * this.PITCH) / 2;
    const heightUm = state.heightNm / 1000.0;
    const wavelengthUm = state.wavelength;
    const wavelengthNm = state.wavelength * 1000.0;

    const ag = state.activeGradients || {
      lens: state.deviceType === 'metalens',
      deflect: state.deviceType === 'deflector',
      vortex: state.deviceType === 'vortex',
      hologram: state.deviceType === 'hologram'
    };

    const isPBMode = ag.vortex && !ag.lens && !ag.deflect && !ag.hologram;
    this.pillarMesh.visible = !isPBMode;
    this.finMesh.visible = isPBMode;

    const targetMesh = isPBMode ? this.finMesh : this.pillarMesh;

    // Ensure hologram phase mask exists if hologram gradient is active
    let hologramMask = state.cghPhaseMask;
    if (ag.hologram && !hologramMask) {
      const targetBmp = generateTargetBitmap(state.hologramTarget || 'crest', 32);
      const res = runGerchbergSaxton(targetBmp, state.hologramIterations || 15);
      hologramMask = res.phaseMask;
      opticsStore.getState().setCghPhaseMask(hologramMask);
    }

    let index = 0;
    for (let i = 0; i < this.GRID_SIZE; i++) {
      for (let j = 0; j < this.GRID_SIZE; j++) {
        const x = -halfWidth + (i + 0.5) * this.PITCH;
        const y = -halfWidth + (j + 0.5) * this.PITCH;

        // Calculate multi-gradient superposition phase
        let phase = 0;
        if (ag.lens) {
          phase += getMetalensTargetPhase(x, y, wavelengthUm, state.focalLength);
        }
        if (ag.deflect) {
          phase += getBeamDeflectorPhase(x, wavelengthUm, state.deflectionAngle);
        }
        if (ag.vortex) {
          phase += getVortexBeamPhase(x, y, state.topologicalCharge);
        }
        if (ag.hologram && hologramMask) {
          phase += hologramMask[i][j];
        } else if (ag.hologram) {
          const normDist = Math.sqrt(x * x + y * y) / (this.GRID_SIZE * this.PITCH * 0.5);
          phase += (((Math.sin(normDist * 12.0) * 2.0 + Math.cos(x * 8.0)) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        }

        // Wrap to [0, 2*PI)
        phase = ((phase % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);

        if (isPBMode) {
          // Anisotropic Nanofin (PB Geometric Phase):
          // Fixed width ~100 nm, length ~260 nm, height h, rotated in-plane by theta = phi / 2
          const finWidthUm = 0.11;  // 110 nm
          const finLengthUm = 0.26; // 260 nm
          const helicity = state.stokes[3] >= 0 ? 1 : -1;
          const rotAngle = getPBRotationAngle(phase, helicity);

          this.dummy.position.set(x, y, heightUm / 2);
          this.dummy.scale.set(finWidthUm, finLengthUm, heightUm);
          this.dummy.rotation.set(0, 0, rotAngle);
          this.dummy.updateMatrix();

          targetMesh.setMatrixAt(index, this.dummy.matrix);

          const normPhase = phase / (2 * Math.PI);
          this.color.setHSL(normPhase, 0.88, 0.52);
          targetMesh.setColorAt(index, this.color);
        } else {
          // Circular Nanopillar (Propagation Phase):
          let diameterNm = targetPhaseToDiameter(phase, wavelengthNm, state.heightNm, state.pitchNm, state.material);

          // Add manufacturing jitter noise
          if (state.toleranceJitter > 0) {
            const pseudoRandom = Math.sin(i * 12.9898 + j * 78.233) * 43758.5453;
            const noise = (pseudoRandom - Math.floor(pseudoRandom) - 0.5) * 2.0 * (state.toleranceJitter * 200.0);
            diameterNm = Math.max(50, Math.min(state.pitchNm - 10, diameterNm + noise));
          }

          const response = queryUnitCellLUT(
            diameterNm,
            wavelengthNm,
            state.heightNm,
            state.pitchNm,
            state.material
          );

          const radiusUm = (diameterNm / 2) / 1000.0;

          this.dummy.position.set(x, y, heightUm / 2);
          this.dummy.scale.set(radiusUm, radiusUm, heightUm);
          this.dummy.rotation.set(0, 0, 0);
          this.dummy.updateMatrix();

          targetMesh.setMatrixAt(index, this.dummy.matrix);

          const normPhase = phase / (2 * Math.PI);
          if (response.fabFeasible) {
            this.color.setHSL(normPhase, 0.85, 0.52);
          } else {
            // High contrast alert amber/crimson for nanofab violations
            this.color.setRGB(1.0, 0.15, 0.2);
          }
          targetMesh.setColorAt(index, this.color);
        }

        index++;
      }
    }

    targetMesh.instanceMatrix.needsUpdate = true;
    if (targetMesh.instanceColor) {
      targetMesh.instanceColor.needsUpdate = true;
    }
    this.needsRender = true;
  }

  public resetCamera(): void {
    this.camera.position.set(12, -14, 12);
    this.controls.target.set(0, 0, 0.3);
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
