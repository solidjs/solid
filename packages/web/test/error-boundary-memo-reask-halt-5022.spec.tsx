/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { test, expect } from "vitest";
import * as Solid from "solid-js";
import { refresh, createSignal, createMemo, createOptimisticStore, flush, untrack } from "solid-js";
import { render } from "../src/index.js";

// #5022: a failed re-ask read through an error boundary over a memo is
// caught by the boundary (F-12, D-41); it never halts the app.
const createErrorBoundary = (Solid as any).createErrorBoundary;
const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const v of ["over a memo", "over the store (control)"])
  test(`#5022 a failed re-ask read through an error boundary ${v} doesn't halt`, async () => {
    const asks: { res: (v: any) => void; rej: (e: any) => void }[] = [];
    const ask = () => new Promise<any>((res, rej) => asks.push({ res, rej }));
    const halts: string[] = [];
    const ce = console.error;
    console.error = (...a: any[]) => {
      const m = a.map(String).join(" ");
      if (m.includes("REACTIVITY_HALTED")) halts.push(m.slice(0, 60));
    };
    const c = document.body.appendChild(document.createElement("div"));
    let api: any;
    function App() {
      const [selected, setSelected] = createSignal(4);
      const [cards] = createOptimisticStore(
        async () => await ask(),
        [] as any[],
        {
          key: "id"
        } as any
      );
      const row = createMemo(() => cards.find((r: any) => r.id === selected()));
      const card = untrack(() =>
        createErrorBoundary(
          v === "over the store (control)"
            ? () => cards.find((r: any) => r.id === selected())
            : () => row(),
          () => null
        )
      );
      api = { select: setSelected, reask: () => refresh(cards) };
      return (
        <div>
          <h2>
            #{selected()} {card() == null ? "-" : card().title}
          </h2>
        </div>
      );
    }
    try {
      render(() => <App />, c);
      const screen = () => c.textContent!.replace(/\s+/g, " ").trim();
      await tick();
      asks.shift()!.res([
        { id: 3, title: "Review" },
        { id: 4, title: "Deploy" }
      ]);
      await tick();
      expect(screen()).toBe("#4 Deploy");
      api.reask();
      await tick();
      asks.shift()!.rej(new Error("declined"));
      await tick();
      // The boundary shows its fallback; the heading keeps updating.
      expect(screen()).toBe("#4 -");
      api.select(3);
      await tick();
      expect(halts).toEqual([]);
      expect(screen()).toBe("#3 -");
    } finally {
      console.error = ce;
      c.remove();
    }
  });
