// FLIP PREVIEW: the CSR app surface as the compiler's patch-mode DEFAULT
// would emit it. Nearly every real app has at least one eligible template
// (a pure `props.x`/`state.x` binding), so default-on retains `patchDriver`
// plus the store channel's registration machinery in ~every bundle; only
// templates compiled as patch-mode LIST rows (`rowProof`) additionally pull
// the list driver — see csr-app-patch-lists.js for that tier.
import { patchDriver } from "@solidjs/web";
import "./csr-app.js";

const subject = { x: 1 };
patchDriver(subject, (next, prev, force) => {
  if (force || next.x !== prev.x) document.title = String(next.x);
});
