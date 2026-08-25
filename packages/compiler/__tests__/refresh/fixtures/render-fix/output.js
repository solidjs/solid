import { render, hydrate } from "@solidjs/web";
import * as web from "@solidjs/web";
import { render as domRender } from "solid-js/web";
const _cleanup = render(() => 1, document.body);
if (import.meta.hot) import.meta.hot.dispose(_cleanup);
const _cleanup2 = hydrate(() => 2, document.body);
if (import.meta.hot) import.meta.hot.dispose(_cleanup2);
const _cleanup3 = web.render(() => 3, el);
if (import.meta.hot) import.meta.hot.dispose(_cleanup3);
function setup() {
	const _cleanup4 = render(() => 4, el2);
	if (import.meta.hot) import.meta.hot.dispose(_cleanup4);
}
const later = () => {
	render(() => 5, el3);
};
if (ready) {
	const _cleanup5 = render(() => 6, el4);
	if (import.meta.hot) import.meta.hot.dispose(_cleanup5);
}
// This plugin version only matches render/hydrate from @solidjs/web;
// solid-js/web render is left alone (frozen behavior).
domRender(() => 7, el5);
