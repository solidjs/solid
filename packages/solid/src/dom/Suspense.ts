import { createComponent } from "./runtime";
import {
  createSignal,
  sample,
  SuspenseContext,
  createEffect,
  createContext,
  useContext,
  equalFn
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
    state: SuspenseState = "running",
    showContent: () => boolean,
    showFallback: () => boolean,
    transition: typeof SuspenseContext["transition"];
  const [get, next] = createSignal<void>(),
    store = {
      increment: () => {
        if (++counter === 1) {
          if (!store.initializing) {
            if (SuspenseContext.transition) {
              state = "suspended";
              !transition && (transition = SuspenseContext.transition).increment();
              t = setTimeout(
                () => ((state = "fallback"), next()),
                SuspenseContext.transition.timeoutMs
              );
            } else state = "fallback";
            next();
          } else state = "fallback";
          SuspenseContext.increment!();
        }
      },
      decrement: () => {
        if (--counter === 0) {
          t && clearTimeout(t);
          if (state !== "running") {
            state = "running";
            transition && transition.decrement();
            transition = undefined;
            next();
            SuspenseContext.decrement!();
          }
        }
      },
      state: () => {
        get();
        return state;
      },
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
        let dispose: (() => void) | null;
        const rendered = sample(() => props.children),
          marker = document.createTextNode(""),
          doc = document.implementation.createHTMLDocument();

        Object.defineProperty(doc.body, "host", {
          get() {
            return marker && marker.parentNode;
          }
        });

        return () => {
          const value = store.state(),
            visibleContent = showContent ? showContent() : true,
            visibleFallback = showFallback ? showFallback() : true;
          if (store.initializing) store.initializing = false;
          dispose && dispose();
          dispose = null;
          if ((value === "running" && visibleContent) || value === "suspended")
            return [marker, rendered];
          if (!visibleFallback) return [marker];
          return [marker, props.fallback];
        };
      }
    },
    ["children"]
  );
}
