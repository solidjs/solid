export { createState, unwrap } from './state';
export { reconcile } from './reconcile';
export * from './signals';
export * from './afterRender';

import S from 's-js';
export const { root: createRoot, cleanup: onCleanup, sample, freeze } = S;
