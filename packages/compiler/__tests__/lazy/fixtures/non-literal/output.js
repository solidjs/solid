import { lazy } from 'solid-js';

// None of these match extractDynamicImportSpecifier:
const H = lazy(() => import(path)); // non-literal specifier
const I = lazy(() => import(`./I`)); // template literal, even without substitutions
const J = lazy(() => import('./J', { with: { type: 'json' } })); // import options
const K = lazy(() => somethingElse('./K')); // not a dynamic import
const L = lazy(async () => await import('./L')); // await wraps the call
// Argument-count bails:
const M = lazy();
const N = lazy(() => import('./N'), void 0, 'resolved');
export { H, I, J, K, L, M, N };
