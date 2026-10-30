/**
 * #4305: a keyed projection over an async memo follows every landing. The
 * memo going pending marks the derive without re-running it (#4271), and the
 * family wakes the leaves' readers pending on the derive — the source the
 * landing's settle walk retires. A per-row memo reading a leaf whose value the
 * landing leaves unchanged does not re-run, so a wake parked on the upstream
 * memo instead held it (and the render effect over it) after the first landing.
 * "rederive": the derive re-runs while the memo is pending (another source of
 * it changes), its pass throwing the memo's NotReady — the same wake.
 */
import { describe, expect, it } from "vitest";
import {
  createMemo,
  createProjection,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  mapArray
} from "../src/index.js";

type Row = { id: number; name: string };

const tick = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const mode of ["row-memo", "direct", "rederive"] as const) {
  describe(`#4305 (${mode})`, () => {
    it("a keyed projection over an async memo follows every landing", async () => {
      const [q, setQ] = createSignal("");
      const [other, setOther] = createSignal(0);
      const res: Record<string, (rows: Row[]) => void> = {};
      let screen = "";
      const dispose = createRoot(d => {
        const src = createMemo(() =>
          q() === "" ? ([] as Row[]) : new Promise<Row[]>(r => (res[q()] = r))
        );
        const rows = createProjection(
          () => {
            other();
            return src();
          },
          [] as Row[],
          { key: "id" }
        );
        if (mode === "direct")
          createRenderEffect(
            () => rows.map(r => r.name).join(","),
            v => {
              screen = v;
            }
          );
        else {
          const views = mapArray(
            () => rows,
            row => {
              const name = createMemo(() => row.name);
              return () => name();
            }
          );
          createRenderEffect(
            () =>
              views()
                .map(f => f())
                .join(","),
            v => {
              screen = v;
            }
          );
        }
        return d;
      });
      flush();
      await tick();
      expect(screen).toBe("");

      setQ("ap");
      flush();
      await tick();
      res.ap([
        { id: 1, name: "apple" },
        { id: 2, name: "apricot" }
      ]);
      await tick();
      expect(screen).toBe("apple,apricot");

      // Row 1 survives with its name unchanged: its memo does not re-run.
      setQ("app");
      flush();
      await tick();
      if (mode === "rederive") {
        setOther(1);
        flush();
        await tick();
      }
      expect(screen).toBe("apple,apricot");
      res.app([
        { id: 1, name: "apple" },
        { id: 3, name: "applesauce" },
        { id: 4, name: "apple pie" }
      ]);
      await tick();
      expect(screen).toBe("apple,applesauce,apple pie");

      // Row 1 survives with a changed name; row 4 survives unchanged.
      setQ("appl");
      flush();
      await tick();
      expect(screen).toBe("apple,applesauce,apple pie");
      res.appl([
        { id: 1, name: "apple tart" },
        { id: 4, name: "apple pie" }
      ]);
      await tick();
      expect(screen).toBe("apple tart,apple pie");

      dispose();
    });
  });
}
