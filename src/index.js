export * from './signals';
export * from './operators';
export { unwrap } from './utils'

import S from 's-js';
export const { root, cleanup: useCleanup, sample, freeze } = S;
