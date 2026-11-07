import { afterEach, describe, expect, it } from 'vitest';
import { upgradeMathInContainer } from '@/components/math/MathTypography';

/** The smallest stand-in for the DOM that upgradeMathInContainer touches. */
function fakeNode(tex: string) {
  const attributes = new Map<string, string>();
  return {
    dataset: {} as Record<string, string>,
    textContent: tex,
    innerHTML: '',
    getAttribute: (name: string) => attributes.get(name) ?? null,
    setAttribute: (name: string, value: string) => { attributes.set(name, value); },
  };
}

function fakeContainer(inline: ReturnType<typeof fakeNode>[], block: ReturnType<typeof fakeNode>[] = []) {
  return {
    querySelectorAll: (selector: string) => (selector === '.math-tex' ? inline : block),
  } as unknown as HTMLElement;
}

const win = globalThis as unknown as { window?: { katex?: { renderToString: (tex: string) => string } } };

afterEach(() => { delete win.window; });

describe('upgradeMathInContainer', () => {
  it('renders the semantic fallback when KaTeX is not loaded and remembers that it did', () => {
    const node = fakeNode('\\frac{a}{b}');
    upgradeMathInContainer(fakeContainer([node]));
    expect(node.innerHTML).toContain('math-frac');
    expect(node.dataset.rendered).toBe('fallback');
  });

  it('does not redo fallback work on a second pass while KaTeX is still missing', () => {
    const node = fakeNode('x^2');
    const container = fakeContainer([node]);
    upgradeMathInContainer(container);
    node.innerHTML = 'sentinel';
    upgradeMathInContainer(container);
    expect(node.innerHTML).toBe('sentinel');
  });

  it('replaces fallback typography once KaTeX arrives, from the original TeX', () => {
    const node = fakeNode('\\frac{a}{b}');
    const container = fakeContainer([node]);
    upgradeMathInContainer(container);
    expect(node.dataset.rendered).toBe('fallback');

    win.window = { katex: { renderToString: (tex: string) => `<katex>${tex}</katex>` } };
    upgradeMathInContainer(container);
    expect(node.innerHTML).toBe('<katex>\\frac{a}{b}</katex>');
    expect(node.dataset.rendered).toBe('katex');
  });

  it('leaves KaTeX-rendered nodes alone and upgrades block formulas the same way', () => {
    win.window = { katex: { renderToString: (tex: string) => `<katex>${tex}</katex>` } };
    const inline = fakeNode('a');
    const block = fakeNode('b');
    const container = fakeContainer([inline], [block]);
    upgradeMathInContainer(container);
    inline.innerHTML = 'sentinel';
    upgradeMathInContainer(container);
    expect(inline.innerHTML).toBe('sentinel');
    expect(block.dataset.rendered).toBe('katex');
  });
});
