/**
 * @jsxImportSource @solidjs/web
 *
 * `runScenario`: build the page a scenario describes (with `support.ts`'s
 * `bootPage` — the production host, the shipped document runtime, the real
 * hydration), schedule its events, check the oracle after each, return the
 * trace. One document page per run; module-level state the runtime keeps
 * across pages (the fragment ledger, the live-op log, the boundary index)
 * is namespaced by a per-run counter where it is keyed by name.
 */
import { vi } from "vitest";
import { createSignal, flush, untrack } from "solid-js";
import { hydrate } from "@solidjs/web";
import { getFrameHost, installServerComponents } from "../../../frames/src/client.js";
import {
  bootPage,
  fillHtml,
  fillHtml2,
  frameHtml,
  freshFid,
  holeHtml,
  hydrationInProgress,
  macrotask,
  microtasks,
  onHydrationEnd,
  placeholderHtml,
  quiesce,
  slotRange,
  traceMarker
} from "../support.js";
import { end, immediate, liveRanges, settled, type Finding, type World } from "./oracle.js";
import { describeScenario, type Event, type Scenario } from "./scenario.js";

export interface Step {
  step: number;
  event: Event | { t: "end" };
  findings: Finding[];
}

export interface RunResult {
  scenario: Scenario;
  description: string;
  findings: Finding[];
  trace: Step[];
  /** The page's console output, for diagnosis. */
  warnings: string[];
}

let runCounter = 0;
let holeCounter = 0;

/**
 * On a branch whose materializer loads lazily, warm it once so trace args
 * read synchronously at claim (the pins do the same; see C11's
 * `readyMaterializer`). A no-op where the materializer is resident.
 */
let materializerReady: Promise<void> | undefined;
async function readyMaterializer() {
  if (!materializerReady) {
    materializerReady = (async () => {
      installServerComponents();
      const host: any = getFrameHost();
      await host.prepareArgs?.({ probe: traceMarker().marker });
      delete (globalThis as any)._$SC;
    })();
  }
  await materializerReady;
}

export async function runScenario(scenario: Scenario): Promise<RunResult> {
  await readyMaterializer();
  const run = ++runCounter;
  const fid = freshFid("fuzz");
  const fragKey = (i: number) => `fz${run}-${scenario.fragments[i].key}`;
  const holeId = scenario.liveHole ? ++holeCounter : -1;

  // --- the page -----------------------------------------------------------
  const labelAt0 = (occ: number) => {
    const o = scenario.occurrences[occ];
    return o.arg.kind === "plain" ? `p${occ}` : `t${occ}=${o.arg.snapshot}`;
  };
  const rangeHtml = (occ: number) => {
    const o = scenario.occurrences[occ];
    if (o.kind === "direct") return slotRange("children", fillHtml(fid, "children", "0", "b"));
    return slotRange(o.name, fillHtml2(fid, o.name, labelAt0(occ), "0"));
  };
  const rootRanges = scenario.occurrences
    .map((o, i) => (o.inFragment === null ? rangeHtml(i) : ""))
    .join("");
  const placeholders = scenario.fragments
    .map((f, i) => placeholderHtml(fragKey(i), `<i>${f.fallback}</i>`))
    .join("");
  const hole = scenario.liveHole ? `<p>${holeHtml(holeId, "hole-v0")}</p>` : "";
  const page = bootPage(frameHtml(fid, `<ul>${rootRanges}${placeholders}</ul>${hole}`));
  scenario.fragments.forEach((_, i) => page.declareFragment(fragKey(i)));
  // The producer DECLARES a render occurrence's record at its marker (frames
  // A4, S-record): a pending value under the record's key, written with the
  // markup that carries the range — the shell for a root occurrence, the
  // fragment for one inside it — and settled by the record's own data
  // script. The `record` event is that settle; a record event ahead of its
  // fragment's reveal (an order the client tolerates, never the producer's)
  // declares and settles in one script.
  const declared = new Map<number, ReturnType<typeof page.declareSlotRecord>>();
  const declare = (i: number) => {
    if (scenario.occurrences[i].kind !== "render" || declared.has(i)) return;
    declared.set(i, page.declareSlotRecord(fid, scenario.occurrences[i].name));
  };
  scenario.occurrences.forEach((o, i) => o.inFragment === null && declare(i));
  const traces = new Map<number, ReturnType<typeof traceMarker>>();
  scenario.occurrences.forEach((o, i) => {
    if (o.arg.kind !== "trace") return;
    const tr = traceMarker();
    tr.snapshot({ id: `t${i}`, n: o.arg.snapshot });
    traces.set(i, tr);
  });

  const world: World = {
    scenario,
    fid,
    container: page.container,
    warnings: page.warnings,
    errors: page.errors,
    step: -1,
    invoked: new Map(),
    invokedAt: new Map(),
    firstPatchAt: new Map(),
    bootNodes: new Map(),
    revealed: new Map(),
    hydratedAt: -1,
    disposedAt: -1,
    invokedAfterDispose: [],
    appliedAfterDispose: 0,
    zeroArgCalls: 0,
    hostHas: () => !!page.host.get(fid),
    hydrationInProgress,
    traceN: new Map(),
    holeId,
    holeHistory: ["hole-v0"],
    bumped: false
  };
  const collectBootNodes = (root: ParentNode) => {
    for (const el of root.querySelectorAll("[_hk]")) {
      const hk = el.getAttribute("_hk")!;
      if (!world.bootNodes.has(hk)) world.bootNodes.set(hk, el);
    }
  };
  collectBootNodes(page.container);
  page.container.addEventListener("frame:applied", () => {
    if (world.disposedAt >= 0) world.appliedAfterDispose++;
  });

  // --- the client ---------------------------------------------------------
  const [tick, setTick] = createSignal(0);
  const label = (p: any) => {
    if (p.text !== undefined) return p.text;
    const d = p.data;
    return `${d.id}=${d.n}`;
  };
  const idOf = (p: any) => {
    try {
      return p.text !== undefined ? p.text : p.data.id;
    } catch {
      return "?";
    }
  };
  // `p<i>`/`t<i>` → the occurrence's name (the label's digit is its index).
  const nameOf = (id: string) => scenario.occurrences[Number(id.slice(1))]?.name ?? id;
  const fill = (p: any) => {
    if (p === undefined) {
      // A render prop evaluated as a zero-arg accessor: the frame classified
      // this occurrence as direct-insert. A real fill reads props here and
      // halts the reactive system; the harness records the misclassification
      // (C18) and returns inert content so the other laws stay readable.
      world.zeroArgCalls++;
      if (world.disposedAt >= 0) world.invokedAfterDispose.push("?");
      return <li>misclassified</li>;
    }
    // A one-time identification read (which occurrence this is); untracked
    // on purpose — a top-level fill read is otherwise a STRICT_READ diagnostic.
    const name = nameOf(untrack(() => idOf(p)));
    world.invoked.set(name, (world.invoked.get(name) ?? 0) + 1);
    if (!world.invokedAt.has(name)) world.invokedAt.set(name, world.step);
    if (world.disposedAt >= 0) world.invokedAfterDispose.push(name);
    return (
      <li>
        {label(p)}
        {tick()}
      </li>
    );
  };
  const hasChildren = scenario.occurrences.some(o => o.kind === "direct");
  let dispose: (() => void) | undefined;
  const mount = () => {
    const Comp = (globalThis as any)._$SC.r(fid);
    dispose = hydrate(
      () =>
        hasChildren ? (
          <Comp item={fill}>
            <b>{tick()}</b>
          </Comp>
        ) : (
          <Comp item={fill} />
        ),
      page.container
    );
    onHydrationEnd(() => {
      const mountedButUninvoked: string[] = [];
      for (const r of liveRanges(page.container)) {
        const o = scenario.occurrences.find(x => x.name === r.name);
        if (o && o.kind === "render" && r.elements.length && !(world.invoked.get(o.name) ?? 0))
          mountedButUninvoked.push(o.name);
      }
      world.hydrationEnd = { step: world.step, mountedButUninvoked };
    });
  };

  // --- the parser's clock -------------------------------------------------
  // The document is still parsing while records/reveals are owed (that is
  // what makes a recordless occurrence defer, #2968); restored after the
  // last one has run.
  const owed = scenario.events.filter(e => e.t === "record" || e.t === "reveal").length;
  let ran = 0;
  let readyState: ReturnType<typeof vi.spyOn> | undefined;
  if (owed) readyState = vi.spyOn(document, "readyState", "get").mockReturnValue("loading") as any;
  const owedDone = () => {
    if (++ran === owed && readyState) {
      readyState.mockRestore();
      readyState = undefined;
    }
  };

  // --- the schedule -------------------------------------------------------
  const trace: Step[] = [];
  const findings: Finding[] = [];
  const check = (event: Event | { t: "end" }, fs: Finding[]) => {
    trace.push({ step: world.step, event, findings: fs });
    findings.push(...fs);
  };
  const perform = async (e: Event) => {
    switch (e.t) {
      case "hydrate":
        world.hydratedAt = world.step;
        mount();
        break;
      case "record": {
        const o = scenario.occurrences[e.occ];
        const args =
          o.arg.kind === "plain" ? { text: `p${e.occ}` } : { data: traces.get(e.occ)!.marker };
        declare(e.occ);
        declared.get(e.occ)!.settle(args);
        owedDone();
        break;
      }
      case "reveal": {
        const html = scenario.occurrences
          .map((o, i) => (o.inFragment === e.frag ? rangeHtml(i) : ""))
          .join("");
        // The fragment carries its occurrences' declarations (ahead of the
        // swap, as the producer orders its one task batch).
        scenario.occurrences.forEach((o, i) => o.inFragment === e.frag && declare(i));
        page.revealFragment(fragKey(e.frag), html);
        world.revealed.set(e.frag, world.step);
        collectBootNodes(page.container);
        owedDone();
        break;
      }
      case "trace": {
        const o = scenario.occurrences[e.occ];
        if (o.arg.kind !== "trace") break;
        const n = (world.traceN.get(e.occ) ?? o.arg.snapshot) + o.arg.patches[e.patch];
        world.traceN.set(e.occ, n);
        if (!world.firstPatchAt.has(e.occ)) world.firstPatchAt.set(e.occ, world.step);
        traces.get(e.occ)!.patch([[["n"], n]]);
        break;
      }
      case "live":
        world.holeHistory.push(e.html);
        page.live.push({ type: "hole", key: `lh:${holeId}`, html: e.html });
        break;
      case "tick":
        flush();
        await macrotask();
        flush();
        break;
      case "micro":
        await microtasks(1);
        break;
      case "dispose":
        world.disposedAt = world.step;
        dispose && dispose();
        dispose = undefined;
        break;
    }
  };
  try {
    for (const e of scenario.events) {
      world.step++;
      await perform(e);
      const fs = immediate(world);
      if (e.t === "tick") fs.push(...settled(world));
      check(e, fs);
    }
    world.step++;
    await quiesce();
    await quiesce();
    const fs = [...immediate(world), ...settled(world)];
    if (world.disposedAt < 0) {
      setTick(1);
      flush();
      world.bumped = true;
    }
    fs.push(...end(world));
    check({ t: "end" }, fs);
  } finally {
    readyState?.mockRestore();
    dispose && dispose();
    for (const tr of traces.values()) tr.end();
    await page.cleanup();
  }
  return {
    scenario,
    description: describeScenario(scenario),
    findings,
    trace,
    warnings: [...page.warnings]
  };
}
