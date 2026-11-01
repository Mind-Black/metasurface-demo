import { opticsStore, OpticsState } from '@/lib/store/useOpticsStore';
import { calculateNumericalAperture, calculateAbbeLimit } from '@/lib/optics/phaseProfiles';
import { queryUnitCellLUT } from '@/lib/optics/rcwaLut';
import { TiO2_Dispersion, Silicon_Dispersion } from '@/lib/optics/materials';

export class PerformanceHUD {
  private element: HTMLElement;
  private unsubscribe: (() => void) | null = null;

  constructor(element: HTMLElement) {
    this.element = element;
    this.unsubscribe = opticsStore.subscribe(() => {
      this.render();
    });
    this.render();
  }

  private wavelengthToHex(wavelengthUm: number): string {
    const nm = wavelengthUm * 1000;
    if (nm < 440) return '#818cf8'; // Violet
    if (nm < 490) return '#38bdf8'; // Blue
    if (nm < 560) return '#4ade80'; // Green
    if (nm < 590) return '#facc15'; // Yellow
    if (nm < 630) return '#fb923c'; // Orange
    if (nm <= 780) return '#f87171'; // Red
    return '#e879f9'; // NIR
  }

  public render(): void {
    const state = opticsStore.getState();
    const na = calculateNumericalAperture(state.diameter, state.focalLength);
    const abbeLimitUm = calculateAbbeLimit(state.wavelength, na);
    const abbeLimitNm = abbeLimitUm * 1000;

    // Simulated FWHM considering phase error and jitter
    const fwhmFactor = 1.0 + 3.0 * state.toleranceJitter;
    const actualFwhmNm = abbeLimitNm * fwhmFactor;

    // Phase discretization variance (3-bit / 8-level) + manufacturing jitter
    const sigmaJitterRad = state.toleranceJitter * 2 * Math.PI;
    const sigmaDiscRad = (2 * Math.PI) / (8 * Math.sqrt(12));
    const sigmaTotal = Math.sqrt(sigmaJitterRad * sigmaJitterRad + sigmaDiscRad * sigmaDiscRad);
    const strehlRatio = Math.max(0.01, Math.min(1.0, Math.exp(-sigmaTotal * sigmaTotal)));

    // Material transmission & efficiency
    const lutSample = queryUnitCellLUT(180, state.wavelength * 1000, state.heightNm, state.pitchNm, state.material);
    const sincEfficiency = Math.pow(Math.sin(Math.PI / 8) / (Math.PI / 8), 2);
    const efficiency = Math.max(0.05, Math.min(0.98, lutSample.transmission * sincEfficiency * strehlRatio));

    // Nanofabrication constraints check
    // To achieve full 2pi phase coverage, nanopillars must span diameters up to ~320 nm
    const minD = 80;
    const maxRequiredD = 320;
    const maxAR = state.heightNm / minD;
    const minGap = state.pitchNm - maxRequiredD;

    const arViolation = maxAR > 10;
    const gapViolation = minGap < 40;
    const siLossViolation = state.material === 'Si' && state.wavelength < 0.8;

    const colorPill = this.wavelengthToHex(state.wavelength);

    this.element.innerHTML = `
      <div class="hud-container">
        <!-- Main Metrics Grid -->
        <div class="hud-grid">
          <div class="hud-card">
            <span class="hud-label">Wavelength (λ)</span>
            <div class="hud-value-row">
              <span class="hud-dot" style="background-color: ${colorPill}"></span>
              <span class="hud-value">${(state.wavelength * 1000).toFixed(0)} <span class="hud-unit">nm</span></span>
              <span class="hud-badge">${state.material}</span>
            </div>
          </div>

          <div class="hud-card">
            <span class="hud-label">Numerical Aperture (NA)</span>
            <div class="hud-value-row">
              <span class="hud-value">${na.toFixed(2)}</span>
              <span class="hud-sub">f = ${state.focalLength.toFixed(0)} µm, D = ${state.diameter.toFixed(0)} µm</span>
            </div>
          </div>

          <div class="hud-card">
            <span class="hud-label">Focal Spot FWHM</span>
            <div class="hud-value-row">
              <span class="hud-value highlight-cyan">${actualFwhmNm.toFixed(0)} <span class="hud-unit">nm</span></span>
              <span class="hud-sub">(Abbe Limit: ${abbeLimitNm.toFixed(0)} nm)</span>
            </div>
          </div>

          <div class="hud-card">
            <span class="hud-label">Strehl Ratio (S)</span>
            <div class="hud-value-row">
              <span class="hud-value ${strehlRatio > 0.8 ? 'highlight-green' : 'highlight-amber'}">${strehlRatio.toFixed(2)}</span>
              <span class="hud-sub">Phase discretization & CD jitter</span>
            </div>
          </div>

          <div class="hud-card">
            <span class="hud-label">Focusing Efficiency (η)</span>
            <div class="hud-value-row">
              <span class="hud-value highlight-purple">${(efficiency * 100).toFixed(1)}<span class="hud-unit">%</span></span>
              <span class="hud-sub">T = ${(lutSample.transmission * 100).toFixed(0)}%</span>
            </div>
          </div>

          <div class="hud-card">
            <span class="hud-label">Max Aspect Ratio (AR)</span>
            <div class="hud-value-row">
              <span class="hud-value ${arViolation ? 'highlight-red' : 'highlight-green'}">${maxAR.toFixed(1)}:1</span>
              <span class="hud-sub">Collapse threshold: 10:1</span>
            </div>
          </div>
        </div>

        <!-- Alarms and Warnings Section -->
        ${(arViolation || gapViolation || siLossViolation) ? `
          <div class="hud-alarms" role="alert" aria-live="polite">
            ${arViolation ? `
              <div class="alarm-banner alarm-critical">
                <svg class="alarm-icon" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
                <span><strong>Nanofabrication Warning:</strong> High risk of nanopillar pattern collapse due to surface tension during wet drying (${maxAR.toFixed(1)}:1 exceeds nanofab collapse limit of 10:1).</span>
              </div>
            ` : ''}

            ${gapViolation ? `
              <div class="alarm-banner alarm-warning">
                <svg class="alarm-icon" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span><strong>Resolution Warning:</strong> Inter-pillar gap (${minGap.toFixed(0)} nm) below critical lithography limit (< 40 nm): proximity effect error in EBL / ALD pinch-off.</span>
              </div>
            ` : ''}

            ${siLossViolation ? `
              <div class="alarm-banner alarm-amber">
                <svg class="alarm-icon" viewBox="0 0 24 24" width="18" height="18" stroke="currentColor" fill="none" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                <span><strong>Material Absorption Loss:</strong> Silicon is strongly absorbing in the visible spectrum (bandgap ~1.1 eV, k > 0.1). Switch to TiO₂ for visible wavelengths or shift λ > 1000 nm.</span>
              </div>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }

  public destroy(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
