/**
 * `solid-js/refresh` — the development-only HMR runtime for Solid components.
 *
 * Compiled component wrappers (emitted by the `solid-refresh` Babel plugin and
 * by the native compiler pass that shares the same ABI) import this module and
 * call into it to hot-swap components without losing surrounding reactive
 * state. The export surface consumed by that compiled output is FROZEN:
 *
 * - `$$registry()` — creates a per-module registry.
 * - `$$component(registry, id, component, options?)` — registers a component
 *   and returns the hot-swappable proxy that the module exports/renders.
 * - `$$refresh(type, hot, registry)` — wires the registry into the bundler's
 *   hot API (`import.meta.hot` et al.) at the end of the module body.
 * - `$$decline(type, hot, inline?)` — declines/invalidates modules that can't
 *   be hot-patched (the `@refresh reload` pragma and similar escape hatches).
 *
 * The `hot.data` protocol is likewise frozen: the first evaluation of a module
 * stores its registry under `hot.data["solid-refresh"]`, and every evaluation
 * stores its own registry under `hot.data["solid-refresh-prev"]`; the accept
 * callback patches the former from the latter. `"vite"` is the fully supported
 * bundler mode; the others are carried over from `solid-refresh` verbatim.
 *
 * In production builds every entry point degrades to an inert stub:
 * `$$component` returns the component unwrapped and `$$refresh`/`$$decline`
 * warn once and do nothing.
 */
import { $DEVCOMP, createMemo, createSignal, getOwner, onCleanup, untrack, DEV } from "solid-js";
import { IS_DEV } from "../client/core.js";
import type { Element as SolidElement } from "../types.js";

export interface BaseComponent<P> {
  (props: P): SolidElement;
}

function setComponentProperty(component: object, key: string, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(component, key);
  if (descriptor) {
    Object.defineProperty(component, key, { ...descriptor, value });
  } else {
    Object.defineProperty(component, key, {
      value,
      writable: false,
      enumerable: false,
      configurable: true
    });
  }
}

/** Mutable live-mount counter shared between a proxy and its registration. */
interface LiveInstances {
  count: number;
}

/**
 * Wraps the current registration of a component in a stable proxy identity.
 * Renders subscribe to `source` through a transparent memo, so swapping the
 * underlying component re-renders in place while sibling state (and the dev
 * owner-id scheme, thanks to `transparent`) is preserved.
 *
 * Every render through the proxy is counted in `instances` for as long as
 * its owner lives, so `patchComponent` can tell whether a registration still
 * has mounted instances or whether everything rendered through it was torn
 * down (e.g. by the `render()` disposer that the transform registers via
 * `hot.dispose`).
 */
function createProxy<P extends Record<string, any>>(
  source: () => BaseComponent<P>,
  name: string,
  instances: LiveInstances,
  location?: string
): (props: P) => SolidElement {
  const refreshName = `[solid-refresh]${name}`;
  function HMRComp(props: P): SolidElement {
    if (getOwner()) {
      instances.count++;
      onCleanup(() => {
        instances.count--;
      });
    }
    const s = untrack(source);
    if (!s || $DEVCOMP in s) {
      return createMemo(
        () => {
          const c = source();
          if (c) {
            return untrack(() => c(props), (c as any)[$DEVCOMP] && `<${name}>`);
          }
          return undefined;
        },
        { name: refreshName, transparent: true }
      ) as unknown as SolidElement;
    }
    // No $DEVCOMP brand means the source never went through devComponent, so
    // this is a plain function call (e.g. a context provider called directly),
    // not a tracked component render.
    return s(props);
  }
  setComponentProperty(HMRComp, "name", refreshName);
  if (location) {
    setComponentProperty(HMRComp, "location", location);
  }
  return new Proxy(HMRComp, {
    get(_, property) {
      if (property === "location" || property === "name") {
        return (HMRComp as any)[property];
      }
      return (untrack(source) as any)[property];
    },
    set(_, property, value) {
      (untrack(source) as any)[property] = value;
      return true;
    }
  });
}

function isListUpdatedInternal(a: Record<string, any>, b: Record<string, any>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) {
    return true;
  }
  const keys = new Set([...aKeys, ...bKeys]);
  // If the merged key set grew, the two objects have differing keys.
  if (keys.size !== aKeys.length) {
    return true;
  }
  for (const key of keys) {
    // The second clause covers NaN without Object.is (-0 is not worth it here)
    if (a[key] !== b[key] || (a[key] !== a[key] && b[key] !== b[key])) {
      return true;
    }
  }
  return false;
}

function isListUpdated(
  a: Record<string, any> | undefined,
  b: Record<string, any> | undefined
): boolean {
  if (a && b) {
    return isListUpdatedInternal(a, b);
  }
  return (a == null) !== (b == null);
}

interface ComponentOptions {
  location?: string;
  signature?: string;
  dependencies?: () => Record<string, any>;
}

export interface ComponentRegistrationData<P> extends ComponentOptions {
  id: string;
  component: (props: P) => SolidElement;
  proxy: (props: P) => SolidElement;
  update: (action: () => (props: P) => SolidElement) => void;
  /** Live renders through this registration's proxy (owner not yet disposed). */
  instances: LiveInstances;
}

export interface Registry {
  components: Map<string, ComponentRegistrationData<any>>;
}

export function $$registry(): Registry {
  return {
    components: new Map()
  };
}

export function $$component<P extends Record<string, any>>(
  registry: Registry,
  id: string,
  component: (props: P) => SolidElement,
  options: ComponentOptions = {}
): (props: P) => SolidElement {
  if (!IS_DEV) return component;
  let current = component;
  // Keep the component inside a plain signal so module-level registration is
  // never treated as a hydration-aware computation.
  const [comp, setComp] = createSignal({ current });
  const update = (action: () => (props: P) => SolidElement): void => {
    current = action();
    setComp({ current });
  };
  const instances: LiveInstances = { count: 0 };
  const proxy = createProxy(() => comp().current, id, instances, options.location);
  registry.components.set(id, {
    id,
    component,
    proxy,
    update,
    instances,
    ...options
  });
  return proxy;
}

function patchComponent<P>(
  oldData: ComponentRegistrationData<P>,
  newData: ComponentRegistrationData<P>
): void {
  if (oldData.instances.count === 0) {
    // Nothing rendered through the old registration is alive. This is the
    // entry-module shape of solid-refresh#85: the transform registers the
    // `render()` disposer via `hot.dispose`, so by the time this accept
    // callback runs, the previous tree is gone and the re-execution has
    // already rendered a fresh tree through the NEW registration. The
    // signature/dependency short-circuit below exists to protect mounted
    // state — with no live instances it must not apply, because leaving the
    // old component in place resurrects the previous execution's module
    // scope (dead createContext instances, prior sibling imports) when the
    // redirect below routes the live render through the canonical proxy.
    // Swap unconditionally to the fresh component and skip the context
    // symbol carry-over: everything alive was rendered against the new
    // context's own symbol.
    oldData.dependencies = newData.dependencies;
    oldData.signature = newData.signature;
    oldData.update(() => newData.component);
  } else {
    // Preserve context identity: contexts (createContext) are components in
    // Solid 2.0, but useContext looks values up by the context's stable
    // symbol `.id` — carry the old symbol onto the re-evaluated context so
    // consumers of the still-mounted provider keep resolving.
    const oldComp = oldData.component as any;
    const newComp = newData.component as any;
    if (oldComp.id != null && typeof oldComp.id === "symbol") {
      newComp.id = oldComp.id;
    }
    if (newData.signature) {
      const oldDeps = oldData.dependencies?.call(oldData);
      const newDeps = newData.dependencies?.call(newData);
      if (newData.signature !== oldData.signature || isListUpdated(newDeps, oldDeps)) {
        // Signature or captured bindings changed: swap in the new component
        // (remounts that component subtree; unrelated state is preserved).
        oldData.dependencies = newDeps ? () => newDeps : undefined;
        oldData.signature = newData.signature;
        oldData.update(() => newData.component);
      }
    } else {
      // No granular signature info — always remount.
      oldData.update(() => newData.component);
    }
  }
  // Always point the new registration at the first proxy, so modules newly
  // importing the re-evaluated module still render through the proxy that is
  // already mounted everywhere else.
  newData.update(() => oldData.proxy);
}

function patchComponents(oldData: Registry, newData: Registry): boolean {
  const components = new Set([...oldData.components.keys(), ...newData.components.keys()]);
  for (const key of components) {
    const oldComponent = oldData.components.get(key);
    const newComponent = newData.components.get(key);
    if (oldComponent) {
      if (newComponent) {
        patchComponent(oldComponent, newComponent);
      } else {
        // A component disappeared from the module; we can't patch.
        return true;
      }
    } else if (newComponent) {
      oldData.components.set(key, newComponent);
    }
  }
  return false;
}

function patchRegistry(oldRegistry: Registry, newRegistry: Registry): boolean {
  return patchComponents(oldRegistry, newRegistry);
}

const SOLID_REFRESH = "solid-refresh";
const SOLID_REFRESH_PREV = "solid-refresh-prev";

type HotData = {
  [key in typeof SOLID_REFRESH | typeof SOLID_REFRESH_PREV]: Registry;
};

export type ESMRuntimeType = "esm" | "vite";
export type StandardRuntimeType = "standard" | "webpack5" | "rspack-esm";
export type RuntimeType = ESMRuntimeType | StandardRuntimeType;

interface ESMHot {
  data: HotData;
  accept: (cb: (module?: unknown) => void) => void;
  invalidate: () => void;
  decline: () => void;
}

interface StandardHot {
  data: HotData;
  accept: (cb?: () => void) => void;
  dispose: (cb: (data: HotData) => void) => void;
  invalidate?: () => void;
  decline?: () => void;
}

export interface RefreshConfig {
  /**
   * Called when the runtime bails out of hot-swapping (the module must be
   * fully re-executed, e.g. an exported component vanished and the bundler
   * lacks an invalidate/decline API). Overrides the default bail behavior:
   * `hot.invalidate()` when available → `window.location.reload()` in DOM
   * environments → one-time console warning otherwise.
   */
  invalidate?: (hot?: { invalidate?: () => void }) => void;
}

const refreshConfig: RefreshConfig = {};

/**
 * Configures runtime behavior that is not part of the frozen compiled-wrapper
 * ABI. Intended to be called once by bundler integrations (vite-plugin-solid)
 * before any hot update fires.
 */
export function configureRefresh(config: RefreshConfig): void {
  Object.assign(refreshConfig, config);
}

let warnedNoInvalidate = false;

/**
 * The "cannot hot-swap, bail" path. Replaces the hardcoded
 * `window.location.reload()` calls the standalone runtime shipped with.
 */
function bailInvalidate(hot?: { invalidate?: () => void }): void {
  if (refreshConfig.invalidate) {
    refreshConfig.invalidate(hot);
    return;
  }
  if (hot && typeof hot.invalidate === "function") {
    hot.invalidate();
    return;
  }
  if (typeof window !== "undefined" && typeof window.location?.reload === "function") {
    window.location.reload();
    return;
  }
  if (!warnedNoInvalidate) {
    console.warn(
      "[solid-js/refresh] A module needs to be invalidated, but no hot invalidation " +
        "mechanism is available in this environment. Configure one via " +
        "configureRefresh({ invalidate }) or reload manually to see the latest code."
    );
    warnedNoInvalidate = true;
  }
}

type ESMDecline = [type: ESMRuntimeType, hot: ESMHot, inline?: boolean];
type StandardDecline = [type: StandardRuntimeType, hot: StandardHot, inline?: boolean];
type Decline = ESMDecline | StandardDecline;

export function $$decline(...[type, hot, inline]: Decline): void {
  if (!IS_DEV) {
    warnProductionUse();
    return;
  }
  switch (type) {
    case "esm": {
      // Snowpack-style ESM treats invalidate as a full reload; prefer decline.
      if (inline) {
        hot.invalidate();
      } else {
        hot.decline();
      }
      break;
    }
    case "vite": {
      // Vite ignores decline; accept-then-invalidate is the supported dance.
      if (inline) {
        hot.invalidate();
      } else {
        hot.accept(() => {
          hot.invalidate();
        });
      }
      break;
    }
    case "rspack-esm":
    case "webpack5": {
      if (inline) {
        hot.invalidate!();
      } else {
        hot.decline!();
      }
      break;
    }
    case "standard": {
      // Some module.hot implementations lack decline/invalidate entirely —
      // route through the configurable bail path.
      if (inline) {
        bailInvalidate(hot);
      } else if (hot.decline) {
        hot.decline();
      } else {
        hot.accept(() => {
          bailInvalidate(hot);
        });
      }
      break;
    }
  }
}

let warnedProduction = false;
function warnProductionUse(): void {
  if (warnedProduction) return;
  console.warn(
    "[solid-js/refresh] This module is development-only. Compiled HMR wrappers " +
      "should not be part of a production build; the refresh runtime is inert here."
  );
  warnedProduction = true;
}

let warnedNoDev = false;
function shouldWarnAndDecline(): boolean {
  // DEV is undefined when the resolved solid-js build is the production one —
  // i.e. the "development" export condition matched for solid-js/refresh but
  // not for solid-js itself.
  if (DEV) {
    return false;
  }
  if (!warnedNoDev) {
    console.warn(
      "[solid-js/refresh] The production build of solid-js was loaded alongside the " +
        "development refresh runtime. Make sure your build system enables the " +
        "'development' export condition consistently."
    );
    warnedNoDev = true;
  }
  return true;
}

function $$refreshESM(type: ESMRuntimeType, hot: ESMHot, registry: Registry): void {
  if (shouldWarnAndDecline()) {
    $$decline(type, hot);
  } else if (hot.data) {
    hot.data[SOLID_REFRESH] = hot.data[SOLID_REFRESH] || registry;
    hot.data[SOLID_REFRESH_PREV] = registry;
    hot.accept(mod => {
      if (mod == null || patchRegistry(hot.data[SOLID_REFRESH], hot.data[SOLID_REFRESH_PREV])) {
        hot.invalidate();
      }
    });
  } else {
    // No hot.data — nothing to persist registries on, so just decline.
    $$decline(type, hot);
  }
}

function $$refreshStandard(type: StandardRuntimeType, hot: StandardHot, registry: Registry): void {
  if (shouldWarnAndDecline()) {
    $$decline(type, hot);
  } else {
    const current = hot.data;
    if (current && current[SOLID_REFRESH]) {
      if (patchRegistry(current[SOLID_REFRESH], registry)) {
        $$decline(type, hot, true);
      }
    }
    hot.dispose((data: HotData) => {
      data[SOLID_REFRESH] = current ? current[SOLID_REFRESH] : registry;
    });
    hot.accept();
  }
}

type ESMRefresh = [type: ESMRuntimeType, hot: ESMHot, registry: Registry];
type StandardRefresh = [type: StandardRuntimeType, hot: StandardHot, registry: Registry];
type Refresh = ESMRefresh | StandardRefresh;

export function $$refresh(...[type, hot, registry]: Refresh): void {
  if (!IS_DEV) {
    warnProductionUse();
    return;
  }
  switch (type) {
    case "esm":
    case "vite": {
      $$refreshESM(type, hot as ESMHot, registry);
      break;
    }
    case "standard":
    case "webpack5":
    case "rspack-esm": {
      $$refreshStandard(type, hot as StandardHot, registry);
      break;
    }
  }
}
