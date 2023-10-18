import { createComponent } from "./component.js";
import {
  createRoot,
  createSignal,
  createContext,
  useContext,
  getSuspenseContext,
  resumeEffects,
  createMemo,
  Accessor,
  onCleanup,
  getOwner
} from "../reactive/signal.js";
import { HydrationContext, setHydrateContext, sharedConfig } from "./hydration.js";
import type { JSX } from "../jsx.js";

type SuspenseListContextType = {
  register: (inFallback: Accessor<boolean>) => Accessor<SuspenseListRegisteredState>;
};

type SuspenseListRegisteredState = { showContent: boolean; showFallback: boolean };
interface SuspenseListState extends Array<SuspenseListRegisteredState> {
  inFallback: boolean;
}

const suspenseListEquals = (a: SuspenseListRegisteredState, b: SuspenseListRegisteredState) =>
  a.showContent === b.showContent && a.showFallback === b.showFallback;
const SuspenseListContext = createContext<SuspenseListContextType>();

/**
 * **[experimental]** controls the order in which suspended content is rendered
 *
 * @description https://www.solidjs.com/docs/latest/api#suspenselist-experimental
 */
export function SuspenseList(props: {
  children: JSX.Element;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  let [wrapper, setWrapper] = createSignal(() => ({ inFallback: false })),
    show: Accessor<{ showContent: boolean; showFallback: boolean }>;

  // Nested SuspenseList support
  const listContext = useContext(SuspenseListContext);
  const [registry, setRegistry] = createSignal<Accessor<boolean>[]>([]);
  if (listContext) {
    show = listContext.register(createMemo(() => wrapper()().inFallback));
  }
  const resolved = createMemo<SuspenseListState>(
    (prev: Partial<SuspenseListState>) => {
      const reveal = props.revealOrder,
        tail = props.tail,
        { showContent = true, showFallback = true } = show ? show() : {},
        reg = registry(),
        reverse = reveal === "backwards";

      if (reveal === "together") {
        const all = reg.every(inFallback => !inFallback());
        const res: SuspenseListState = reg.map(() => ({
          showContent: all && showContent,
          showFallback
        })) as SuspenseListState;
        res.inFallback = !all;
        return res;
      }

      let stop = false;
      let inFallback = prev.inFallback as boolean;
      const res: SuspenseListState = [] as any;
      for (let i = 0, len = reg.length; i < len; i++) {
        const n = reverse ? len - i - 1 : i,
          s = reg[n]();
        if (!stop && !s) {
          res[n] = { showContent, showFallback };
        } else {
          const next = !stop;
          if (next) inFallback = true;
          res[n] = {
            showContent: next,
            showFallback: !tail || (next && tail === "collapsed") ? showFallback : false
          };
          stop = true;
        }
      }
      if (!stop) inFallback = false;
      res.inFallback = inFallback;
      return res;
    },
    { inFallback: false } as unknown as SuspenseListState
  );
  setWrapper(() => resolved);

  return createComponent(SuspenseListContext.Provider, {
    value: {
      register: (inFallback: Accessor<boolean>) => {
        let index: number;
        setRegistry(registry => {
          index = registry.length;
          return [...registry, inFallback];
        });
        return createMemo(() => resolved()[index], undefined, {
          equals: suspenseListEquals
        });
      }
    },
    get children() {
      return props.children;
    }
  });
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
 * @description https://www.solidjs.com/docs/latest/api#suspense
 */
export function Suspense(props: { fallback?: JSX.Element; children: JSX.Element }) {
  let counter = 0,
    show: Accessor<SuspenseListRegisteredState>,
    ctx: HydrationContext | undefined,
    p: Promise<any> | any,
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
    let ref = sharedConfig.load(key);
    if (ref && (typeof ref !== "object" || ref.status !== "success")) p = ref;
    if (p && p !== "$$f") {
      const [s, set] = createSignal(undefined, { equals: false });
      flicker = s;
      p.then(() => {
        sharedConfig.gather!(key);
        setHydrateContext(ctx);
        set();
        setHydrateContext();
      }).catch((err: any) => {
        if (err || sharedConfig.done) {
          err && (error = err);
          return set();
        }
      });
    }
  }

  // SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) show = listContext.register(store.inFallback);
  let dispose: undefined | (() => void);
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
        if (ctx && p === "$$f") setHydrateContext();
        const rendered = createMemo(() => props.children);
        return createMemo((prev: JSX.Element) => {
          const inFallback = store.inFallback(),
            { showContent = true, showFallback = true } = show ? show() : {};
          if ((!inFallback || (p && p !== "$$f")) && showContent) {
            store.resolved = true;
            dispose && dispose();
            dispose = ctx = p = undefined;
            resumeEffects(store.effects);
            return rendered();
          }
          if (!showFallback) return;
          if (dispose) return prev;
          return createRoot(disposer => {
            dispose = disposer;
            if (ctx) {
              setHydrateContext({ id: ctx.id + "f", count: 0 });
              ctx = undefined;
            }
            return props.fallback;
          }, owner!);
        });
      }) as unknown as JSX.Element;
    }
  });
}
