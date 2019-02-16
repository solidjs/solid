export { createState, unwrap } from './state';
export { reconcile } from './reconcile';
export * from './signals';

import S from 's-js';
export const { root: createRoot, cleanup: onCleanup, sample, freeze } = S;
