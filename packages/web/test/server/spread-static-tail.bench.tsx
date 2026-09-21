// Tier-1 SSR-lane bench: a spread element with static attributes, under
// `renderToString`. Same fixture and the same three forms as the output
// invariants (test/harness/spread-static-tail.tsx):
//
//   tail  — `<li {...attrs} class="row" data-kind="item">`: statics after
//           the last spread. The compiler bakes them into `ssrElement`'s
//           attribute string and skips their keys on the spread, so the
//           element serializes from ONE source.
//   head  — `<li class="row" data-kind="item" {...attrs}>`: statics the
//           spread may override, kept as a source. The control — the
//           ssrElement array walk with two sources.
//   mixed — `<li {...attrs} class="row" data-id={id}>`: one static baked,
//           one dynamic left in a trailing getter source.
//   dynhead — `<li data-id={id} class="row" {...attrs}>`: a getter source
//           before the spread, which nothing but the hoisted shape can help.
//
// Each element is built once with every prop read once, so the lane isolates
// the per-element cost of the source count: the trailing object literal, its
// key list, and the "does a later source own this key" check on every key of
// the spread. Rows spread three plain attributes and no colliding keys.
//
// Vitest's reported mean is the full `renderToString` cycle.

/**
 * @jsxImportSource @solidjs/web
 */
import { bench } from "vitest";
import { renderToString } from "@solidjs/web";
import { forms, makeRows, List } from "../harness/spread-static-tail.jsx";

const ROWS = 500;
const rows = makeRows(ROWS);

for (const name of Object.keys(forms) as Array<keyof typeof forms>) {
  const render = forms[name];
  bench(`spread-static-tail: ${ROWS} rows (renderToString): ${name}`, () => {
    renderToString(() => <List rows={rows} render={render} />);
  });
}
