import { describe, it, expect, beforeEach } from 'vitest';
import { opticsStore } from '@/lib/store/useOpticsStore';
import { formatLatexFallback, renderFormula, renderBlockFormula } from '@/components/math/MathTypography';
import { PerformanceHUD } from '@/components/metrics/PerformanceHUD';
import { DualViewport } from '@/components/viewer/DualViewport';

describe('MathTypography & KaTeX Fallback Formatting', () => {
  it('correctly formats fractions into semantic HTML', () => {
    const res = formatLatexFallback('\\frac{2\\pi}{\\lambda_0}');
    expect(res).toContain('class="math-frac"');
    expect(res).toContain('class="math-num"');
    expect(res).toContain('class="math-denom"');
    expect(res).toContain('2π');
    expect(res).toContain('λ<sub>0</sub>');
  });

  it('correctly formats square roots and operators', () => {
    const res = formatLatexFallback('\\sqrt{r^2 + f^2} - f');
    expect(res).toContain('class="math-sqrt"');
    expect(res).toContain('class="math-radical"');
    expect(res).toContain('r<sup>2</sup> + f<sup>2</sup>');
  });

  it('correctly replaces Greek letters and physical constants', () => {
    const res = formatLatexFallback('\\phi + \\theta + \\sigma + \\ell \\hbar');
    expect(res).toContain('ϕ');
    expect(res).toContain('θ');
    expect(res).toContain('σ');
    expect(res).toContain('ℓ');
    expect(res).toContain('ℏ');
  });

  it('correctly formats 2x2 Jones matrices', () => {
    const matrixTex = '\\begin{bmatrix} t_u & 0 \\\\ 0 & t_v \\end{bmatrix}';
    const res = formatLatexFallback(matrixTex);
    expect(res).toContain('class="math-matrix"');
    expect(res).toContain('class="math-matrix-table"');
    expect(res).toContain('t<sub>u</sub>');
    expect(res).toContain('t<sub>v</sub>');
  });

  it('renderFormula and renderBlockFormula wrap in appropriate math classes', () => {
    const inline = renderFormula('n_t \\sin\\theta_t');
    expect(inline).toContain('class="math-tex"');
    expect(inline).toContain('class="math-op">sin');

    const block = renderBlockFormula('\\phi(r) = -k_0 r');
    expect(block).toContain('class="math-block"');
  });
});

describe('PerformanceHUD Metrics & Alarms', () => {
  let mockElement: { innerHTML: string };
  let hud: PerformanceHUD;

  beforeEach(() => {
    mockElement = { innerHTML: '' };
    opticsStore.update({
      wavelength: 0.532,
      designWavelength: 0.532,
      focalLength: 25.0,
      diameter: 30.0,
      deflectionAngle: 0.35,
      topologicalCharge: 1,
      deviceType: 'metalens',
      material: 'TiO2',
      stokes: [1, 0, 0, 1],
      pitchNm: 400,
      heightNm: 600,
      renderMode: 'field',
      isPlaying: true
    });
    hud = new PerformanceHUD(mockElement as unknown as HTMLElement);
  });

  it('renders all 6 performance metric cards without a feasibility claim', () => {
    hud.render();
    const cardMatches = mockElement.innerHTML.match(/class="hud-card"/g);
    expect(cardMatches?.length).toBe(6);
    expect(mockElement.innerHTML).not.toContain('All nanofabrication & optical design criteria met');
  });

  it('triggers critical pattern collapse alarm when height = 900 nm and min diameter = 80 nm (AR = 11.25 > 10)', () => {
    opticsStore.getState().setHeightNm(900); // 900 / 80 = 11.25:1 > 10
    hud.render();
    expect(mockElement.innerHTML).toContain('alarm-critical');
    expect(mockElement.innerHTML).toContain('High risk of nanopillar pattern collapse');
  });

  it('triggers gap resolution alarm when pitch is decreased or min gap < 40 nm', () => {
    opticsStore.getState().setPitchNm(350); // minGap = 350 - 340 = 10 nm < 40 nm
    hud.render();
    expect(mockElement.innerHTML).toContain('alarm-warning');
    expect(mockElement.innerHTML).toContain('below critical lithography limit');
  });

  it('triggers Silicon visible absorption loss alarm when material is Si and lambda < 800 nm', () => {
    opticsStore.getState().setMaterial('Si');
    opticsStore.getState().setWavelength(0.532); // 532 nm is lossy for Si
    hud.render();
    expect(mockElement.innerHTML).toContain('Material Absorption Loss');
    expect(mockElement.innerHTML).toContain('Silicon is strongly absorbing in the visible spectrum');
  });
});

describe('OpticsStore Reactive State Management', () => {
  beforeEach(() => {
    opticsStore.update({
      wavelength: 0.532,
      designWavelength: 0.532,
      focalLength: 25.0,
      diameter: 30.0,
      deflectionAngle: 0.35,
      topologicalCharge: 1,
      deviceType: 'metalens',
      material: 'TiO2',
      stokes: [1, 0, 0, 1],
      pitchNm: 400,
      heightNm: 600,
      renderMode: 'field',
      isPlaying: true,
      cghPhaseMask: null
    });
  });

  it('notifies subscribers upon parameter changes', () => {
    let callCount = 0;
    let lastWavelength = 0;

    const unsubscribe = opticsStore.subscribe((state) => {
      callCount++;
      lastWavelength = state.wavelength;
    });

    opticsStore.getState().setWavelength(0.650);
    expect(callCount).toBe(1);
    expect(lastWavelength).toBe(0.650);
    expect(opticsStore.getState().wavelength).toBe(0.650);

    opticsStore.getState().setDeviceType('vortex');
    expect(callCount).toBe(2);
    expect(opticsStore.getState().deviceType).toBe('vortex');

    unsubscribe();
    opticsStore.getState().setWavelength(0.532);
    expect(callCount).toBe(2);
  });

  it('correctly updates and retains device mode and render mode', () => {
    opticsStore.getState().setDeviceType('deflector');
    expect(opticsStore.getState().deviceType).toBe('deflector');

    opticsStore.getState().setRenderMode('intensity');
    expect(opticsStore.getState().renderMode).toBe('intensity');

    opticsStore.getState().setRenderMode('phase');
    expect(opticsStore.getState().renderMode).toBe('phase');
  });

  it('correctly manages intensityMax parameter in reactive store for GPU wavefield intensity modality', () => {
    expect(opticsStore.getState().intensityMax).toBe(1.0);

    let observedVal = 0;
    const unsubscribe = opticsStore.subscribe((state) => {
      observedVal = state.intensityMax;
    });

    opticsStore.getState().setIntensityMax(15.5);
    expect(opticsStore.getState().intensityMax).toBe(15.5);
    expect(observedVal).toBe(15.5);

    opticsStore.getState().setIntensityMax(1.0);
    expect(opticsStore.getState().intensityMax).toBe(1.0);
    expect(observedVal).toBe(1.0);

    unsubscribe();
  });

  it('manages Gerchberg-Saxton CGH phase mask in reactive store', () => {
    const dummyMask = Array.from({ length: 32 }, () => new Array(32).fill(Math.PI));
    opticsStore.getState().setCghPhaseMask(dummyMask);
    expect(opticsStore.getState().cghPhaseMask).toEqual(dummyMask);
    expect(opticsStore.getState().cghPhaseMask?.[0][0]).toBe(Math.PI);
  });

  it('DualViewport renders demonstration controls panel with focal length, diameter and wavelength sliders adjacent to visualizer', () => {
    const template = DualViewport.getTemplate();
    expect(template).toContain('id="viewport-controls-panel"');
    expect(template).toContain('id="demo-slider-focal"');
    expect(template).toContain('id="demo-slider-diameter"');
    expect(template).toMatch(/id="demo-slider-diameter"[^>]*max="50"/);
    expect(template.match(/aria-label="Demonstration Aperture Diameter"/g)).toHaveLength(1);
    expect(template.match(/aria-label="Demonstration Wavelength"/g)).toHaveLength(1);
    expect(template).toContain('id="demo-slider-wavelength"');
    expect(template).toContain('id="demo-controls-metalens"');
    expect(template).toContain('id="demo-controls-deflector"');
    expect(template).toContain('id="demo-controls-vortex"');
    expect(template).toContain('id="demo-controls-hologram"');
    expect(template).toContain('id="demo-slider-holo-iterations"');
    expect(template).toContain('data-demo-focal="15"');
    expect(template).toContain('data-demo-focal="25"');
    expect(template).toContain('data-demo-focal="38"');
    expect(template).toContain('data-demo-diam="30"');
    expect(template).toContain('data-demo-wl="532"');
    expect(template).toContain('data-demo-mat="TiO2" disabled');
    expect(template).toContain('data-demo-mat="Si" disabled');
    expect(template).not.toContain('id="hud-root"');
  });

  it('DualViewport renders the physical spatial scale ruler and maintains constant XYZ spatial scale across demonstrations', () => {
    const template = DualViewport.getTemplate();
    expect(template).toContain('id="wavefield-scale-ruler"');
    expect(template).toContain('id="scale-ruler-bar"');
    expect(template).toContain('10 µm');
  });

  it('store combines multiple gradients and keeps at least one active', () => {
    opticsStore.getState().setActiveGradients({ lens: true, deflect: true, vortex: false, hologram: false });
    expect(opticsStore.getState().activeGradients).toEqual({ lens: true, deflect: true, vortex: false, hologram: false });
    opticsStore.getState().toggleGradient('vortex');
    expect(opticsStore.getState().activeGradients.vortex).toBe(true);
    opticsStore.getState().setActiveGradients({ lens: false, deflect: false, vortex: false, hologram: false });
    opticsStore.getState().setDeviceType('metalens');
    opticsStore.getState().toggleGradient('lens');
    expect(opticsStore.getState().activeGradients.lens).toBe(true);
  });

  it('store manages probeZ, xyZoom and xyViewMode', () => {
    opticsStore.getState().setProbeZ(33.5);
    opticsStore.getState().setXyZoom(5);
    opticsStore.getState().setXyViewMode('inset');
    const s = opticsStore.getState();
    expect(s.probeZ).toBe(33.5);
    expect(s.xyZoom).toBe(5);
    expect(s.xyViewMode).toBe('inset');
    s.setXyViewMode('panel');
    s.setXyZoom(1);
  });

  it('DualViewport renders the XY profile panel and gradient combiner', () => {
    const template = DualViewport.getTemplate();
    expect(template.match(/class="segmented-control viewport-render-mode"/g)).toHaveLength(2);
    expect(template.match(/data-render="intensity"/g)).toHaveLength(3);
    expect(template.match(/data-near-scale="log"/g)).toHaveLength(2);
    expect(template).toContain('id="xy-card"');
    expect(template).toContain('id="xy-profile-canvas"');
    expect(template).toContain('id="xy-probe-slider"');
    expect(template).toContain('id="btn-toggle-xy-mode"');
    expect(template).toContain('data-gradient="lens"');
    expect(template).toContain('data-gradient="vortex"');
    expect(template).toContain('data-preset="offaxis-lens"');
    expect(template).toContain('data-preset="focused-vortex"');
  });


});
