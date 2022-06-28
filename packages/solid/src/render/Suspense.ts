import { createComponent } from "./component";
import {
  createRoot,
  createSignal,
  untrack,
  createComputed,
  createContext,
  useContext,
  getSuspenseContext,
  resumeEffects,
  createMemo,
  Accessor,
  onCleanup,
  getOwner
} from "../reactive/signal";
import { HydrationContext, setHydrateContext, sharedConfig } from "./hydration";
import type { JSX } from "../jsx";

type SuspenseListRegistryItem = {
  inFallback: Accessor<boolean>;
  showContent: (v: boolean) => void;
  showFallback: (v: boolean) => void;
};

type SuspenseListContextType = {
  register: (inFallback: Accessor<boolean>) => [Accessor<boolean>, Accessor<boolean>];
};
const SuspenseListContext = createContext<SuspenseListContextType>();

/**
 * **[experimental]** controls the order in which suspended content is rendered
 *
 * @description https://www.solidjs.com/docs/latest/api#%3Csuspenselist%3E-(experimental)
 */
export function SuspenseList(props: {
  children: JSX.Element;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  let suspenseSetter: (s: boolean) => void,
    showContent: Accessor<boolean>,
    showFallback: Accessor<boolean>;

  // Nested SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) {
    const [inFallback, setFallback] = createSignal(false);
    suspenseSetter = setFallback;
    [showContent, showFallback] = listContext.register(inFallback);
  }

  const [registry, setRegistry] = createSignal<SuspenseListRegistryItem[]>([]),
    comp = createComponent(SuspenseListContext.Provider, {
      value: {
        register: (inFallback: Accessor<boolean>) => {
          const [showingContent, showContent] = createSignal(false),
            [showingFallback, showFallback] = createSignal(false);
          setRegistry(registry => [...registry, { inFallback, showContent, showFallback }]);
          return [showingContent, showingFallback];
        }
      },
      get children() {
        return props.children;
      }
    });

  createComputed(() => {
    const reveal = props.revealOrder,
      tail = props.tail,
      visibleContent = showContent ? showContent() : true,
      visibleFallback = showFallback ? showFallback() : true,
      reg = registry(),
      reverse = reveal === "backwards";

    if (reveal === "together") {
      const all = reg.every(i => !i.inFallback());
      suspenseSetter && suspenseSetter(!all);
      reg.forEach(i => {
        i.showContent(all && visibleContent);
        i.showFallback(visibleFallback);
      });
      return;
    }

    let stop = false;
    for (let i = 0, len = reg.length; i < len; i++) {
      const n = reverse ? len - i - 1 : i,
        s = reg[n].inFallback();
      if (!stop && !s) {
        reg[n].showContent(visibleContent);
        reg[n].showFallback(visibleFallback);
      } else {
        const next = !stop;
        if (next && suspenseSetter) suspenseSetter(true);
        if (!tail || (next && tail === "collapsed")) {
          reg[n].showFallback(visibleFallback);
        } else reg[n].showFallback(false);
        stop = true;
        reg[n].showContent(next);
      }
    }
    if (!stop && suspenseSetter) suspenseSetter(false);
  });

  return comp;
}

/**
 * tracks all resources inside a component and renders a fallback until they are all resolved
 * ```typescript
 * const AsyncComponent = lazy(() => import('./component'));
 *
 * <Suspense fallback={<LoadingIndicator />}>
 *   <AsyncComponent />
 * </Suspense>
 * ```
 * @description https://www.solidjs.com/docs/latest/api#%3Csuspense%3E
 */
export function Suspense(props: { fallback?: JSX.Element; children: JSX.Element }) {
  let counter = 0,
    showContent: Accessor<boolean>,
    showFallback: Accessor<boolean>,
    ctx: HydrationContext | undefined,
    p: Promise<any> | undefined,
    flicker: Accessor<void> | undefined,
    error: any;
  const [inFallback, setFallback] = createSignal<boolean>(false),
    SuspenseContext = getSuspenseContext(),
    store = {
      increment: () => {
        if (++counter === 1) setFallback(true);
      },
      decrement: () => {
        if (--counter === 0) setFallback(false);
      },
      inFallback,
      effects: [],
      resolved: false
    },
    owner = getOwner();
  if (sharedConfig.context && sharedConfig.load) {
    const key = sharedConfig.context.id + sharedConfig.context.count;
    p = sharedConfig.load(key);
    if (p) {
      if (typeof p !== "object" || !("then" in p)) p = Promise.resolve(p);
      const [s, set] = createSignal(undefined, { equals: false });
      flicker = s;
      p.then(err => {
        if ((error = err) || sharedConfig.done) return set();
        sharedConfig.gather!(key);
        setHydrateContext(ctx);
        set();
        setHydrateContext();
      });
    }
  }

  // SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) [showContent, showFallback] = listContext.register(store.inFallback);
  let dispose: () => void;
  onCleanup(() => dispose && dispose());

  return createComponent(SuspenseContext.Provider, {
    value: store,
    get children() {
      return createMemo(() => {
        if (error) throw error;
        ctx = sharedConfig.context!;
        if (flicker) {
          flicker();
          return (flicker = undefined);
        }
        if (ctx && p === undefined) setHydrateContext();
        const rendered = createMemo(() => props.children);
        return createMemo(() => {
          const inFallback = store.inFallback(),
            visibleContent = showContent ? showContent() : true,
            visibleFallback = showFallback ? showFallback() : true;
          dispose && dispose();
          if ((!inFallback || p !== undefined) && visibleContent) {
            store.resolved = true;
            ctx = p = undefined;
            resumeEffects(store.effects);
            return rendered();
          }
          if (!visibleFallback) return;
          return createRoot(disposer => {
            dispose = disposer;
            if (ctx) {
              setHydrateContext({ id: ctx.id + "f", count: 0 });
              ctx = undefined;
            }
            return props.fallback;
          }, owner!);
        });
      });
    }
  });
}
