import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  latest
} from "../src/index.js";

// #4355 (D-30, D-22, D-3): a derived store whose derive reads an async memo
// through `latest()` resolves; its first downstream reader must see what the
// derive wrote, never the seed. A render effect commits only the real value.
describe("#4355 derived store over latest() of an async memo", () => {
  const settle = async () => {
    for (let i = 0; i < 4; i++) {
      await new Promise(r => setTimeout(r, 0));
      flush();
    }
  };

  async function run(form: "latest" | "plain", reader: "memo" | "store" | "direct") {
    let resolve!: (v: { name: string }) => void;
    const seen: unknown[] = [];
    let dispose!: () => void;
    createRoot(d => {
      dispose = d;
      const record = createMemo(() => new Promise<{ name: string }>(r => (resolve = r)));
      const [state] = createStore<any>((draft: any) => {
        draft.value = {
          name: form === "latest" ? latest(() => record().name) : record().name
        };
      }, {});
      if (reader === "memo") {
        const view = createMemo(() => state.value?.name);
        createRenderEffect(view, v => {
          seen.push(v);
        });
      } else if (reader === "store") {
        // The report's display store: a second derived store copying the first.
        const [display] = createStore<any>((draft: any) => {
          draft.value = state.value;
        }, {});
        createRenderEffect(
          () => display.value?.name,
          v => {
            seen.push(v);
          }
        );
      } else {
        createRenderEffect(
          () => state.value?.name,
          v => {
            seen.push(v);
          }
        );
      }
    });
    flush();
    expect(seen).toEqual([]);
    resolve({ name: "Hartford" });
    await settle();
    dispose();
    return seen;
  }

  for (const form of ["latest", "plain"] as const)
    for (const reader of ["memo", "store", "direct"] as const)
      it(`${form} derive, ${reader} reader: the effect commits only the value`, async () => {
        expect(await run(form, reader)).toEqual(["Hartford"]);
      });
});
