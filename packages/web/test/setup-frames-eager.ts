// The hydration and frames specs pin the adoption-time ordering of an
// eager mount (an occurrence claims in the adoption pass). Deferred
// hydration — the frames client's default — moves those mounts to an event,
// a write or the idle pass, so it is off here; the specs that cover it
// (test/consistency/deferred-hydration.spec.tsx) turn it back on.
import { setDeferredHydration } from "../frames/src/client.js";

setDeferredHydration(false);

// The morph (a root over content, live holes) rides the lazy `wire` tier;
// these specs pin the morph's ordering against already-shown content, so the
// tier is resident before they run. The lazy path itself is covered by
// test/consistency/tier-wire-preload.spec.tsx, which installs its own gate.
import { prepareTier } from "../frames/src/frame-client.js";

await prepareTier("wire");
