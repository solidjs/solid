/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import {
  Errored,
  For,
  Loading,
  action,
  createMemo,
  createOptimistic,
  createRoot,
  createSignal,
  flush,
  refresh
} from "solid-js";
import { render } from "../src/index.js";

type Card = { id: number };
type Request = {
  key: string;
  resolve: (value: Card[]) => void;
  reject: (reason: Error) => void;
};

async function tick() {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
  }
}

for (const optimistic of [false, true]) {
  for (const recovered of [[], [{ id: 3 }, { id: 4 }, { id: 5 }]]) {
    test(`mounting a row does not retry a failed ${optimistic ? "optimistic" : "plain"} source, which can recover to ${recovered.length} rows`, async () => {
      const requests: Request[] = [];
      const ask = (key: string) =>
        new Promise<Card[]>((resolve, reject) => requests.push({ key, resolve, reject }));
      const take = (key: string) => {
        const index = requests.findIndex(request => request.key === key);
        expect(index).toBeGreaterThanOrEqual(0);
        return requests.splice(index, 1)[0];
      };
      const container = document.body.appendChild(document.createElement("div"));
      const controls = createRoot(dispose => {
        const [aTruth] = createSignal<Card[]>(() => ask("a"));
        const [a, guessA] = createOptimistic(() => aTruth());
        const [bTruth] = createSignal<Card[]>(() => ask("b"));
        const b = optimistic ? createOptimistic(() => bTruth())[0] : bTruth;
        const full = createMemo(() => b().length >= 3);
        const toFront = action(function* (id: number) {
          guessA(rows => [{ id }, ...rows.filter(row => row.id !== id)]);
          yield ask(`move:${id}`);
        });
        const unmount = render(
          () => (
            <Loading fallback="loading">
              <For each={a()}>
                {row => (
                  <i>
                    {row.id}
                    <Errored fallback="-">
                      <b>{full() ? "full" : "ok"}</b>
                    </Errored>
                  </i>
                )}
              </For>
              |<Errored fallback="b failed">{b().length}</Errored>
            </Loading>
          ),
          container
        );
        return { dispose, unmount, toFront, bTruth };
      });
      try {
        await tick();
        take("a").resolve([{ id: 1 }, { id: 2 }]);
        await tick();
        take("b").reject(new Error("declined"));
        await tick();
        expect(container.textContent).toBe("1-2-|b failed");

        controls.toFront(2);
        await tick();
        expect(requests.map(request => request.key)).toEqual(["move:2"]);
        expect(container.textContent).toBe("2-1-|b failed");

        const recovery = refresh(controls.bTruth);
        await tick();
        take("b").resolve(recovered);
        await recovery;
        await tick();
        const label = recovered.length >= 3 ? "full" : "ok";
        expect(container.textContent).toBe(`2${label}1${label}|${recovered.length}`);
      } finally {
        controls.unmount();
        controls.dispose();
        container.remove();
      }
    });
  }
}
