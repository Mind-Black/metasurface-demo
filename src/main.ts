import './style.css';
import { DualViewport } from '@/components/viewer/DualViewport';
import { loadKatex, upgradeMathInContainer } from '@/components/math/MathTypography';
import { fieldClient } from '@/lib/optics/fieldClient';

// Start the worker now so its script and tables load while the page builds.
fieldClient.warm();

document.addEventListener('DOMContentLoaded', () => {
  const viewportRoot = document.getElementById('dual-viewport-root');
  if (!viewportRoot) return;

  new DualViewport(viewportRoot);
  // Fallback typography first; swapped for KaTeX once the CDN has delivered both its files.
  upgradeMathInContainer(viewportRoot);
  // Started after load: resources injected earlier would hold the load event open on a slow CDN.
  const startKatex = () => void loadKatex().then((ready) => {
    if (ready) upgradeMathInContainer(viewportRoot);
  });
  if (document.readyState === 'complete') startKatex();
  else window.addEventListener('load', startKatex, { once: true });
});
