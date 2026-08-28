// FLIP PREVIEW, list tier: a patch-mode LIST row (`rowProof`) arms the
// insert seam and retains the list driver (row binding, LIS moves, row-ops
// consumer) on top of csr-app-patch.js's dual-driver floor. This is the
// full flip cost — paid exactly by apps with driver-eligible store lists,
// the ones the channel's dbmon-class wins accrue to.
import { patchDriver, rowProof } from "@solidjs/web";
import "./csr-app.js";

const subject = { x: 1, rows: [] };
patchDriver(subject, (next, prev, force) => {
  if (force || next.x !== prev.x) document.title = String(next.x);
});
export const row = rowProof(r => String(r));
