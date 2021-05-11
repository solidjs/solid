import { createComponent } from "./component";
import {
  createSignal,
  untrack,
  createComputed,
  createContext,
  useContext,
  getSuspenseContext,
  resumeEffects,
  createMemo,
  Accessor
} from "../reactive/signal";
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

export function SuspenseList(props: {
  children: JSX.Element;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  let index = 0,
    suspenseSetter: (s: boolean) => void,
    showContent: Accessor<boolean>,
    showFallback: Accessor<boolean>;

  // Nested SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) {
    const [inFallback, setFallback] = createSignal(false);
    suspenseSetter = setFallback;
    [showContent, showFallback] = listContext.register(inFallback);
  }

  const registry: SuspenseListRegistryItem[] = [],
    comp = createComponent(SuspenseListContext.Provider, {
      value: {
        register: (inFallback: Accessor<boolean>) => {
          const [showingContent, showContent] = createSignal(false),
            [showingFallback, showFallback] = createSignal(false);
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

export function Suspense(props: { fallback?: JSX.Element; children: JSX.Element }) {
  let counter = 0,
    showContent: Accessor<boolean>,
    showFallback: Accessor<boolean>;
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
    };

  // SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) [showContent, showFallback] = listContext.register(store.inFallback);

  return createComponent(SuspenseContext.Provider, {
    value: store,
    get children() {
      const rendered = untrack(() => props.children);
      return createMemo(() => {
        const inFallback = store.inFallback(),
          visibleContent = showContent ? showContent() : true,
          visibleFallback = showFallback ? showFallback() : true;
        if (!inFallback && visibleContent) {
          store.resolved = true;
          resumeEffects(store.effects);
          return rendered;
        }
        if (!visibleFallback) return;
        return props.fallback;
      });
    }
  });
}
