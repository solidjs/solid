import { clientOnly } from '@solidjs/start';
import { clientOnly as webClientOnly } from '@solidjs/web';

// Wrong source: only named imports from `@solidjs/web` match.
const A = clientOnly(() => import('./A'));

// Aliased local: the callee must be spelled `clientOnly`.
const B = webClientOnly(() => import('./B'));

export default [A, B];
