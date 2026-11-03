/**
 * #4648 (follow-up to #4657). A derivation the hold runs — it read the
 * hold's staging plainly — makes an untracked `isPending()` probe in its
 * own pass (a component body under `<Show>`: `isPending(() => props.job.id)`
 * reading the narrowed condition). The probe is a snapshot, as any
 * untracked read is (D-24): it does not make the pass a verdict reader, so
 * its reads inside the window see what the pass's plain reads see — the
 * frame's staging (F-10: one frame for every channel) — and the answer is
 * final in that frame: `[isPending(x), x()]` never pairs `true` with the
 * fresh value (D-23). It read the committed value instead, beside the
 * staging its plain read saw, and answered `true` once the frame was held.
 *
 * `latest()` already served the staging (D-22); a tracked probe — a verdict
 * reader — still reads the screen (F-6, A10).
 *
 * A first value staged this flush (an async first load's landing) has no
 * screen at all: a probe of it in that flush read the empty committed slot
 * (`undefined`) where its plain read serves the staging (D-23 exc. 1, A29).
 */
import { expect, it } from "vitest";
import {
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";

const tick = async () => {
  for (let i = 0; i < 8; i++) await Promise.resolve();
  flush();
};

type Row = { v: number; inner: unknown; p: unknown };

function setup(probe: "isPending" | "latest" | "tracked isPending") {
  const [open, setOpen] = createSignal(0);
  const [other, setOther] = createSignal(0);
  let release = () => {};
  const log: Row[] = [];
  const screen: Row[] = [];
  createRoot(() => {
    // Read by a render effect outside any boundary: a write to `open` is
    // held until this lands (F-2).
    const data = createMemo(() => {
      const o = open();
      return new Promise<number>(r => (release = () => r(o)));
    });
    const cond = createMemo(() => open());
    const pass = createMemo(() => {
      other();
      const v = cond();
      let inner: unknown;
      const p =
        probe === "tracked isPending"
          ? isPending(() => (inner = cond()))
          : untrack(() =>
              probe === "isPending" ? isPending(() => (inner = cond())) : (inner = latest(cond))
            );
      const r = { v, inner, p };
      log.push(r);
      return r;
    });
    createRenderEffect(data, () => {});
    createRenderEffect(pass, r => void screen.push(r));
  });
  flush();
  release();
  return { setOpen, setOther, release: () => release(), log, screen };
}

it("an untracked isPending probe in a pass of the frame reads the frame's staging", async () => {
  const { setOpen, setOther, release, log, screen } = setup("isPending");
  await tick();
  log.length = 0;
  setOpen(5);
  flush();
  // The flush that stages `open` (and parks on `data`).
  expect(log).toEqual([{ v: 5, inner: 5, p: false }]);
  setOther(1);
  flush();
  // A re-run while the frame is held: still the frame's staging, final there.
  expect(log).toEqual([
    { v: 5, inner: 5, p: false },
    { v: 5, inner: 5, p: false }
  ]);
  expect(screen.at(-1)).toEqual({ v: 0, inner: 0, p: false });
  release();
  await tick();
  // The hold lands whole: never the committed value beside the staging.
  expect(screen.at(-1)).toEqual({ v: 5, inner: 5, p: false });
});

it("latest() in the same position already served the staging (control)", async () => {
  const { setOpen, setOther, release, log, screen } = setup("latest");
  await tick();
  log.length = 0;
  setOpen(5);
  flush();
  setOther(1);
  flush();
  expect(log.map(r => r.inner)).toEqual([5, 5]);
  release();
  await tick();
  expect(screen.at(-1)).toEqual({ v: 5, inner: 5, p: 5 });
});

it("a tracked probe is a verdict reader and reads the screen (control, A10)", async () => {
  const { setOpen, release, log, screen } = setup("tracked isPending");
  await tick();
  log.length = 0;
  setOpen(5);
  flush();
  // Never `true` beside the fresh value.
  for (const r of log) expect(r.p && r.v === 5).toBe(false);
  for (const r of log) expect(r.inner).toBe(r.v);
  release();
  await tick();
  expect(screen.at(-1)).toEqual({ v: 5, inner: 5, p: false });
});

it("a probe of a first value staged this flush reads that value (D-23 exc. 1)", async () => {
  // `<Loading><Show when={job()}>{j => <Show when={isPending(() => j().id)}/>}</Show></Loading>`
  // with `job` an async first load: in the landing flush the narrowed
  // condition has no committed value, only the staging the branch mounted
  // on — its plain read's value. The probe read the empty committed slot.
  const seen: unknown[] = [];
  let screen: unknown;
  createRoot(() => {
    const job = createMemo(() => Promise.resolve({ id: 2 }));
    const cv = createMemo(() => job());
    const out = createLoadingBoundary(
      () => {
        const branch = createMemo(() => {
          if (!cv()) return null;
          return untrack(() =>
            createMemo(() => {
              let inner: unknown;
              const p = isPending(() => (inner = cv()));
              seen.push(inner);
              return { inner, p };
            })
          );
        });
        return () => branch()?.();
      },
      () => "loading"
    );
    createRenderEffect(
      () => {
        const v = out();
        return typeof v === "function" ? v() : v;
      },
      v => void (screen = v)
    );
  });
  flush();
  expect(screen).toBe("loading");
  await tick();
  expect(seen).not.toContain(undefined);
  expect(screen).toEqual({ inner: { id: 2 }, p: false });
});
