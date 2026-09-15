// Tier-1 SSR-lane bench: the props plumbing of a headless-UI component chain
// under `renderToString`. Same fixture and the same two forms as the DOM
// lane (test/harness/polymorphic.tsx):
//
//   compiled — the `<a>` written directly. Floor.
//   chain    — `<DialogTrigger as="a" …>` → `ButtonRoot` → `Polymorphic` →
//              `dynamic(() => props.as)` → `ssrElement`: four `merge`s, three
//              `omit`s, and one serializer reading every attribute through
//              all of them.
//
// On the server every element is built exactly once and every prop is read
// exactly once, so this lane isolates the *construction* cost of the chain —
// descriptor copies, proxy traps, memo nodes — with no update phase to
// amortize it. Headless-UI SSR throughput is bounded by this number.
//
// Vitest's reported mean is the full `renderToString` cycle.

/**
 * @jsxImportSource @solidjs/web
 */
import { bench } from "vitest";
import { renderToString } from "@solidjs/web";
import { forms, makeRows, TriggerList } from "../harness/polymorphic.jsx";

const ROWS = 200;

for (const name of Object.keys(forms) as Array<keyof typeof forms>) {
  const render = forms[name];
  bench(`polymorphic-chain: ${ROWS} rows (renderToString): ${name}`, () => {
    const rows = makeRows(0, ROWS);
    renderToString(() => <TriggerList rows={() => rows} render={render} />);
  });
}
