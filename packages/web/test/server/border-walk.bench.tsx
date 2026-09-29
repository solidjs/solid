// Tier-1 SSR-lane bench: the serialization-border walk (`toBorderForm`,
// frames/src/tree-rewrite.ts) — what every document-face memo value and
// every slot-arg record passes through before it meets the serializer, with
// the production hooks installed (`@solidjs/web`'s server entry installs the
// projection trace resolver and the async-iterable sharer). Three payloads:
//
//   acyclic — 1000 plain rows under a meta object, nothing to rewrite: the
//             copy-on-write pass returns the value itself. The common case
//             and the one the walk must keep free of per-node bookkeeping.
//   shared  — the same rows, one async generator among them: one seat is
//             taken and the path to it copied; the rest passes by reference.
//   cyclic  — the same rows with a back-reference to the root: the pass
//             aborts at the depth budget and the tree is cloned once with the
//             replacements reused.
//
// The walk is measured alone (no render): a payload's shape, not a page's.

/**
 * @jsxImportSource @solidjs/web
 */
import { bench } from "vitest";
import "@solidjs/web";
import { toBorderForm } from "../../frames/src/frame-container-plugin.js";

const ROWS = 1000;
const rows = () =>
  Array.from({ length: ROWS }, (_, i) => ({
    id: i,
    title: `Row ${i}`,
    completed: i % 2 === 0,
    tags: ["a", "b"]
  }));

const acyclic = { rows: rows(), meta: { total: ROWS, page: 1 } };

async function* progress() {
  yield 1;
}
// A fresh generator per iteration (one allocation against a 1000-row walk):
// sharing the same source again would stack seats on one multicast.
const shared: any = { rows: rows(), meta: { total: ROWS, page: 1, progress: null } };

const cyclic: any = { rows: rows(), meta: { total: ROWS, page: 1 } };
cyclic.meta.root = cyclic;

bench(`border-walk: ${ROWS} rows, acyclic (toBorderForm)`, () => {
  toBorderForm(acyclic, false);
});

bench(`border-walk: ${ROWS} rows, one shared generator (toBorderForm)`, () => {
  shared.meta.progress = progress();
  toBorderForm(shared, false);
});

bench(`border-walk: ${ROWS} rows, cyclic (toBorderForm)`, () => {
  toBorderForm(cyclic, false);
});
