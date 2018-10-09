export { default as State } from './State';
export { default as ImmutableState } from './ImmutableState';

export { unwrap } from './utils'
export * from './operators';

import S from 's-js';
export const root = S.root;
export const cleanup = S.cleanup;
