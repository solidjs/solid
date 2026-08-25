import { lazy } from 'solid-js';

function scope() {
  // Local shadowing wins: this `lazy` is not the import.
  const lazy = fn => fn;
  return lazy(() => import('./Shadowed'));
}

const D = lazy(() => import('./D'));
export { scope, D };
