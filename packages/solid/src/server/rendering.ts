import type { Accessor } from "@solidjs/signals";
import { mapArray, repeat } from "./signals.js";
import type { JSX } from "../jsx.js";
import type { Component } from "../index.js";

type SharedConfig = {
  context?: HydrationContext;
  getContextId(): string;
  getNextContextId(): string;
};
export const sharedConfig: SharedConfig = {
  context: undefined,
  getContextId() {
    if (!this.context) throw new Error(`getContextId cannot be used under non-hydrating context`);
    return getContextId(this.context.count);
  },
  getNextContextId() {
    if (!this.context)
      throw new Error(`getNextContextId cannot be used under non-hydrating context`);
    return getContextId(this.context.count++);
  }
};

function getContextId(count: number) {
  const num = String(count),
    len = num.length - 1;
  return sharedConfig.context!.id + (len ? String.fromCharCode(96 + len) : "") + num;
}

function setHydrateContext(context?: HydrationContext): void {
  sharedConfig.context = context;
}

function nextHydrateContext(): HydrationContext | undefined {
  return sharedConfig.context
    ? {
        ...sharedConfig.context,
        id: sharedConfig.getNextContextId(),
        count: 0
      }
    : undefined;
}

export function createUniqueId(): string {
  return sharedConfig.getNextContextId();
}

export function createComponent<T>(Comp: (props: T) => JSX.Element, props: T): JSX.Element {
  if (sharedConfig.context && !sharedConfig.context.noHydrate) {
    const c = sharedConfig.context;
    setHydrateContext(nextHydrateContext());
    const r = Comp(props || ({} as T));
    setHydrateContext(c);
    return r;
  }
  return Comp(props || ({} as T));
}

export function For<T>(props: {
  each: T[];
  fallback?: string;
  children: (item: Accessor<T>, index: Accessor<number>) => string;
}) {
  return mapArray(() => props.each, props.children, { fallback: () => props.fallback });
}

// non-keyed
export function Repeat(props: {
  count: number;
  from?: number | undefined;
  fallback?: string;
  children: (index: number) => string;
}) {
  return repeat(
    () => props.count,
    index => props.children(index),
    { fallback: () => props.fallback, from: () => props.from }
  );
}

/**
 * Conditionally render its children or an optional fallback component
 * @description https://docs.solidjs.com/reference/components/show
 */
export function Show<T>(props: {
  when: T | undefined | null | false;
  keyed?: boolean;
  fallback?: string;
  children: string | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => string);
}): string {
  let c: string | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => string);
  return props.when
    ? typeof (c = props.children) === "function"
      ? c(() => props.when as any)
      : c
    : props.fallback || "";
}

export function Switch(props: {
  fallback?: string;
  children: MatchProps<unknown> | MatchProps<unknown>[];
}) {
  let conditions = props.children;
  Array.isArray(conditions) || (conditions = [conditions]);

  for (let i = 0; i < conditions.length; i++) {
    const w = conditions[i].when;
    if (w) {
      const c = conditions[i].children;
      return typeof c === "function" ? c(() => w) : c;
    }
  }
  return props.fallback || "";
}

type MatchProps<T> = {
  when: T | false;
  keyed?: boolean;
  children: string | ((item: NonNullable<T> | Accessor<NonNullable<T>>) => string);
};
export function Match<T>(props: MatchProps<T>) {
  return props;
}

export function ErrorBoundary(props: {
  fallback: string | ((err: any, reset: () => void) => string);
  children: string;
}) {
  // TODO: Implement ErrorBoundary
}

// Suspense Context
type SuspenseContextType = {
  resources: Map<string, { loading: boolean; error: any }>;
  completed: () => void;
};

export function lazy<T extends Component<any>>(
  fn: () => Promise<{ default: T }>
): T & { preload: () => Promise<{ default: T }> } {
  // TODO: Implement lazy
  return {} as any;
}

export function enableHydration() {}

type HydrationContext = {
  id: string;
  count: number;
  serialize: (id: string, v: Promise<any> | any, deferStream?: boolean) => void;
  nextRoot: (v: any) => string;
  replace: (id: string, replacement: () => any) => void;
  block: (p: Promise<any>) => void;
  resources: Record<string, any>;
  suspense: Record<string, SuspenseContextType>;
  registerFragment: (v: string) => (v?: string, err?: any) => boolean;
  lazy: Record<string, Promise<any>>;
  async?: boolean;
  noHydrate: boolean;
};

export function Suspense(props: { fallback?: string; children: string }) {
  // TODO: Implement Suspense
}
