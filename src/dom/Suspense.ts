import { insert, createComponent } from "./runtime";
import {
  createRoot,
  createSignal,
  createMemo,
  sample,
  SuspenseContext,
  afterEffects
} from "../index";

export function Suspense(props: {
  maxDuration?: number;
  fallback: any;
  children: any;
}) {
  let counter = 0,
    t: NodeJS.Timeout,
    state = "running";
  const [get, next] = createSignal<void>(),
    store = {
      increment: () => {
        if (++counter === 1) {
          if (!store.initializing) {
            if (props.maxDuration) {
              state = "suspended";
              t = setTimeout(
                () => ((state = "fallback"), next()),
                props.maxDuration
              );
            } else state = "fallback";
            next();
          } else state = "fallback";
        }
      },
      decrement: () => {
        if (--counter === 0) {
          t && clearTimeout(t);
          if (state !== "running") {
            state = "running";
            next();
          }
        }
      },
      state: () => {
        get();
        return state;
      },
      initializing: true
    };

  return createComponent(
    SuspenseContext.Provider,
    {
      value: store,
      children: () => {
        let dispose: () => void;
        const rendered = sample(() => props.children),
          marker = document.createTextNode(""),
          doc = document.implementation.createHTMLDocument();

        Object.defineProperty(doc.body, "host", {
          get() {
            return marker && marker.parentNode;
          }
        });

        return () => {
          const value = store.state();
          if (store.initializing) store.initializing = false;
          dispose && dispose();
          if (value !== "fallback") return [marker, rendered];
          afterEffects(() =>
            createRoot(disposer => {
              dispose = disposer;
              insert(doc.body, rendered);
            })
          );
          return [marker, props.fallback];
        };
      }
    },
    ["children"]
  );
}
