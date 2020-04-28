import { createComponent } from "dom-expressions/src/runtime";
import {
  createSignal,
  sample,
  SuspenseContext,
  createEffect,
  createContext,
  useContext,
  equalFn,
  afterEffects
} from "../index.js";

type SuspenseState = "running" | "suspended" | "fallback";
type SuspenseListRegistryItem = {
  state: () => SuspenseState;
  showContent: (v: boolean) => void;
  showFallback: (v: boolean) => void;
};

type SuspenseListContextType = {
  register: (state: () => SuspenseState) => [() => boolean, () => boolean];
};
const SuspenseListContext = createContext<SuspenseListContextType>();

export function SuspenseList(props: {
  children: any;
  revealOrder: "forwards" | "backwards" | "together";
  tail?: "collapsed" | "hidden";
}) {
  let index = 0,
    suspenseSetter: (s: SuspenseState) => void,
    showContent: () => boolean,
    showFallback: () => boolean;

  // Nested SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) {
    const [state, stateSetter] = createSignal<SuspenseState>("running", equalFn);
    suspenseSetter = stateSetter;
    [showContent, showFallback] = listContext.register(state);
  }

  const registry: SuspenseListRegistryItem[] = [],
    comp = createComponent(
      SuspenseListContext.Provider,
      {
        value: {
          register: (state: () => SuspenseState) => {
            const [showingContent, showContent] = createSignal(false, equalFn),
              [showingFallback, showFallback] = createSignal(false, equalFn);
            registry[index++] = { state, showContent, showFallback };
            return [showingContent, showingFallback];
          }
        },
        children: () => props.children
      },
      ["children"]
    );

  createEffect(() => {
    const reveal = props.revealOrder,
      tail = props.tail,
      visibleContent = showContent ? showContent() : true,
      visibleFallback = showFallback ? showFallback() : true,
      reverse = reveal === "backwards";

    if (reveal === "together") {
      const all = registry.every(i => i.state() === "running");
      suspenseSetter && suspenseSetter(all ? "running" : "fallback");
      registry.forEach(i => {
        i.showContent(all && visibleContent);
        i.showFallback(visibleFallback);
      });
      return;
    }

    let stop = false;
    for (let i = 0, len = registry.length; i < len; i++) {
      const n = reverse ? len - i - 1 : i,
        s = registry[n].state();
      if (!stop && (s === "running" || s === "suspended")) {
        registry[n].showContent(visibleContent);
        registry[n].showFallback(visibleFallback);
      } else {
        const next = !stop;
        if (next && suspenseSetter) suspenseSetter("fallback");
        if (!tail || (next && tail === "collapsed")) {
          registry[n].showFallback(visibleFallback);
        } else registry[n].showFallback(false);
        stop = true;
        registry[n].showContent(next);
      }
    }
    if (!stop && suspenseSetter) suspenseSetter("running");
  });

  return comp;
}

export function Suspense(props: { fallback: any; children: any }) {
  let counter = 0,
    t: NodeJS.Timeout,
    showContent: () => boolean,
    showFallback: () => boolean,
    transition: typeof SuspenseContext["transition"];
  const [state, nextState] = createSignal<SuspenseState>("running", equalFn),
    store = {
      increment: () => {
        if (++counter === 1) {
          if (!store.initializing) {
            if (SuspenseContext.transition) {
              !transition && (transition = SuspenseContext.transition).increment();
              t = setTimeout(() => nextState("fallback"), SuspenseContext.transition.timeoutMs);
              nextState("suspended");
            } else nextState("fallback");
          } else nextState("fallback");
          SuspenseContext.increment!();
        }
      },
      decrement: () => {
        if (--counter === 0) {
          t && clearTimeout(t);
          transition && transition.decrement();
          transition = undefined;
          nextState("running");
          afterEffects(() => SuspenseContext.decrement!());
        }
      },
      state,
      initializing: true
    };

  // SuspenseList support
  const listContext = useContext(SuspenseListContext);
  if (listContext) [showContent, showFallback] = listContext.register(store.state);

  return createComponent(
    SuspenseContext.Provider,
    {
      value: store,
      children: () => {
        const rendered = sample(() => props.children);

        return () => {
          const value = store.state(),
            visibleContent = showContent ? showContent() : true,
            visibleFallback = showFallback ? showFallback() : true;
          if (store.initializing) store.initializing = false;
          if ((value === "running" && visibleContent) || value === "suspended") return rendered;
          if (!visibleFallback) return;
          return props.fallback;
        };
      }
    },
    ["children"]
  );
}
