import { render, hydrate } from '@solidjs/web';
import * as web from '@solidjs/web';
import { render as domRender } from 'solid-js/web';

render(() => 1, document.body);
hydrate(() => 2, document.body);
web.render(() => 3, el);
function setup() {
  render(() => 4, el2);
}
const later = () => {
  render(() => 5, el3);
};
if (ready) render(() => 6, el4);
// This plugin version only matches render/hydrate from @solidjs/web;
// solid-js/web render is left alone (frozen behavior).
domRender(() => 7, el5);
