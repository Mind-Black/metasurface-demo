import './style.css';
import { DualViewport } from '@/components/viewer/DualViewport';
import { upgradeMathInContainer } from '@/components/math/MathTypography';

document.addEventListener('DOMContentLoaded', () => {
  const viewportRoot = document.getElementById('dual-viewport-root');
  if (!viewportRoot) return;

  new DualViewport(viewportRoot);
  upgradeMathInContainer(viewportRoot);
  window.addEventListener('load', () => upgradeMathInContainer(viewportRoot));
});
