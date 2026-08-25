/* @refresh reload */
import { render } from "@solidjs/web";
export const App = () => <div />;
const _cleanup = render(() => <App />, root);
if (import.meta.hot) import.meta.hot.dispose(_cleanup);
if (import.meta.hot) {
	import.meta.hot.accept(() => import.meta.hot.invalidate());
}
