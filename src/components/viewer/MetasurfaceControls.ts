import { opticsStore, type OpticsState } from '@/lib/store/useOpticsStore';
import { designKey, librarySupport } from '@/lib/optics/metasurface';
import type { DeviceDesign, PhaseProfile } from '@/lib/optics/metasurface';

const deg = (radians: number): number => radians * 180 / Math.PI;
const rad = (degrees: number): number => degrees * Math.PI / 180;
const esc = (value: string): string => value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

/** Preserve focused controls and native checkbox activation while updating their surroundings. */
function reconcile(parent: Node, next: Node): void {
  const wanted = Array.from(next.childNodes);
  wanted.forEach((source, index) => {
    const current = parent.childNodes[index];
    if (!current) { parent.appendChild(source.cloneNode(true)); return; }
    if (current.nodeType !== source.nodeType || current.nodeName !== source.nodeName) {
      parent.replaceChild(source.cloneNode(true), current);
      return;
    }
    if (current instanceof Element && source instanceof Element) {
      // `open` is user-controlled state on native disclosures. Keep it when the
      // surrounding controls rerender after a store update.
      const preserveOpen = current instanceof HTMLDetailsElement;
      for (const attr of Array.from(current.attributes)) if (!(preserveOpen && attr.name === 'open') && !source.hasAttribute(attr.name)) current.removeAttribute(attr.name);
      for (const attr of Array.from(source.attributes)) if (!(preserveOpen && attr.name === 'open') && current.getAttribute(attr.name) !== attr.value) current.setAttribute(attr.name, attr.value);
      reconcile(current, source);
      if (current instanceof HTMLInputElement && source instanceof HTMLInputElement) {
        current.checked = source.checked;
        if (current !== document.activeElement) current.value = source.value;
      } else if (current instanceof HTMLSelectElement && source instanceof HTMLSelectElement && current !== document.activeElement) {
        current.value = source.value;
      }
    } else if (current.nodeValue !== source.nodeValue) current.nodeValue = source.nodeValue;
  });
  while (parent.childNodes.length > wanted.length) parent.removeChild(parent.lastChild!);
}

/** Controls for the two-function, single-layer metasurface designs. */
export class MetasurfaceControls {
  private host: HTMLElement;
  private unsubscribe: (() => void) | null = null;
  private metricsSignature = '';
  private geometrySignature = '';

  constructor(host: HTMLElement) {
    this.host = host;
    this.host.addEventListener('click', this.onClick);
    this.host.addEventListener('input', this.onInput);
    this.host.addEventListener('focusout', this.onBlur);
    this.unsubscribe = opticsStore.subscribe((state) => this.render(state));
    this.render(opticsStore.getState());
  }

  destroy(): void {
    this.unsubscribe?.();
    this.host.removeEventListener('click', this.onClick);
    this.host.removeEventListener('input', this.onInput);
    this.host.removeEventListener('focusout', this.onBlur);
  }

  private onClick = (event: Event): void => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-design-kind], button[data-design-basis], button[data-response]');
    if (!button) return;
    const state = opticsStore.getState();
    if (button.dataset.designKind) state.setDesignKind(button.dataset.designKind as 'legacy' | 'orthogonal' | 'hybrid');
    if (button.dataset.designBasis) {
      const preset = button.dataset.designBasis;
      if (preset !== 'custom') {
        const [psi, chi] = preset.split(',').map(Number);
        state.setDesignBasis(rad(psi), rad(chi));
      }
    }
    if (button.dataset.response) state.setResponseModel(button.dataset.response as 'ideal' | 'library');
  };

  private onInput = (event: Event): void => {
    const input = event.target as HTMLInputElement | HTMLSelectElement;
    if (input.type === 'number' && (input.value === '' || !Number.isFinite(Number(input.value)))) return;
    const field = input.dataset.profileField;
    if (field) {
      const idx = Number(input.dataset.profileIndex) as 0 | 1;
      let value: boolean | number | string = input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value : Number(input.value);
      if (field === 'focalLength' && value === 0) return;
      if (field === 'deflectionAngle' && typeof value === 'number') value = rad(value);
      if (typeof value === 'number') {
        const bounds: Record<string, [number, number, number?]> = {
          deflectionAngle: [rad(-60), rad(60)], topologicalCharge: [-10, 10, 1], axiconNA: [-0.85, 0.85], hologramIterations: [1, 500, 1],
        };
        const [min, max, step] = bounds[field] ?? [-Infinity, Infinity];
        value = Math.max(min, Math.min(max, value));
        if (step) value = Math.round(value / step) * step;
      }
      opticsStore.getState().setProfile(idx, { [field]: value } as Partial<PhaseProfile>);
    }
    if (input.dataset.basisField) {
      const design = opticsStore.getState().savedOrthogonalDesign;
      const psi = input.dataset.basisField === 'psi' ? rad(Math.max(-90, Math.min(90, Number(input.value)))) : design.basis.psi;
      const chi = input.dataset.basisField === 'chi' ? rad(Math.max(-45, Math.min(45, Number(input.value)))) : design.basis.chi;
      opticsStore.getState().setDesignBasis(psi, chi);
    }
  };

  // Keep the DOM intact between pointer-down (which blurs an editor) and click.
  // Replacing the host here removes the button the user is trying to activate.
  private onBlur = (event: Event): void => {
    const input = event.target as HTMLInputElement;
    if (input.type !== 'number') return;
    const state = opticsStore.getState();
    if (input.dataset.basisField) {
      input.value = deg(state.savedOrthogonalDesign.basis[input.dataset.basisField as 'psi' | 'chi']).toFixed(1);
    } else if (input.dataset.profileField && state.design.kind !== 'legacy') {
      const key = input.dataset.profileField as keyof PhaseProfile;
      const value = state.design.profiles[Number(input.dataset.profileIndex)][key];
      if (typeof value === 'number') input.value = String(key === 'deflectionAngle' ? deg(value) : value);
    }
  };

  private render(state: OpticsState): void {
    const design = state.design;
    const kind = design.kind;
    const profiles = design.kind === 'legacy' ? [] : design.profiles;
    const supportMessage = librarySupport(state.designWavelength, state.wavelength, state.material, state.pitchNm, state.heightNm);
    const modelDescription = kind === 'hybrid'
      ? 'Set a dynamic phase profile and an independent PB geometric phase profile (combining lens, deflect, vortex, axicon, and hologram) for circular output. RCP → LCP receives D + ΦPB + π/2; LCP → RCP receives D − ΦPB + π/2 (inverting PB profiles such as focusing lenses, vortex charges, and axicon cones). Here θ = ΦPB/2; both conversions share the same π/2 offset.'
      : kind === 'orthogonal'
        ? 'Set two independent phase profiles (combining lens, deflect, vortex, axicon, and hologram) on a design input-polarization basis; the output components obey conjugate constraints.'
        : 'Choose a two-function design architecture.';
    const opticsSignature = `${designKey(design)}|${state.responseModel}|${state.designWavelength}|${state.wavelength}|${state.diameter}|${state.material}|${state.pitchNm}|${state.heightNm}|${state.stokes.join(',')}|${state.analyzer}`;
    const geometrySignature = `${designKey(design)}|${state.designWavelength}|${state.material}|${state.pitchNm}|${state.heightNm}|${state.phaseMapChannel}|${state.responseModel}`;
    const currentMetrics = this.host.querySelector<HTMLElement>('#metasurface-metrics')?.textContent ?? '';
    const currentGeometry = this.host.querySelector<HTMLElement>('#metasurface-geometry-note')?.textContent ?? '';
    const preservedMetrics = this.metricsSignature === opticsSignature ? currentMetrics : '';
    const preservedGeometry = this.geometrySignature === geometrySignature ? currentGeometry : '';
    this.metricsSignature = opticsSignature;
    this.geometrySignature = geometrySignature;
    this.host.dataset.designKind = kind;

    const metricText = supportMessage
      ? `Library comparison unavailable: ${supportMessage}${state.responseModel === 'library' ? ' The library response remains selected.' : ''}`
      : preservedMetrics || 'Calculating library comparison…';

    const template = document.createElement('template');
    template.innerHTML = `
      <section class="metasurface-controls" aria-labelledby="metasurface-title">
        <div class="metasurface-controls-head">
          <div><h3 id="metasurface-title">Single-layer metasurface design</h3></div>
          <div class="segmented-control design-kind-control" role="group" aria-label="Metasurface design architecture">
            ${[['legacy','Legacy'],['orthogonal','Orthogonal channels'],['hybrid','Dynamic + PB']].map(([value, label]) => `<button class="seg-btn ${kind === value ? 'active' : ''}" type="button" data-design-kind="${value}" aria-pressed="${kind === value}">${label}</button>`).join('')}
          </div>
        </div>
        <div class="metasurface-design-body ${kind === 'legacy' ? 'hidden' : ''}">
          <div class="metasurface-top-grid">
            ${kind === 'orthogonal' ? this.basisMarkup(design as Extract<DeviceDesign, {kind:'orthogonal'}>) : '<div class="design-note hybrid-note"><strong title="RCP → LCP: D + ΦPB + π/2; LCP → RCP: D − ΦPB + π/2; θ = ΦPB/2">Hybrid circular output</strong></div>'}
            <div class="response-choice">
              <span class="demo-label">Response model</span>
              <div class="segmented-control" role="group" aria-label="Metasurface response model">
                <button class="seg-btn ${state.responseModel === 'ideal' ? 'active' : ''}" type="button" data-response="ideal" aria-pressed="${state.responseModel === 'ideal'}" title="Dispersion-free ideal local-retarder target for comparing channel phase designs.">Ideal target</button>
                <button class="seg-btn ${state.responseModel === 'library' ? 'active' : ''}" type="button" data-response="library" aria-pressed="${state.responseModel === 'library'}" title="Local-periodic unit-cell library response. Angular-spectrum propagation is a transverse-field approximation, not a full-device simulation.">Library prediction</button>
              </div>
              <p class="${supportMessage ? 'response-unavailable' : ''}">${supportMessage ? `Library comparison unavailable: ${esc(supportMessage)}${state.responseModel === 'library' ? ' The library response remains selected.' : ''}` : ''}</p>
            </div>
          </div>
          <div class="metasurface-profile-grid">${profiles.map((profile, index) => this.profileMarkup(profile, index, kind)).join('')}</div>
          <details class="metasurface-help model-disclosure"><summary>Learn more about this model</summary>
            <p>${esc(modelDescription)}</p>
            <div id="metasurface-physics-note" class="metasurface-geometry-note" role="note">In this single-layer model, J uⱼ = exp(iφⱼ) uⱼ*: each input has an independent phase and its complex-conjugate output polarization. Linear states are preserved; elliptical and circular handedness reverses. The ideal target matrix stays fixed during wavelength scans. Propagation uses a transverse-field angular-spectrum approximation, not a full-device electromagnetic simulation. <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC9729203/" target="_blank" rel="noreferrer">Research background</a></div>
            <div id="metasurface-geometry-note" class="metasurface-geometry-note" role="note">${esc(preservedGeometry)}</div>
          </details>
          <details class="metasurface-help metrics-disclosure"><summary>Library metrics · Learn more</summary><div id="metasurface-metrics" class="metasurface-metrics" aria-live="polite">${esc(metricText)}</div></details>
        </div>
      </section>`;
    reconcile(this.host, template.content);
  }

  private basisMarkup(design: Extract<DeviceDesign, {kind:'orthogonal'}>): string {
    const psi = deg(design.basis.psi), chi = deg(design.basis.chi);
    const presets: Array<[string, number, number]> = [['H / V',0,0],['V / H',90,0],['+45° / −45°',45,0],['−45° / +45°',-45,0],['RCP / LCP',0,45],['LCP / RCP',0,-45]];
    const selected = (p: number, c: number) => Math.abs(psi-p)<0.5 && Math.abs(chi-c)<0.5;
    return `<div class="design-note basis-note"><strong>Design input polarization pair</strong>
      <div class="metasurface-preset-row" role="group" aria-label="Design input basis presets">${presets.map(([label,p,c]) => `<button type="button" class="basis-preset ${selected(p,c) ? 'active' : ''}" data-design-basis="${p},${c}" aria-pressed="${selected(p,c)}">${label}</button>`).join('')}</div>
      <div class="basis-custom-fields"><label>ψ <input type="number" min="-90" max="90" step="1" data-basis-field="psi" value="${psi.toFixed(1)}" aria-label="Basis orientation psi in degrees">°</label><label>χ <input type="number" min="-45" max="45" step="1" data-basis-field="chi" value="${chi.toFixed(1)}" aria-label="Basis ellipticity chi in degrees">°</label></div>
    </div>`;
  }

  private profileMarkup(profile: PhaseProfile, index: number, kind: DeviceDesign['kind']): string {
    const title = kind === 'hybrid' ? (index === 0 ? 'Dynamic phase' : 'PB phase') : `Channel ${index + 1}`;
    const check = (key: keyof PhaseProfile, label: string, description: string) => `<label class="profile-function" title="${description}"><input type="checkbox" data-profile-index="${index}" data-profile-field="${key}" title="${description}" ${profile[key] ? 'checked' : ''}>${label}</label>`;
    const number = (key: keyof PhaseProfile, label: string, value: number, min: number | undefined, max: number | undefined, step: number | 'any', unit: string) => {
      const minAttr = min === undefined ? '' : ` min="${min}"`;
      const maxAttr = max === undefined ? '' : ` max="${max}"`;
      return `<label class="profile-number">${label}<span><input type="number" data-profile-index="${index}" data-profile-field="${key}" value="${value}"${minAttr}${maxAttr} step="${step}"><small>${unit}</small></span></label>`;
    };
    const hologram = profile.hologram ? `<div class="profile-extra"><label class="profile-number">Target<select data-profile-index="${index}" data-profile-field="hologramTarget"><option value="crest" ${profile.hologramTarget === 'crest' ? 'selected' : ''}>Crest</option><option value="smiley" ${profile.hologramTarget === 'smiley' ? 'selected' : ''}>Smiley</option><option value="mu" ${profile.hologramTarget === 'mu' ? 'selected' : ''}>μ</option></select></label>${number('hologramIterations','Iterations',profile.hologramIterations,1,500,1,'')}</div>` : '';
    return `<article class="metasurface-profile-card"><header><h4>${title}</h4><span>Profile ${index+1}</span></header>
      <div class="profile-functions">${check('lens','Lens','Add a focusing phase profile.')}${check('deflect','Deflect','Add a linear phase ramp to steer the beam.')}${check('vortex','Vortex','Add an orbital angular momentum phase profile.')}${check('axicon','Axicon','Add a conical radial phase profile for Bessel-beam generation.')}${check('hologram','Hologram','Add an iterative phase-only hologram.')}</div>
      <div class="profile-parameters">${number('focalLength','Focal length',profile.focalLength,undefined,undefined,'any','µm')}${number('deflectionAngle','Deflection angle',deg(profile.deflectionAngle),-60,60,1,'°')}${number('topologicalCharge','Topological charge',profile.topologicalCharge,-10,10,1,'ℓ')}${number('axiconNA','Axicon NA',profile.axiconNA,-0.85,0.85,0.05,'')}</div>
      ${hologram}</article>`;
  }
}
