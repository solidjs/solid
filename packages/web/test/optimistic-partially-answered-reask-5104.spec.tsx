/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { expect, test } from "vitest";
import {
  For,
  Show,
  Errored,
  Loading,
  action,
  createOptimisticStore,
  createSignal,
  flush,
  refresh
} from "solid-js";
import { render } from "../src/index.js";

type Row = { id: number };

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(resolve => setTimeout(resolve, 0));
    flush();
  }
};

for (const settlement of ["confirm", "empty", "error"] as const)
  for (const siblingAnswered of [true, false]) {
    test(`a heading counts the guess its list shows (F-1, sibling answered: ${siblingAnswered}, ${settlement})`, async () => {
      const asks: {
        key: string;
        resolve: (rows: Row[]) => void;
        reject: (error: Error) => void;
      }[] = [];
      const ask = (key: string) =>
        new Promise<Row[]>((resolve, reject) => asks.push({ key, resolve, reject }));
      const take = (key: string) => {
        const index = asks.findIndex(ask => ask.key === key);
        expect(index).toBeGreaterThanOrEqual(0);
        return asks.splice(index, 1)[0];
      };
      const answer = (key: string, rows: Row[]) => take(key).resolve(rows);
      let reask!: () => unknown;
      let move!: () => unknown;
      function App() {
        const [doingAnswer] = createSignal(async () => await ask("doing"), { loadingValue: null });
        const [doing, setDoing] = createOptimisticStore(() => doingAnswer() ?? [], [] as Row[], {
          key: "id"
        });
        const [doneAnswer] = createSignal(async () => await ask("done"), { loadingValue: null });
        const [done, setDone] = createOptimisticStore(() => doneAnswer() ?? [], [] as Row[], {
          key: "id"
        });
        reask = action(function* () {
          refresh(doneAnswer);
          refresh(doingAnswer);
        });
        move = action(function* () {
          setDone(rows => rows.filter(row => row.id !== 5));
          setDoing(rows => [...rows, { id: 5 }]);
        });
        return (
          <section>
            <h3>{doingAnswer() != null ? `Doing (${doing.length})` : "Doing"}</h3>
            <Loading fallback={<i>loading</i>}>
              <Errored fallback={<b>error</b>}>
                <Show when={doingAnswer() != null}>
                  <For each={doing}>{row => <span>#{row.id} </span>}</For>
                </Show>
              </Errored>
            </Loading>
            | done: <For each={done}>{row => <span>#{row.id} </span>}</For>
          </section>
        );
      }
      const container = document.body.appendChild(document.createElement("div"));
      const dispose = render(
        () => (
          <Errored fallback={<strong>error</strong>}>
            <App />
          </Errored>
        ),
        container
      );
      const shown = () => container.textContent!.split("|")[0].match(/#\d+/g) ?? [];
      try {
        await tick();
        answer("doing", [{ id: 3 }, { id: 4 }]);
        answer("done", [{ id: 5 }]);
        await tick();
        expect(container.querySelector("h3")?.textContent).toBe("Doing (2)");
        expect(shown()).toEqual(["#3", "#4"]);
        reask();
        await tick();
        if (siblingAnswered) {
          answer("done", [{ id: 5 }]);
          await tick();
        }
        move();
        await tick();
        expect(container.querySelector("h3")?.textContent).toBe("Doing (3)");
        expect(shown()).toEqual(["#3", "#4", "#5"]);

        if (!siblingAnswered) answer("done", [{ id: 5 }]);
        if (settlement === "error") take("doing").reject(new Error("declined"));
        else answer("doing", settlement === "empty" ? [] : [{ id: 3 }, { id: 4 }, { id: 5 }]);
        await tick();
        if (settlement === "error") expect(container.textContent).toBe("error");
        else {
          expect(container.querySelector("h3")?.textContent).toBe(
            `Doing (${settlement === "empty" ? 0 : 3})`
          );
          expect(shown()).toEqual(settlement === "empty" ? [] : ["#3", "#4", "#5"]);
        }
      } finally {
        dispose();
        container.remove();
      }
    });
  }
