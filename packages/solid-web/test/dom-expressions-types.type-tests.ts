// Tripwire: when `dom-expressions/src/client.d.ts` upstream is updated to
// re-export `VoidElements` and `RawTextElements` (the runtime already
// re-exports them as of 0.50.0-next.3, but the hand-maintained `.d.ts` is
// missing those entries), these `@ts-expect-error` lines stop erroring,
// `tsc` fails, and we know to clean up the workaround:
//
//   1. Drop the explicit `export { VoidElements, RawTextElements } from
//      "dom-expressions/src/constants.js"` in `packages/solid-web/src/client.ts`.
//   2. Restore `ncp .../client.d.ts ./types/client.d.ts` in the
//      `types:copy-web` script in `packages/solid-web/package.json` so we
//      copy upstream types verbatim again.
//   3. Delete this file.

// @ts-expect-error - upstream `client.d.ts` is missing `VoidElements`.
import { VoidElements as _V } from "dom-expressions/src/client.js";
// @ts-expect-error - upstream `client.d.ts` is missing `RawTextElements`.
import { RawTextElements as _R } from "dom-expressions/src/client.js";

void _V;
void _R;

export {};
