/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * C18 — classification waits for the drain.
 *
 * "A recordless adopted occurrence is classified (direct-insert vs invoked)
 * only after every record the document already holds for the boundary has
 * been applied: no sync that runs between the parser's end and the deferred
 * drain — the drain's own first `host.apply`, a live op, the live pump's
 * catch-up read — may evaluate a render prop as a zero-arg accessor."
 *
 * Ruling (frames-rulings 3.5, proposed): "an occurrence is classified only
 * after every delivered record has drained" — "pending" is the DRAIN's
 * state, not the parser's. The #2968 defer's bound was `recordsPending()` =
 * parser running or a fragment pending; a record whose data script already
 * ran sat in `_$HY.r` until the deferred `drainRecords` moved it into the
 * store, and nothing read that gap (contract §Red R9).
 *
 * Mechanism meant to carry it: frames/src/client.ts
 * `adoptBoundary.recordsPending`'s third term — `_$HY.r` holds a key under
 * the boundary's `sc:slot:<id>:` / `sc:region:<id>.` prefix that is not yet
 * in `appliedRecords` — read by frames/src/frame-client.ts `#syncSlots`'
 * defer arm. `drainRecords` marks a key applied BEFORE its `host.apply`, so
 * the sync that apply runs sees the other delivered records as pending and
 * its own as drained.
 *
 * Observation: the fills here are REAL — `p => <li>{p.text}{tick()}</li>`,
 * the props read unguarded (plus one untracked identification read, as a
 * fill's top-level read is otherwise a STRICT_READ diagnostic). Classified
 * direct-insert, the render prop is evaluated as a zero-arg accessor inside
 * the insert effect: `p.text` is a `TypeError` and the reactive system
 * halts (`REACTIVITY_HALTED`). The pin
 * asserts the opposite: every occurrence invoked once with its args, the
 * server `<li>` claimed in place, no error, and the page still reactive
 * after the `tick` bump. The harness's replay pins (`harness/replay.spec.tsx`
 * C18 ×3) hold the same three orders through the oracle's tolerant fill;
 * this file pins the consequence for a real one.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { createSignal, flush, untrack } from "solid-js";
import { hydrate } from "@solidjs/web";
import {
  bootPage,
  fillHtml2,
  frameHtml,
  freshFid,
  holeHtml,
  microtasks,
  quiesce,
  slotRange,
  type Page
} from "./support.js";

let page: Page | undefined;
afterEach(async () => {
  await page?.cleanup();
  page = undefined;
});

/** The server render of `p => <li>{p.text}{tick()}</li>` at tick 0. */
const liveFillHtml = (fid: string, occ: string, text: string) => fillHtml2(fid, occ, text, "0");

/**
 * The parser's clock: `document.readyState` reads "loading" until `done()`
 * — the records the document still owes execute while it is running, and
 * the response's tail (the last data script, then the end) parses in one
 * go before any timer fires, so the restore is synchronous with the last
 * record.
 */
function parserRunning() {
  const spy = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  return () => spy.mockRestore();
}

describe("C18 — classification waits for the drain", () => {
  // Arm (a): the drain's own first apply. Two render-prop occurrences; both
  // records owed when the boundary adopts (the #2968 defer arms); both
  // execute, the parser finishes, THEN the deferred drain fires. Its first
  // `host.apply` syncs the frame while the second record is still one loop
  // iteration away in `_$HY.r`: that sync must defer item#1, not classify
  // it — the loop's next apply mounts it with its args.
  test("(a) two records drained after the parser finished: each occurrence claims with its args; nothing is evaluated argless", async () => {
    const fid = freshFid("c18a");
    const parserDone = parserRunning();
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", liveFillHtml(fid, "item#0", "p0"))}${slotRange(
          "item#1",
          liveFillHtml(fid, "item#1", "p1")
        )}</ul>`
      )
    );
    const serverLis = [...page.container.querySelectorAll("li")];
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    const invoked: string[] = [];
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            invoked.push(untrack(() => p.text));
            return (
              <li>
                {p.text}
                {tick()}
              </li>
            );
          }}
        />
      ),
      page.container
    );
    // Adopted with the parser running: both occurrences deferred, nothing
    // invoked, the server markup untouched.
    expect(invoked).toEqual([]);
    expect(page.container.textContent).toBe("p0" + "0" + "p1" + "0");

    // The document's tail: both data scripts, then the end of the response
    // — before the deferred drain's macrotask.
    page.slotRecord(fid, "item#0", { text: "p0" });
    page.slotRecord(fid, "item#1", { text: "p1" });
    parserDone();
    expect(invoked).toEqual([]);

    await quiesce();
    await quiesce();
    expect(invoked.sort()).toEqual(["p0", "p1"]);
    expect([...page.container.querySelectorAll("li")]).toEqual(serverLis);
    expect(page.container.textContent).toBe("p0" + "0" + "p1" + "0");
    setTick(1);
    flush();
    expect(page.container.textContent).toBe("p0" + "1" + "p1" + "1");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Arm (b): a sync the drain did not trigger, in the same window. One
  // occurrence and a live hole; the record executes and the parser finishes
  // while the defer is armed; a live hole op then lands — the pump's read is
  // a microtask, the drain a macrotask — and its `host.apply` syncs the frame
  // over the undrained record. That sync must defer the occurrence; the
  // drain's apply mounts it. (The pump's catch-up read over ops logged
  // before adoption is the same sync from the other side of adoption —
  // `harness/replay.spec.tsx`'s third C18 pin.)
  test("(b) a live op syncs the frame between the parser's end and the drain: the occurrence defers, then claims with its args", async () => {
    const fid = freshFid("c18b");
    const parserDone = parserRunning();
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", liveFillHtml(fid, "item#0", "p0"))}</ul><p>${holeHtml(
          18,
          "hole-v0"
        )}</p>`
      )
    );
    const serverLi = page.container.querySelector("li")!;
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    const invoked: string[] = [];
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            invoked.push(untrack(() => p.text));
            return (
              <li>
                {p.text}
                {tick()}
              </li>
            );
          }}
        />
      ),
      page.container
    );
    expect(invoked).toEqual([]);

    page.slotRecord(fid, "item#0", { text: "p0" });
    parserDone();
    // The live op's sync lands on the pump's microtask read — before the
    // deferred drain's macrotask.
    page.live.push({ type: "hole", key: "lh:18", html: "hole-v1" });
    await microtasks(4);
    expect(page.container.querySelector("p")!.textContent).toBe("hole-v1");
    expect(invoked).toEqual([]);

    await quiesce();
    await quiesce();
    expect(invoked).toEqual(["p0"]);
    expect(page.container.querySelector("li")).toBe(serverLi);
    expect(page.container.textContent).toBe("p0" + "0" + "hole-v1");
    setTick(1);
    flush();
    expect(page.container.textContent).toBe("p0" + "1" + "hole-v1");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });

  // Control: a tick between the two records — the drain runs while the
  // parser is still owed the second, every sync reads `recordsPending()`
  // true through the parser's term alone. Green before and after 3.5.
  test("control: a drain per record while the parser is still running classifies nothing early", async () => {
    const fid = freshFid("c18c");
    const parserDone = parserRunning();
    page = bootPage(
      frameHtml(
        fid,
        `<ul>${slotRange("item#0", liveFillHtml(fid, "item#0", "p0"))}${slotRange(
          "item#1",
          liveFillHtml(fid, "item#1", "p1")
        )}</ul>`
      )
    );
    const Comp = (globalThis as any)._$SC.r(fid);
    const [tick, setTick] = createSignal(0);
    const invoked: string[] = [];
    const dispose = hydrate(
      () => (
        <Comp
          item={(p: { text: string }) => {
            invoked.push(untrack(() => p.text));
            return (
              <li>
                {p.text}
                {tick()}
              </li>
            );
          }}
        />
      ),
      page.container
    );
    page.slotRecord(fid, "item#0", { text: "p0" });
    await quiesce();
    expect(invoked).toEqual(["p0"]);
    page.slotRecord(fid, "item#1", { text: "p1" });
    parserDone();
    await quiesce();
    await quiesce();
    expect(invoked).toEqual(["p0", "p1"]);
    setTick(1);
    flush();
    expect(page.container.textContent).toBe("p0" + "1" + "p1" + "1");
    expect(page.warnings).toEqual([]);
    expect(page.errors).toEqual([]);
    dispose();
  });
});
