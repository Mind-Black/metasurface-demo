/**
 * Math Typography & KaTeX Rendering Engine
 * Renders mathematical typography using KaTeX when available,
 * with a high-fidelity standalone parser fallback for offline and headless environments.
 */

declare global {
  interface Window {
    katex?: {
      renderToString: (tex: string, options?: { displayMode?: boolean; throwOnError?: boolean }) => string;
    };
  }
}

/**
 * Converts common LaTeX math expressions into semantic HTML with proper math typography.
 */
export function formatLatexFallback(tex: string, displayMode: boolean = false): string {
  let s = tex.trim();

  // Clean double backslashes from template string escapes
  s = s.replace(/\\\\/g, '\\');

  // Handle matrices: \begin{bmatrix} a & b \\ c & d \end{bmatrix}
  s = s.replace(/\\begin\{bmatrix\}([\s\S]*?)\\end\{bmatrix\}/g, (_, inner) => {
    const rows = inner.split('\\').map((row: string) =>
      row.split('&').map((cell: string) => `<td class="math-matrix-cell">${formatLatexFallback(cell.trim(), false)}</td>`).join('')
    );
    return `<span class="math-matrix"><span class="matrix-bracket">[</span><table class="math-matrix-table"><tr>${rows.join('</tr><tr>')}</tr></table><span class="matrix-bracket">]</span></span>`;
  });

  // Handle \frac{numerator}{denominator} recursively
  while (/\\frac\{([^{}]+)\}\{([^{}]+)\}/.test(s)) {
    s = s.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, (_, num, denom) => {
      return `<span class="math-frac"><span class="math-num">${formatLatexFallback(num, false)}</span><span class="math-denom">${formatLatexFallback(denom, false)}</span></span>`;
    });
  }

  // Handle \sqrt{content}
  while (/\\sqrt\{([^{}]+)\}/.test(s)) {
    s = s.replace(/\\sqrt\{([^{}]+)\}/g, (_, content) => {
      return `<span class="math-sqrt"><span class="math-radical">&radic;</span><span class="math-radicand">${formatLatexFallback(content, false)}</span></span>`;
    });
  }

  // Greek letters & physical symbols
  const symbolMap: Record<string, string> = {
    '\\alpha': 'α',
    '\\beta': 'β',
    '\\gamma': 'γ',
    '\\delta': 'δ',
    '\\Delta': 'Δ',
    '\\epsilon': 'ϵ',
    '\\varepsilon': 'ε',
    '\\theta': 'θ',
    '\\lambda': 'λ',
    '\\lambda_0': 'λ₀',
    '\\Lambda': 'Λ',
    '\\mu': 'µ',
    '\\pi': 'π',
    '\\Pi': 'Π',
    '\\rho': 'ρ',
    '\\sigma': 'σ',
    '\\phi': 'ϕ',
    '\\Phi': 'Φ',
    '\\psi': 'ψ',
    '\\Psi': 'Ψ',
    '\\omega': 'ω',
    '\\Omega': 'Ω',
    '\\Gamma': 'Γ',
    '\\ell': 'ℓ',
    '\\hbar': 'ℏ',
    '\\zeta': 'ζ',
    '\\partial': '∂',
    '\\nabla': '∇',
    '\\infty': '∞',
    '\\pm': '±',
    '\\mp': '∓',
    '\\times': '×',
    '\\cdot': '·',
    '\\approx': '≈',
    '\\propto': '∝',
    '\\le': '≤',
    '\\ge': '≥',
    '\\ne': '≠',
    '\\in': '∈',
    '\\notin': '∉',
    '\\int': '∫',
    '\\iint': '∬',
    '\\dots': '…',
    '\\to': '→',
    '\\implies': '⟹',
    '\\quad': '&emsp;',
    '\\qquad': '&emsp;&emsp;',
    '\\,': '&thinsp;',
    '\\;': '&ensp;',
  };

  for (const [cmd, sym] of Object.entries(symbolMap)) {
    const escapedCmd = cmd.replace(/\\/g, '\\\\');
    s = s.replace(new RegExp(escapedCmd + '(?![a-zA-Z])', 'g'), sym);
  }

  // Common math operators
  const ops = ['sin', 'cos', 'tan', 'arcsin', 'arccos', 'arctan', 'exp', 'ln', 'log', 'arg', 'min', 'max'];
  for (const op of ops) {
    s = s.replace(new RegExp(`\\\\${op}(?![a-zA-Z])`, 'g'), `<span class="math-op">${op}</span>`);
  }

  // \text{...} and \mathbf{...} and \mathcal{...} and \mathbb{...}
  s = s.replace(/\\text\{([^{}]+)\}/g, '<span class="math-text">$1</span>');
  s = s.replace(/\\mathbf\{([^{}]+)\}/g, '<strong class="math-bold">$1</strong>');
  s = s.replace(/\\mathcal\{([^{}]+)\}/g, '<span class="math-cal">$1</span>');
  s = s.replace(/\\mathbb\{([^{}]+)\}/g, '<span class="math-bb">$1</span>');

  // \left and \right delimiters
  s = s.replace(/\\left\(/g, '<span class="math-delim">(</span>');
  s = s.replace(/\\right\)/g, '<span class="math-delim">)</span>');
  s = s.replace(/\\left\[/g, '<span class="math-delim">[</span>');
  s = s.replace(/\\right\]/g, '<span class="math-delim">]</span>');
  s = s.replace(/\\left\\\{/g, '<span class="math-delim">{</span>');
  s = s.replace(/\\right\\\}/g, '<span class="math-delim">}</span>');

  // Dirac bra-ket notations: |\mathbf{E}\rangle -> |E⟩
  s = s.replace(/\\langle/g, '⟨').replace(/\\rangle/g, '⟩');

  // Superscripts: ^{expr} or ^char
  s = s.replace(/\^\{([^{}]+)\}/g, '<sup>$1</sup>');
  s = s.replace(/\^([0-9a-zA-Z\+\-\*])/g, '<sup>$1</sup>');

  // Subscripts: _{expr} or _char
  s = s.replace(/_\{([^{}]+)\}/g, '<sub>$1</sub>');
  s = s.replace(/_([0-9a-zA-Z])/g, '<sub>$1</sub>');

  // Remaining single backslashes followed by alphanumeric (cleanup any dangling commands)
  s = s.replace(/\\([a-zA-Z]+)/g, '<span class="math-sym">$1</span>');

  const wrapperClass = displayMode ? 'math-block' : 'math-tex';
  return `<span class="${wrapperClass}">${s}</span>`;
}

/**
 * Primary formula rendering entry point: prefers KaTeX if loaded, falls back to semantic HTML.
 */
export function renderFormula(math: string): string {
  if (typeof window !== 'undefined' && window.katex) {
    try {
      return window.katex.renderToString(math, { displayMode: false, throwOnError: false });
    } catch {
      return formatLatexFallback(math, false);
    }
  }
  return formatLatexFallback(math, false);
}

/**
 * Primary display/block formula rendering entry point.
 */
export function renderBlockFormula(math: string): string {
  if (typeof window !== 'undefined' && window.katex) {
    try {
      return window.katex.renderToString(math, { displayMode: true, throwOnError: false });
    } catch {
      return formatLatexFallback(math, true);
    }
  }
  return formatLatexFallback(math, true);
}

/**
 * Scans the provided container or document and upgrades all .math-tex and .math-block
 * nodes to KaTeX or formatted semantic typography.
 */
export function upgradeMathInContainer(container: HTMLElement = document.body): void {
  const inlineElements = container.querySelectorAll<HTMLElement>('.math-tex');
  inlineElements.forEach((el) => {
    // Avoid double-rendering if already transformed
    if (el.dataset.rendered === 'true') return;
    const rawTex = el.getAttribute('data-tex') || el.textContent || '';
    if (!el.getAttribute('data-tex')) {
      el.setAttribute('data-tex', rawTex);
    }
    el.innerHTML = renderFormula(rawTex);
    el.dataset.rendered = 'true';
  });

  const blockElements = container.querySelectorAll<HTMLElement>('.math-block');
  blockElements.forEach((el) => {
    if (el.dataset.rendered === 'true') return;
    const rawTex = el.getAttribute('data-tex') || el.textContent || '';
    if (!el.getAttribute('data-tex')) {
      el.setAttribute('data-tex', rawTex);
    }
    el.innerHTML = renderBlockFormula(rawTex);
    el.dataset.rendered = 'true';
  });
}
