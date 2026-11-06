/** @jsxImportSource @solidjs/web */
import { expect, test } from "vitest";
import { action, createMemo, createSignal, Errored, latest, onCleanup, Show } from "solid-js";
import { render } from "@solidjs/web";

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

for (const fail of [false, true]) {
  for (const depth of [0, 1, 2]) {
    for (const asyncAnswer of [false, true]) {
      test.each([false, true])(
        `latest publishes errors and recovery through ${depth} memos (async=${asyncAnswer}, error=${fail}, removal=%s)`,
        async removeBranch => {
          const end = Promise.withResolvers<void>();
          const answer = Promise.withResolvers<string>();
          const recovery = Promise.withResolvers<string>();
          const container = document.createElement("div");
          let start!: () => Promise<unknown>;
          let setVersion!: (value: number) => void;
          function App() {
            const [version, set] = createSignal(0);
            setVersion = set;
            const data = createMemo(() => {
              switch (version()) {
                case 1:
                  if (asyncAnswer) return answer.promise;
                  if (fail) throw new Error("failed");
                  return "changed";
                case 2:
                  if (fail) throw new Error("failed again");
                  return "changed again";
                case 3:
                  return recovery.promise;
                default:
                  return "ready";
              }
            });
            let ahead = () => latest(data);
            for (let i = 0; i < depth; i++) ahead = createMemo(ahead);
            start = action(function* () {
              set(1);
              yield end.promise;
            });
            return (
              <>
                <p>{version()}</p>
                <Errored fallback={error => (error() as Error).message}>
                  <Show when={!removeBranch || version() !== 1}>
                    <span>{ahead()}</span>
                  </Show>
                </Errored>
                <hr />
                <Errored fallback={error => (error() as Error).message}>
                  <span>{data()}</span>
                </Errored>
              </>
            );
          }
          const dispose = render(() => <App />, container);
          let running: Promise<unknown> | undefined;
          try {
            await tick();
            expect(container.textContent).toBe("0readyready");
            running = start();
            await tick();
            if (asyncAnswer) {
              expect(container.textContent).toBe("0readyready");
              if (fail) answer.reject(new Error("failed"));
              else answer.resolve("changed");
              await tick();
            }
            expect(container.textContent).toBe(fail ? "0failedready" : "0changedready");
            setVersion(2);
            await tick();
            expect(container.textContent).toBe(fail ? "0failed againready" : "0changed againready");
            setVersion(3);
            await tick();
            expect(container.textContent).toBe(fail ? "0failed againready" : "0changed againready");
            recovery.resolve("recovered");
            await tick();
            expect(container.textContent).toBe("0recoveredready");
            end.resolve();
            await running;
            await tick();
            expect(container.textContent).toBe("3recoveredrecovered");
          } finally {
            end.resolve();
            answer.resolve("ready");
            recovery.resolve("recovered");
            await running;
            dispose();
          }
        }
      );
    }
  }
}

test("reset retries the failed source and retains the fallback until latest recovers to the same value", async () => {
  const end = Promise.withResolvers<void>();
  const recovery = Promise.withResolvers<string>();
  const container = document.createElement("div");
  let start!: () => Promise<unknown>;
  let reset!: () => void;
  let retry = false;
  let fallbackMounts = 0;
  let fallbackCleanups = 0;
  const dispose = render(() => {
    const [version, setVersion] = createSignal(0);
    const data = createMemo(() => {
      if (version() === 0) return "ready";
      if (retry) return recovery.promise;
      throw new Error("failed");
    });
    start = action(function* () {
      setVersion(1);
      yield end.promise;
    });
    return (
      <>
        <p>{version()}</p>
        <Errored
          fallback={(error, retry) => {
            reset = retry;
            fallbackMounts++;
            onCleanup(() => fallbackCleanups++);
            return <b>{(error() as Error).message}</b>;
          }}
        >
          <span>{latest(data)}</span>
        </Errored>
      </>
    );
  }, container);
  let running: Promise<unknown> | undefined;
  try {
    await tick();
    expect(container.textContent).toBe("0ready");
    running = start();
    await tick();
    expect(container.textContent).toBe("0failed");
    const fallback = container.querySelector("b");
    retry = true;
    reset();
    await tick();
    expect(container.textContent).toBe("0failed");
    expect(container.querySelector("b")).toBe(fallback);
    expect([fallbackMounts, fallbackCleanups]).toEqual([1, 0]);
    recovery.resolve("ready");
    await tick();
    expect(container.textContent).toBe("0ready");
    expect([fallbackMounts, fallbackCleanups]).toEqual([1, 1]);
    end.resolve();
    await running;
    await tick();
    expect(container.textContent).toBe("1ready");
    expect([fallbackMounts, fallbackCleanups]).toEqual([1, 1]);
  } finally {
    end.resolve();
    recovery.resolve("ready");
    await running;
    dispose();
  }
});
