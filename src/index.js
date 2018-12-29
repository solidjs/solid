export * from './signals';
export { unwrap, observable } from './utils'

import S from 's-js';
export const { root, cleanup: useCleanup, sample, freeze } = S;
