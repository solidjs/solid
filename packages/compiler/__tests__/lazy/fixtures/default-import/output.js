import lazy from 'solid-js';
import * as solid from 'solid-js';

// Default and namespace bindings never match: the Babel plugin requires the
// binding path to be an ImportSpecifier (a *named* import).
const E = lazy(() => import('./E'));
const N = solid.lazy(() => import('./N'));
export { E, N };
