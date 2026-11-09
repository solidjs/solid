/**
 * #4527: an action re-asks a derived store and a memo, so its transition
 * stays open. The store's re-ask rejects (staged, D-41), then a second
 * re-ask answers before the transition commits. An effect whose compute
 * creates an error boundary over the bare store proxy got the superseded
 * error at the commit (the boundary's fallback, `null`) and never ran again.
 *
 * Two holes, both D-41 / D-39: the memo returning the proxy was thrown the
 * staged error by `handleAsync`'s shape probe (an untracked read that pulls
 * the derive) without a link to the derive, so neither the second re-ask nor
 * its answer reached it; and an error boundary that never showed content
 * kept its fallback over a reader whose replacement had landed in the same
 * hold, so the commit showed an error nothing on screen carried.
 */
import { expect, it } from "vitest";
import {
  action,
  createEffect,
  createErrorBoundary,
  createLoadingBoundary,
  createMemo,
  createOptimisticStore,
  createRenderEffect,
  createRoot,
  createStore,
  flush,
  refresh,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise(r => setTimeout(r, 0));
    flush();
  }
};

for (const kind of ["optimistic", "store"] as const)
  for (const effect of ["effect", "render"] as const)
    it(`#4527 ${kind} ${effect}: the commit shows the answer, not the superseded error`, async () => {
      const asks: { key: string; res: (v: any) => void; rej: (e: any) => void }[] = [];
      const ask = (key: string) => new Promise<any>((res, rej) => asks.push({ key, res, rej }));
      const settle = async (key: string, f: (a: (typeof asks)[number]) => void) => {
        f(
          asks.splice(
            asks.findIndex(a => a.key === key),
            1
          )[0]
        );
        await tick();
      };
      const seen: string[] = [];
      const frames: string[] = [];
      let screen = "";
      const snap = (label: string) => {
        frames.push(`${label}: ${screen} | ${seen.join(",")}`);
        seen.length = 0;
      };
      let again!: () => void;
      let rename!: (t: string) => any;
      const dispose = createRoot(d => {
        const [issues] =
          kind === "store"
            ? createStore<any[]>(() => ask("issues"), [])
            : createOptimisticStore<any[]>(() => ask("issues"), [], { key: "id" });
        again = () => refresh(issues);
        const detail = createMemo(() => ask("detail"));
        rename = action(function* (t: string) {
          yield ask(`rename:${t}`);
          refresh(issues);
          refresh(detail);
        });
        const compute = () =>
          untrack(() =>
            createErrorBoundary(
              () => issues,
              () => null
            )
          )();
        const out = (v: any) => void seen.push(v === null ? "null" : `len${v.length}`);
        if (effect === "render") createRenderEffect(compute, out);
        else
          createEffect(compute, {
            effect: out,
            error: (e: any) => void seen.push(`error ${e?.message}`)
          } as any);
        const list = createLoadingBoundary(
          createErrorBoundary(
            () => issues.map((r: any) => r.title).join(","),
            (e: any) => `err ${e().message}`
          ),
          () => "loading"
        );
        const info = createLoadingBoundary(
          () => String(detail()),
          () => "…"
        );
        createRenderEffect(
          () => `${list()} / ${info()}`,
          v => void (screen = v)
        );
        return d;
      });
      await tick();
      const rows = (t: string) => [
        { id: 1, title: "Login" },
        { id: 3, title: t },
        { id: 4, title: "Typo" }
      ];
      await settle("issues", a => a.res(rows("Crash")));
      await settle("detail", a => a.res("d1"));
      seen.length = 0;
      rename("Alpha");
      await tick();
      await settle("rename:Alpha", a => a.res({}));
      await settle("issues", a => a.rej(new Error("declined")));
      snap("re-ask failed");
      again();
      await tick();
      await settle("issues", a => a.res(rows("Alpha").filter(r => r.id !== 4)));
      await settle("detail", a => a.res("d2"));
      snap("committed");
      expect(frames).toEqual([
        // D-41: the rejection is staged with the held frame — nothing shows it.
        "re-ask failed: Login,Crash,Typo / d1 | ",
        // The second answer superseded it before the commit: nothing sees it.
        "committed: Login,Alpha / d2 | len2"
      ]);
      dispose();
    });
