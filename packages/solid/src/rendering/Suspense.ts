import { createComponent } from "./component";
import {
  createSignal,
  untrack,
  createRenderEffect,
  createComputed,
  createContext,
  useContext,
  getSuspenseContext,
  resumeEffects
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

let trackSuspense = false;
export function awaitSuspense(fn: () => any) {
  const SuspenseContext = getSuspenseContext();
  if (!trackSuspense) {
    let count = 0;
    const [active, trigger] = createSignal(false);
    SuspenseContext.active = active;
    SuspenseContext.increment = () => count++ === 0 && trigger(true);
    SuspenseContext.decrement = () => --count <= 0 && trigger(false);
    trackSuspense = true;
  }
  return () =>
    new Promise(resolve => {
      const res = fn();
      createRenderEffect(() => !SuspenseContext.active!() && resolve(res));
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
  const [inFallback, setFallback] = createSignal<boolean>(false),
    SuspenseContext = getSuspenseContext(),
    store = {
      increment: () => {
        if (++counter === 1) {
          setFallback(true);
          trackSuspense && SuspenseContext.increment!();
        }
      },
      decrement: () => {
        if (--counter === 0) {
          setFallback(false);
          trackSuspense && Promise.resolve().then(SuspenseContext.decrement!);
        }
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
      store.resolved = true;

      return () => {
        const inFallback = store.inFallback(),
          visibleContent = showContent ? showContent() : true,
          visibleFallback = showFallback ? showFallback() : true;
        if (!inFallback && visibleContent) {
          resumeEffects(store.effects);
          return rendered;
        }
        if (!visibleFallback) return;
        return props.fallback;
      };
    }
  });
}
