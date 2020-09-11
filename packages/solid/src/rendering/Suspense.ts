import { createComponent } from "./component";
import {
  createSignal,
  untrack,
  createEffect,
  createComputed,
  createContext,
  useContext,
  SuspenseContext
} from "../reactive/signal";

type SuspenseListRegistryItem = {
  inFallback: () => boolean;
  showContent: (v: boolean) => void;
  showFallback: (v: boolean) => void;
};

type SuspenseListContextType = {
  register: (inFallback: () => boolean) => [() => boolean, () => boolean];
};
const SuspenseListContext = createContext<SuspenseListContextType>();

export function awaitSuspense(fn: () => any) {
  return () =>
    new Promise(resolve => {
      const res = fn();
      createEffect(() => !SuspenseContext.active!() && resolve(res));
    });
}

export function SuspenseList(props: {
  children: JSX.Element;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  let index = 0,
    suspenseSetter: (s: boolean) => void,
    showContent: () => boolean,
    showFallback: () => boolean;

  // Nested SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) {
    const [inFallback, setFallback] = createSignal(false, true);
    suspenseSetter = setFallback;
    [showContent, showFallback] = listContext.register(inFallback);
  }

  const registry: SuspenseListRegistryItem[] = [],
    comp = createComponent(SuspenseListContext.Provider, {
      value: {
        register: (inFallback: () => boolean) => {
          const [showingContent, showContent] = createSignal(false, true),
            [showingFallback, showFallback] = createSignal(false, true);
          registry[index++] = { inFallback, showContent, showFallback };
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
      reverse = reveal === "backwards";

    if (reveal === "together") {
      const all = registry.every(i => !i.inFallback());
      suspenseSetter && suspenseSetter(!all);
      registry.forEach(i => {
        i.showContent(all && visibleContent);
        i.showFallback(visibleFallback);
      });
      return;
    }

    let stop = false;
    for (let i = 0, len = registry.length; i < len; i++) {
      const n = reverse ? len - i - 1 : i,
        s = registry[n].inFallback();
      if (!stop && !s) {
        registry[n].showContent(visibleContent);
        registry[n].showFallback(visibleFallback);
      } else {
        const next = !stop;
        if (next && suspenseSetter) suspenseSetter(true);
        if (!tail || (next && tail === "collapsed")) {
          registry[n].showFallback(visibleFallback);
        } else registry[n].showFallback(false);
        stop = true;
        registry[n].showContent(next);
      }
    }
    if (!stop && suspenseSetter) suspenseSetter(false);
  });

  return comp;
}

export function Suspense(props: { fallback: JSX.Element; children: JSX.Element }) {
  let counter = 0,
    showContent: () => boolean,
    showFallback: () => boolean;
  const [inFallback, setFallback] = createSignal<boolean>(false, true),
    store = {
      increment: () => {
        if (++counter === 1) {
          setFallback(true);
          SuspenseContext.increment!();
        }
      },
      decrement: () => {
        if (--counter === 0) {
          setFallback(false);
          Promise.resolve().then(SuspenseContext.decrement!);
        }
      },
      inFallback
    };

  // SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) [showContent, showFallback] = listContext.register(store.inFallback);

  return createComponent(SuspenseContext.Provider, {
    value: store,
    get children() {
      const rendered = untrack(() => props.children);

      return () => {
        const inFallback = store.inFallback(),
          visibleContent = showContent ? showContent() : true,
          visibleFallback = showFallback ? showFallback() : true;
        if (!inFallback && visibleContent) return rendered;
        if (!visibleFallback) return;
        return props.fallback;
      };
    }
  });
}
