import { read, setSignal, signal } from "./core.js";
import { cleanup } from "./owner.js";
import { GlobalQueue } from "./scheduler.js";
import type { Computed } from "./types.js";

export type ExternalSourceFactory = (fn: (prev: any) => any, trigger: () => void) => ExternalSource;

export interface ExternalSource {
  track: (prev: any) => any;
  dispose: () => void;
}

export interface ExternalSourceConfig {
  factory: ExternalSourceFactory;
  untrack?: <T>(fn: () => T) => T;
}

export let externalSourceConfig: {
  factory: ExternalSourceFactory;
  untrack: <T>(fn: () => T) => T;
} | null = null;

/**
 * Registers a factory that bridges external reactive systems (e.g. MobX, Vue refs)
 * into Solid's tracking graph. Every computation will be wrapped so that the
 * external library can track its own dependencies alongside Solid's.
 *
 * Multiple calls pipe together: each new factory wraps the previous one.
 *
 * @param config.factory receives `(fn, trigger)` — wrap fn execution in external tracking,
 *   call trigger when external deps change. Return `{ track, dispose }`.
 * @param config.untrack optional wrapper for `untrack` — disables external tracking too.
 *
 * @example
 * ```ts
 * // Bridge an external "subscribe / notify" library into Solid's graph.
 * // `factory` wraps every Solid compute so the external library can attach
 * // its own dependency tracker; `trigger` re-runs the compute on external
 * // change. `untrack` mirrors Solid's `untrack()` into the external library
 * // so that reads inside `untrack(...)` don't get tracked twice.
 * enableExternalSource({
 *   factory: (compute, trigger) => {
 *     const sub = externalLib.subscribe(trigger);
 *     return {
 *       track: prev => externalLib.run(() => compute(prev)),
 *       dispose: () => sub.unsubscribe()
 *     };
 *   },
 *   untrack: fn => externalLib.untracked(fn)
 * });
 * ```
 */
// Wires a freshly created computed through the active external-source bridge.
// Lives here (installed on GlobalQueue while a config is active) rather than
// inline in core: esbuild cannot literal-track the mutable config binding the
// way rollup does, so an inline `if (externalSourceConfig)` block ships in
// every bundle even though only enableExternalSource() can make it reachable.
function wireExternalSource(self: Computed<any>): void {
  const bridgeSignal = signal<undefined>(undefined, { equals: false, ownedWrite: true });
  const source = externalSourceConfig!.factory(self._fn as any, () => {
    setSignal(bridgeSignal, undefined);
  });
  cleanup(() => source.dispose());
  self._fn = ((prev: any) => {
    read(bridgeSignal);
    return source.track(prev);
  }) as any;
}

function externalUntrack<T>(fn: () => T): T {
  return externalSourceConfig!.untrack(fn);
}

// The hooks mirror the config's liveness exactly (installed on enable,
// removed on reset) so core's null checks stay equivalent to the old
// `externalSourceConfig` truthiness checks.
function syncExternalHooks(): void {
  GlobalQueue._wireExternalSource = externalSourceConfig ? wireExternalSource : null;
  GlobalQueue._externalUntrack = externalSourceConfig ? externalUntrack : null;
}

export function enableExternalSource(config: ExternalSourceConfig): void {
  const { factory, untrack: untrackFn = fn => fn() } = config;
  if (externalSourceConfig) {
    const { factory: oldFactory, untrack: oldUntrack } = externalSourceConfig;
    externalSourceConfig = {
      factory: (fn, trigger) => {
        const oldSource = oldFactory(fn, trigger);
        const source = factory(x => oldSource.track(x), trigger);
        return {
          track: x => source.track(x),
          dispose() {
            source.dispose();
            oldSource.dispose();
          }
        };
      },
      untrack: fn => oldUntrack(() => untrackFn(fn))
    };
  } else {
    externalSourceConfig = { factory, untrack: untrackFn };
  }
  syncExternalHooks();
}

export function _resetExternalSourceConfig(): void {
  externalSourceConfig = null;
  syncExternalHooks();
}
