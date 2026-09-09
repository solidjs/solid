declare global {
  /**
   * Checks tier: strict reads, owner-scope writes, invariants, console
   * reporting, dev-only error text. True only in dev builds.
   */
  const __DEV__: boolean;
  /**
   * Wiring tier: attribution hook sites, `_name` labels, graph edge counters,
   * the diagnostics event channel. True in dev AND observe builds — every
   * dev build is an observe build (`__DEV__` implies `__OBSERVE__`; dev.ts
   * asserts it). Gate a site on this when production observability needs
   * it; on `__DEV__` when only a developer at a console does.
   */
  const __OBSERVE__: boolean;
  const __TEST__: boolean;
}

export {};
