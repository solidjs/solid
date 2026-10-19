/** @jsxImportSource @solidjs/web */
import {
  createContext,
  createMemo,
  createRoot,
  onCleanup,
  onSettled,
  runWithOwner,
  useContext,
  type Accessor
} from "solid-js";
import { DeferredHydration, Errored, Loading } from "@solidjs/web";

const Label = createContext("missing context");

export function deferredApp(options: {
  ready: Accessor<boolean>;
  async?: boolean;
  nestedReady?: Accessor<boolean>;
  entered?: (name: string) => void;
  disposed?: () => void;
  settled?: () => void;
  clicked?: () => void;
  fail?: () => void;
  failed?: (error: unknown) => void;
}) {
  function Content() {
    options.entered?.("outer");
    const label = useContext(Label);
    onCleanup(() => {
      options.disposed?.();
    });
    options.fail?.();
    const data = options.async
      ? createMemo(async () => {
          await new Promise(resolve => setTimeout(resolve, 5));
          return "async content";
        })
      : undefined;
    return (
      <section>
        <button onClick={() => options.clicked?.()}>{label}</button>
        {data && <em>{data()}</em>}
        <DeferredHydration when={options.nestedReady?.() ?? true}>
          <Nested />
        </DeferredHydration>
      </section>
    );
  }
  function Nested() {
    options.entered?.("nested");
    return <span>nested context: {useContext(Label)}</span>;
  }
  function App() {
    onSettled(() => {
      options.settled?.();
    });
    return (
      <Errored
        fallback={error => {
          options.failed?.(error());
          return <p>activation failed</p>;
        }}
      >
        <Label value="preserved context">
          <main>
            <DeferredHydration when={options.ready()} fallback={<p>client fallback</p>}>
              <Loading fallback={<p>native pending</p>}>
                <Content />
              </Loading>
            </DeferredHydration>
            <aside>following sibling</aside>
          </main>
        </Label>
      </Errored>
    );
  }
  return App;
}

// A code owner may have finished SSR while its browser module is still loading.
// The module promise belongs to that owner, not the native hydration transport.
export function deferredModuleApp(options: {
  ready: Accessor<boolean>;
  module?: Promise<void>;
  moduleRequest?: Accessor<Promise<void>>;
  reloadKey?: Accessor<number>;
  entered?: () => void;
  disposed?: () => void;
  moduleDisposed?: () => void;
  clicked?: () => void;
  followingClicked?: () => void;
  failed?: (error: unknown) => void;
  handledFailure?: () => void;
  handledFailed?: (error: unknown) => void;
  outerFailure?: () => void;
}) {
  function Child() {
    options.entered?.();
    onCleanup(() => options.disposed?.());
    return <button onClick={() => options.clicked?.()}>module content</button>;
  }
  function Module() {
    let stop: (() => void) | undefined;
    const module = options.module;
    const loaded = module
      ? runWithOwner(null, () =>
          createRoot(dispose => {
            stop = dispose;
            return createMemo(() =>
              (options.moduleRequest?.() ?? module).then(
                () => ({}),
                error => ({ error })
              )
            );
          })
        )
      : () => ({});
    onCleanup(() => {
      stop?.();
      options.moduleDisposed?.();
    });
    const readModule = () => {
      const outcome = loaded();
      if ("error" in outcome) throw outcome.error;
    };
    // Keep the same JSX owner shape on both sides; only the browser has a
    // pending, un-serialized module promise in the detached root above.
    return <>{(readModule(), (<Child />))}</>;
  }
  function HandledChild() {
    return <>{(options.handledFailure?.(), (<span>inner content</span>))}</>;
  }
  function OuterChild() {
    return <>{(options.outerFailure?.(), (<span>outer content</span>))}</>;
  }
  function Content() {
    if (options.outerFailure) {
      return (
        <>
          <Errored fallback={<p>inner failed</p>}>
            <Loading fallback={<p>inner pending</p>}>
              <Module />
            </Loading>
          </Errored>
          <OuterChild />
        </>
      );
    }
    if (!options.handledFailure) return <Module />;
    return (
      <>
        <Errored
          fallback={error => {
            options.handledFailed?.(error());
            return <p>inner failed</p>;
          }}
        >
          <HandledChild />
        </Errored>
        <Module />
      </>
    );
  }
  return function App() {
    return (
      <main>
        <Errored
          fallback={error => {
            options.failed?.(error());
            return <p>module failed</p>;
          }}
        >
          <DeferredHydration when={options.ready()}>
            <Loading on={options.reloadKey?.()} fallback={<p>module pending</p>}>
              <Content />
            </Loading>
          </DeferredHydration>
        </Errored>
        <aside onClick={() => options.followingClicked?.()}>module sibling</aside>
      </main>
    );
  };
}
