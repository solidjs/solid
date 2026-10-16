// The hydration and frames specs pin the adoption-time ordering of an
// eager mount (an occurrence claims in the adoption pass). Deferred
// hydration — the frames client's default — moves those mounts to an event,
// a write or the idle pass, so it is off here; the specs that cover it
// (test/consistency/deferred-hydration.spec.tsx) turn it back on.
import { setDeferredHydration } from "../frames/src/client.js";

setDeferredHydration(false);
