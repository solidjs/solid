// `OBSERVE.server` — the objects behind the server runtime's observe surface.
//
// The core declares `ServerObserve` empty and ships `server: {}`; `@solidjs/web`'s
// server entries type the members (the server-function invocation channel,
// the trace-provider slot) and emit into them. The OBJECTS are created HERE,
// once per PROCESS, under registered symbols on `globalThis` — not by the core
// (one artifact per tier for both platforms; the client would pay for them)
// and not by web (see below). Two things fixed the placement (Sentry spike,
// SHAPE-NOTES J.23/J.24):
//
// - Order. Web's server entry is what emits invocations and asks the trace
//   provider, but an observer's `init()` runs before any request and imports
//   only `solid-js`; while web's module init created the slots,
//   `OBSERVE.server.trace` was `undefined` until something happened to import
//   web first (J.23). This module is part of `solid-js`'s server entry, so the
//   slots exist the moment `solid-js` is importable on the server.
// - Copies. A host that bundles the runtime into its server build (`link:`ed
//   packages, `noExternal`, workers) and instruments through a `--import`ed
//   module holds two `solid-js` instances; a per-instance `OBSERVE.server`
//   made the provider installed on one invisible to the render running on the
//   other (J.24). The registered key makes every copy find the same listener
//   set and provider, the way the web runtime's own bundles already share
//   state.
//
// The containers are deliberately generic — a listener set keyed by record
// type and a single replaceable provider — and carry no knowledge of the
// records; web reads them through the same registered symbols (the two key
// strings below are that contract — it re-creates them with `Symbol.for`, it
// does not import from here) and the types come from its augmentation.
import type { ServerObserve } from "@solidjs/signals";

const SERVER_SLOTS = Symbol.for("solid-js/observe/server");
const SERVER_LISTENERS = Symbol.for("solid-js/observe/server/listeners");
const SERVER_PROVIDER = Symbol.for("solid-js/observe/server/provider");

/** The process-wide slots, created on first call from any copy of `solid-js`. */
export function serverSlots(): ServerObserve {
  const g = globalThis as { [SERVER_SLOTS]?: ServerObserve };
  if (g[SERVER_SLOTS]) return g[SERVER_SLOTS];
  const listeners = new Map<string, Set<Function>>();
  const trace: { [SERVER_PROVIDER]?: Function; provide(p: Function): () => void } = {
    provide(provider) {
      trace[SERVER_PROVIDER] = provider;
      return () => {
        if (trace[SERVER_PROVIDER] === provider) trace[SERVER_PROVIDER] = undefined;
      };
    }
  };
  return (g[SERVER_SLOTS] = {
    invocations: {
      [SERVER_LISTENERS]: listeners,
      subscribe(type: string, listener: Function) {
        let set = listeners.get(type);
        if (!set) listeners.set(type, (set = new Set()));
        set.add(listener);
        return () => {
          set!.delete(listener);
        };
      }
    },
    trace
  } as unknown as ServerObserve);
}
