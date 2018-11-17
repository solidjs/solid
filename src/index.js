export { default as State } from './State';

export { unwrap } from './utils'
export * from './operators';

import S from 's-js';
export const { root, cleanup, sample, data, effect } = S;
