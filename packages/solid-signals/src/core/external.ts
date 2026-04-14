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
 */
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
}

export function _resetExternalSourceConfig(): void {
  externalSourceConfig = null;
}
