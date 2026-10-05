/**
 * @jsxImportSource @solidjs/web
 *
 * Shared fixture for the container-trace HOLD specs (the lazy materializer,
 * document face): a server component whose slot calls interleave two
 * trace-carrying fills with two ordinary ones, followed by a keyed sibling.
 *
 * The page as the server left it — `renderToStream` with the frame sink,
 * `frameTransformDirectResult(thread, { id: FID })` rendered inline at t=0:
 *
 * ```tsx
 * const thread = (props) => {
 *   const u1 = createProjection(async function* (d) { d.name = "Ada"; yield; }, { name: "" });
 *   const u2 = createProjection(async function* (d) { d.name = "Grace"; yield; }, { name: "" });
 *   return (
 *     <ul class="thread">
 *       <li><props.comment $key="c1" cid="c1" user={u1} /></li>
 *       <li><props.note text="n1" /></li>
 *       <li><props.comment $key="c2" cid="c2" user={u2} /></li>
 *       <li><props.note text="n2" /></li>
 *     </ul>
 *   );
 * };
 * // page
 * <>
 *   <After text={label()} />
 *   <Inline comment={commentFill} note={noteFill} />
 *   <After text={label()} />
 * </>
 * ```
 *
 * `$key` names the calls because the sink's structural-repeat probe reads a
 * pending projection's keys (a pre-existing server-side finding, noted in
 * the review report). The fills below are the exact JSX the server ran, so
 * the `_hk` chains in FRAME_HTML are what they mint. Records are rebuilt
 * from the server's data script by hand (seroval streams for the traces,
 * settled `_fr` stamps for the fills' inline boundaries) so the specs can
 * decide WHEN each trace emits.
 */
import { expect, vi } from "vitest";
import { createStream } from "seroval";
import { createSignal, flush, Loading, untrack } from "solid-js";
import { materializeContainerTrace } from "solid-js/internal/container-trace";
import { createFrameHost } from "../../frames/src/client.js";
import { createJSONDataTable } from "../../serialization/src/serializer.js";
import {
  isMaterializedContainer,
  needsContainerTraceMaterializer,
  reviveContainerTraces,
  setContainerTraceMaterializer
} from "../../frames/src/frame-container-plugin.js";

/**
 * The server rendered under `hold/thread`; a spec picks its own fid per
 * test (the frames client remembers claimed boundaries per worker, and
 * solid's fragment ledger keys by hydration id), and every key below is
 * rebuilt from it — fids only ever appear inside prefix-scoped keys.
 */
export const FID = "hold/thread";

/**
 * The server's markup, in the three pieces the page emitted (scripts
 * stripped): a keyed sibling BEFORE the frame (`_hk=0`), the frame, and a
 * keyed sibling AFTER it. The server consumed two root ids for the
 * component (`NoHydration`'s owner and the slot props' zone), so the
 * trailing sibling is `_hk=3`. Specs compose the page they need; the frame's
 * own keys are prefix-scoped (`sc-<fid>-<occurrence>-`) and the same in any
 * composition.
 */
export const P_BEFORE = `<p _hk=0 class="after">after</p>`;
export const frameHtml = (fid: string = FID) =>
  `<solid-frame data-fid="${fid}" style="display:contents"><ul class="thread">` +
  `<li><!--slot:comment#c1:start--><div _hk=sc-${fid}-comment#c1-0 class="c"><b>c1</b><!--$--><span _hk=sc-${fid}-comment#c1-2000 class="name">Ada</span><!--/--><button>0</button></div><!--slot:comment#c1:end--></li>` +
  `<li><!--slot:note#0:start--><em _hk=sc-${fid}-note#0-0>n1</em><!--slot:note#0:end--></li>` +
  `<li><!--slot:comment#c2:start--><div _hk=sc-${fid}-comment#c2-0 class="c"><b>c2</b><!--$--><span _hk=sc-${fid}-comment#c2-2000 class="name">Grace</span><!--/--><button>0</button></div><!--slot:comment#c2:end--></li>` +
  `<li><!--slot:note#1:start--><em _hk=sc-${fid}-note#1-0>n2</em><!--slot:note#1:end--></li>` +
  `</ul></solid-frame>`;
export const FRAME_HTML = frameHtml();
export const P_AFTER = `<p _hk=3 class="after">after</p>`;

export const traceState = () =>
  (globalThis as any)[Symbol.for("solid.container-trace-state")] as
    | { materializeTrace?: Function }
    | undefined;

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** A settled `_fr` stamp, as the document's data script leaves one. */
function settledFragment() {
  const fr: any = Promise.resolve(true);
  fr.s = 1;
  fr.v = true;
  return fr;
}

export interface Streams {
  c1: any;
  c2: any;
}

/**
 * Install `_$HY` with the page's records. The traces are the caller's
 * streams: `emit` decides which snapshots the document already delivered
 * before hydration starts (the default: both, as the server's script does).
 */
export function installRecords(
  options: { fid?: string; emit?: (s: Streams) => void; hy?: Record<string, any> } = {}
): Streams {
  const fid = options.fid ?? FID;
  const streams: Streams = { c1: createStream(), c2: createStream() };
  (globalThis as any)._$HY = {
    events: [],
    completed: new WeakSet(),
    fe() {},
    ...options.hy,
    r: {
      [`sc:slot:${fid}:comment#c1`]: { cid: "c1", user: { $tr: streams.c1, $ta: 0 } },
      [`sc:slot:${fid}:note#0`]: { text: "n1" },
      [`sc:slot:${fid}:comment#c2`]: { cid: "c2", user: { $tr: streams.c2, $ta: 0 } },
      [`sc:slot:${fid}:note#1`]: { text: "n2" },
      [`sc-${fid}-comment#c1-2_fr`]: settledFragment(),
      [`sc-${fid}-comment#c2-2_fr`]: settledFragment()
    }
  };
  if (options.emit) options.emit(streams);
  else {
    streams.c1.next({ name: "Ada" });
    streams.c2.next({ name: "Grace" });
    streams.c1.return(undefined);
    streams.c2.return(undefined);
  }
  return streams;
}

/**
 * A stand-in for the hydration runtime's fragment ledger (`_$HY.fr`): what
 * the frames client subscribes to for reveals. Two uses here — a reveal
 * re-indexes boundary elements (the frames client indexes the document ONCE
 * per worker, so a second page in the same worker is invisible to
 * `findBoundaryElement` until a reveal rescans), and a reveal re-drains the
 * adopted boundary's records (the #2978 cascade), which item 4 exercises.
 */
export function fakeLedger() {
  const subs: ((id: string, parent?: ParentNode) => void)[] = [];
  return {
    ledger: {
      subscribe(cb: (id: string, parent?: ParentNode) => void) {
        subs.push(cb);
        return () => {
          const i = subs.indexOf(cb);
          if (i >= 0) subs.splice(i, 1);
        };
      },
      pending: () => false,
      claim() {},
      release() {}
    },
    reveal(parent: ParentNode) {
      for (const cb of [...subs]) cb("reveal", parent);
    },
    get subscribers() {
      return subs.length;
    }
  };
}

export function mountShell(html: string = P_BEFORE + FRAME_HTML): HTMLDivElement {
  const container = document.createElement("div");
  container.innerHTML = html;
  document.body.appendChild(container);
  return container;
}

/** The fills, verbatim from the server render (see the header). */
export const mounts: { comment: string[]; note: string[]; stores: any[] } = {
  comment: [],
  note: [],
  stores: []
};
export const commentFill = (p: any) => {
  mounts.comment.push(untrack(() => p.cid));
  mounts.stores.push(untrack(() => p.user));
  const [n, setN] = createSignal(0);
  return (
    <div class="c">
      <b>{p.cid}</b>
      <Loading fallback={<i>…</i>}>
        <span class="name">{p.user.name}</span>
      </Loading>
      <button onClick={() => setN(n() + 1)}>{n()}</button>
    </div>
  );
};
export const noteFill = (p: any) => {
  mounts.note.push(untrack(() => p.text));
  return <em>{p.text}</em>;
};
export const After = (props: { text: string }) => <p class="after">{props.text}</p>;

export function resetMounts() {
  mounts.comment.length = 0;
  mounts.note.length = 0;
  mounts.stores.length = 0;
}

/** Does a record's args tree carry a trace marker (the host's own check)? */
function carriesMarker(value: any): boolean {
  if (value == null || typeof value !== "object") return false;
  if (value.$tr != null) return true;
  for (const key in value) if (carriesMarker(value[key])) return true;
  return false;
}

/**
 * A host wired like the production one (revive at arg-read, container
 * identity) whose materializer LOAD is the test's to settle: `prepareArgs`
 * answers a trace-carrying record with `gate` until `release()` installs
 * the materializer and resolves it. `asks` counts the prepare calls.
 *
 * Default: the production predicate (`needsContainerTraceMaterializer`,
 * false once installed — so one hold per worker, the real thing). `force`:
 * the host's own marker check, so a spec can hold again after an earlier
 * test installed the materializer; the frame sees the same promise either
 * way, and revival still only runs when the hold lifts (`#resolveArgs` is
 * past the hold).
 */
export function makeGatedHost(options: { force?: boolean } = {}) {
  const table = createJSONDataTable();
  let resolveGate!: () => void;
  const gate = new Promise<void>(r => (resolveGate = r));
  const state = { asks: 0, released: false };
  const host = createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r),
    revive: reviveContainerTraces,
    isContainer: isMaterializedContainer,
    prepareArgs: (args: any) => {
      if (state.released) return undefined;
      if (!(options.force ? carriesMarker(args) : needsContainerTraceMaterializer(args)))
        return undefined;
      state.asks++;
      return gate;
    }
  });
  const release = async () => {
    state.released = true;
    setContainerTraceMaterializer(materializeContainerTrace);
    resolveGate();
    // The frame's re-sync runs on the gate's continuation; give it the
    // microtasks and a flush.
    for (let i = 0; i < 10; i++) {
      await Promise.resolve();
      flush();
    }
  };
  return { host, release, state };
}

/** The resident configuration: materializer installed before hydrate(). */
export function makeResidentHost() {
  const table = createJSONDataTable();
  setContainerTraceMaterializer(materializeContainerTrace);
  return createFrameHost({
    applyData: (c: any) => table.apply(c),
    resolve: (r: any) => table.resolve(r),
    revive: reviveContainerTraces,
    isContainer: isMaterializedContainer
  });
}

export function captureWarnings() {
  const warnings: string[] = [];
  vi.spyOn(console, "warn").mockImplementation((...args: any[]) => {
    warnings.push(args.map(String).join(" "));
  });
  vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
    warnings.push(args.map(String).join(" "));
  });
  return warnings;
}

/** Every server node of the page, in document order, for identity checks. */
export function snapshotNodes(container: HTMLElement, fid: string = FID) {
  return {
    c1: container.querySelector(`[_hk="sc-${fid}-comment#c1-0"]`)!,
    c1name: container.querySelector(`[_hk="sc-${fid}-comment#c1-2000"]`)!,
    c2: container.querySelector(`[_hk="sc-${fid}-comment#c2-0"]`)!,
    c2name: container.querySelector(`[_hk="sc-${fid}-comment#c2-2000"]`)!,
    n0: container.querySelector(`[_hk="sc-${fid}-note#0-0"]`)!,
    n1: container.querySelector(`[_hk="sc-${fid}-note#1-0"]`)!,
    before: container.querySelector("p.after")!
  };
}

/** The claim held: the same nodes, once each, nothing fresh beside them. */
export function expectClaimed(
  container: HTMLElement,
  before: ReturnType<typeof snapshotNodes>,
  fid: string = FID
) {
  const now = snapshotNodes(container, fid);
  for (const key of Object.keys(before) as (keyof typeof before)[]) {
    expect(now[key], key).toBe(before[key]);
  }
  expect(container.querySelectorAll(".c").length).toBe(2);
  expect(container.querySelectorAll("em").length).toBe(2);
  expect(container.querySelectorAll("span.name").length).toBe(2);
  expect(container.querySelector("i")).toBe(null);
}

export function cleanupHold() {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (globalThis as any)._$HY;
  delete (globalThis as any)._$SC;
  delete (globalThis as any).$R;
  document.body.innerHTML = "";
  resetMounts();
}
