export const enum ReactiveFlags {
  None = 0,
  Check = 1 << 0,
  Dirty = 1 << 1,
  RecomputingDeps = 1 << 2,
  InHeap = 1 << 3,
  InHeapHeight = 1 << 4,
  Zombie = 1 << 5
}

export const enum StatusFlags {
  None = 0,
  Pending = 1 << 0,
  Error = 1 << 1,
  Uninitialized = 1 << 2
}

export const enum EffectType {
  Pure = 0,
  Render = 1,
  User = 2
}

export const NOT_PENDING = {};

export const SUPPORTS_PROXY = typeof Proxy === "function";
