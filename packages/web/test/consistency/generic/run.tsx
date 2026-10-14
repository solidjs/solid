/**
 * @jsxImportSource @solidjs/web
 *
 * The runner and oracle of the generic (frames-free) hydration harness.
 * One scenario = one page (test/harness/generic-hydration.tsx, as the
 * server rendered it) driven through `hydrate()` and the real stream chunks
 * under the scenario's schedule, with the contract's plain-hydration laws
 * checked after every event:
 *
 *   immediate — G no-runtime-error; C1 no-key-miss / no-unclaimed /
 *               node-identity / no-duplicate; C14 dispose-no-invoke /
 *               dispose-no-dom; C3 in-progress-until-done
 *   settled   — C12 fragment-parity; C19 claim-shows-value (shell and each
 *               resumed boundary show the value their sources read)
 *   end       — C3 done-counts-holds; C2 every-range-live /
 *               every-range-reactive; E queued-click-replays-once
 *
 * `_hydrationDone` is a worker-level latch: every case after the first in
 * a worker runs in the post-done regime (a reveal before `hydrate()` is
 * held by the ledger and replayed at the boundary's registration), the
 * first case pre-done (the reveal swaps at once). Both are legal pages.
 */
import { flush, untrack } from "solid-js";
import { hydrate } from "@solidjs/web";
import { createGenericApp, type GenericApp } from "../../harness/generic-hydration.jsx";
import { describeScenario, type Event, type Scenario, type Side } from "./scenario.js";
import {
  applyChunk,
  bootHy,
  hydrationInProgress,
  installBootstrapCapture,
  loadArtifact,
  macrotask,
  microtask,
  onHydrationEnd,
  quiesce,
  revealedKey,
  spyConsole,
  textOf
} from "./support.js";

export interface Finding {
  id: string;
  law: string;
  step: number;
  detail: string;
}

export interface RunResult {
  scenario: Scenario;
  description: string;
  findings: Finding[];
}

const SIDES: Side[] = ["a", "b"];

interface World {
  scenario: Scenario;
  container: HTMLDivElement;
  app: GenericApp;
  step: number;
  hydratedAt: number;
  disposedAt: number;
  /** Side → step of the chunk that revealed its fragment. */
  revealedAt: Map<Side, number>;
  /** Side → the server-rendered `<section>` (captured at its reveal). */
  serverNode: Map<Side, Element>;
  /** Side → clicks the schedule dispatched on its button. */
  dispatched: Map<Side, number>;
  clicksAtDispose: number;
  invocationsAtDispose: number;
  textAtDispose: string | null;
  warningsSeen: number;
  errorsSeen: number;
  hydrationEnd?: { step: number; invocations: string[]; disposed: boolean };
  findings: Finding[];
}

function sel(w: World, s: string) {
  return w.container.querySelector(s);
}
function count(w: World, s: string) {
  return w.container.querySelectorAll(s).length;
}
function find(w: World, id: string, law: string, detail: string) {
  w.findings.push({ id, law, step: w.step, detail });
}

/** Read an accessor untracked; `undefined` when it throws (a pending async read). */
function peek<T>(fn: (() => T) | undefined): T | undefined {
  if (!fn) return undefined;
  try {
    return untrack(fn);
  } catch {
    return undefined;
  }
}

function immediateLaws(w: World, warnings: string[], errors: string[]) {
  for (; w.errorsSeen < errors.length; w.errorsSeen++)
    find(w, "G", "no-runtime-error", errors[w.errorsSeen].slice(0, 160));
  for (; w.warningsSeen < warnings.length; w.warningsSeen++) {
    const msg = warnings[w.warningsSeen];
    if (msg.includes("Hydration key miss")) find(w, "C1", "no-key-miss", msg.slice(0, 160));
    else if (msg.includes("unclaimed server-rendered"))
      find(w, "C1", "no-unclaimed", msg.slice(0, 160));
    else find(w, "G", "no-runtime-error", "warn: " + msg.slice(0, 160));
  }
  for (const side of SIDES) {
    const live = sel(w, `section.${side}`);
    const server = w.serverNode.get(side);
    if (live && server && live !== server)
      find(w, "C1", "node-identity", `section.${side} is a fresh node, not the server's`);
    if (count(w, `section.${side}`) > 1) find(w, "C1", "no-duplicate", `two section.${side}`);
    if (count(w, `p.fb.${side}`) > 1) find(w, "C1", "no-duplicate", `two fallbacks for ${side}`);
    // The reveal removed the server fallback with the placeholder range; a
    // fallback showing after it is fresh client DOM over settled markup.
    const fb = sel(w, `p.fb.${side}`);
    if (w.revealedAt.has(side) && w.disposedAt < 0 && fb && !fb.hasAttribute("_hk"))
      find(
        w,
        "C9",
        "no-fallback-over-settled",
        `${side}: client fallback replaced the settled content`
      );
  }
  if (w.disposedAt >= 0 && w.step > w.disposedAt) {
    if (w.app.invocations.length !== w.invocationsAtDispose)
      find(w, "C14", "dispose-no-invoke", `Side ran after dispose`);
    const text = w.container.textContent;
    if (text !== w.textAtDispose)
      find(w, "C14", "dispose-no-dom", `page text changed after dispose: ${text}`);
  }
  if (w.hydratedAt >= 0 && w.disposedAt < 0 && !w.hydrationEnd && !hydrationInProgress())
    find(w, "C3", "in-progress-until-done", "isHydrationInProgress() false before hydration end");
}

function settledLaws(w: World) {
  if (w.hydratedAt < 0 || w.disposedAt >= 0) return;
  const { app } = w;
  const path = peek(app.path)!;
  const label = peek(app.label)!;
  const shared = peek(app.shared());
  const items = [...app.store.items];
  if (textOf(sel(w, "h1")) !== label)
    find(w, "C19", "claim-shows-memo", `shell h1 ${textOf(sel(w, "h1"))} ≠ ${label}`);
  if (textOf(sel(w, "h2")) !== path)
    find(w, "C19", "claim-shows-signal", `shell h2 ${textOf(sel(w, "h2"))} ≠ ${path}`);
  for (const side of SIDES) {
    const revealed = w.revealedAt.has(side);
    const section = sel(w, `section.${side}`);
    const fallback = sel(w, `p.fb.${side}`);
    if (revealed) {
      if (!section) find(w, "C12", "fragment-parity", `${side} revealed but no content`);
      if (fallback) find(w, "C12", "fragment-parity", `${side} revealed but fallback shows`);
    } else {
      if (section) find(w, "C12", "fragment-parity", `${side} not revealed but content shows`);
      if (!fallback) find(w, "C12", "fragment-parity", `${side} not revealed but no fallback`);
    }
    if (!section) continue;
    const raw = textOf(section.querySelector(".raw"));
    const lab = textOf(section.querySelector(".label"));
    const sh = textOf(section.querySelector(".shared"));
    const lis = [...section.querySelectorAll("li")].map(l => l.textContent);
    if (raw !== path) find(w, "C19", "claim-shows-signal", `${side}.raw ${raw} ≠ signal ${path}`);
    if (lab !== label) find(w, "C19", "claim-shows-memo", `${side}.label ${lab} ≠ memo ${label}`);
    if (typeof shared === "string" && sh !== shared)
      find(w, "C19", "claim-shows-async-memo", `${side}.shared ${sh} ≠ async memo ${shared}`);
    if (lis.join(",") !== items.join(","))
      find(w, "C19", "claim-shows-store-list", `${side} list [${lis}] ≠ store [${items}]`);
  }
}

async function endLaws(w: World) {
  const { app } = w;
  const end = w.hydrationEnd;
  if (w.hydratedAt >= 0 && !end && w.disposedAt < 0)
    find(w, "C3", "done-counts-holds", "hydration never reported done");
  if (end && !end.disposed) {
    for (const side of SIDES)
      if (!end.invocations.includes(side))
        find(w, "C3", "done-counts-holds", `done @${end.step} before ${side} claimed`);
  }
  for (const side of SIDES) {
    const got = app.clicks.filter(c => c === side).length;
    const sent = w.dispatched.get(side) ?? 0;
    if (w.disposedAt < 0) {
      if (got !== sent)
        find(w, "E", "queued-click-replays-once", `${side}: ${sent} clicks, ${got} handled`);
    } else if (got > sent)
      find(w, "E", "queued-click-replays-once", `${side}: handled more than sent`);
  }
  if (w.hydratedAt < 0 || w.disposedAt >= 0) return;
  for (const side of SIDES) {
    const n = app.invocations.filter(i => i === side).length;
    if (w.revealedAt.has(side) && n !== 1)
      find(w, "C2", "every-range-live", `${side} invoked ${n} times`);
  }
  // reactivity probe — the write re-runs the shell's async `shared` memo,
  // which holds the write (and every reader of `path`) until it lands
  // (15ms): wait it out before reading.
  app.setPath("/z");
  flush();
  await new Promise(r => setTimeout(r, 30));
  flush();
  if (textOf(sel(w, "h2")) !== "/z")
    find(w, "C2", "every-range-reactive", "shell h2 did not react");
  for (const side of SIDES) {
    const section = sel(w, `section.${side}`);
    if (!section) continue;
    if (textOf(section.querySelector(".raw")) !== "/z")
      find(w, "C2", "every-range-reactive", `${side}.raw did not react`);
    if (textOf(section.querySelector(".label")) !== "label:/z")
      find(w, "C2", "every-range-reactive", `${side}.label did not react`);
  }
}

export async function runScenario(scenario: Scenario): Promise<RunResult> {
  const art = loadArtifact(scenario.order);
  const hy = bootHy();
  const spies = spyConsole();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const uncapture = installBootstrapCapture(container);
  const app = createGenericApp(scenario.order);
  const w: World = {
    scenario,
    container,
    app,
    step: -1,
    hydratedAt: -1,
    disposedAt: -1,
    revealedAt: new Map(),
    serverNode: new Map(),
    dispatched: new Map(),
    clicksAtDispose: 0,
    invocationsAtDispose: 0,
    textAtDispose: null,
    warningsSeen: 0,
    errorsSeen: 0,
    findings: []
  };
  let dispose: (() => void) | undefined;
  // GENERIC_DEBUG=1: the page (templates elided) and the sources after every step.
  const dump = (label: string) => {
    if (!process.env.GENERIC_DEBUG) return;
    const html = container.innerHTML.replace(/<template[\s\S]*?<\/template>/g, "<tpl/>");
    console.log(
      `${label}: ${html.slice(0, 700)}\n   path=${peek(app.path)} label=${peek(app.label)} shared=${peek(app.shared())} items=${app.store.items} clicks=${app.clicks} inv=${app.invocations} queued=${hy.events?.length} inProgress=${hydrationInProgress()} end=${JSON.stringify(w.hydrationEnd)}`
    );
  };
  applyChunk(container, art.shell, true);
  // Which fragment key belongs to which boundary: the `pl-K` template that
  // precedes each fallback in the shell.
  const keyToSide = new Map<string, Side>();
  for (const side of SIDES) {
    const fb = container.querySelector(`p.fb.${side}`);
    const pl = fb?.previousElementSibling as HTMLTemplateElement | null;
    if (pl && pl.id.startsWith("pl-")) keyToSide.set(pl.id.slice(3), side);
  }

  const run = async (e: Event) => {
    switch (e.t) {
      case "hydrate":
        w.hydratedAt = w.step;
        dispose = hydrate(() => <app.App />, container);
        onHydrationEnd(() => {
          w.hydrationEnd = {
            step: w.step,
            invocations: [...app.invocations],
            disposed: w.disposedAt >= 0
          };
        });
        break;
      case "chunk": {
        const chunk = art.chunks[e.i];
        applyChunk(container, chunk);
        const key = revealedKey(chunk);
        const side = key && keyToSide.get(key);
        if (side) {
          // the section is in the live tree (swapped) or still in its
          // template (held by the ledger until a claimant registers)
          const tpl = container.querySelector(
            `template[id="${key}"]`
          ) as HTMLTemplateElement | null;
          const section =
            container.querySelector(`section.${side}`) ??
            tpl?.content.querySelector("section") ??
            null;
          w.revealedAt.set(side, w.step);
          if (section) w.serverNode.set(side, section);
          else
            find(
              w,
              "G",
              "no-runtime-error",
              `chunk ${e.i} revealed ${key} but no section for ${side}`
            );
        }
        break;
      }
      case "write":
        app.setPath("/b");
        break;
      case "push":
        app.pushItem("i2");
        break;
      case "click": {
        const btn = container.querySelector(`section.${e.side} button`);
        if (btn) {
          btn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          w.dispatched.set(e.side, (w.dispatched.get(e.side) ?? 0) + 1);
        }
        break;
      }
      case "tick":
        // a settle point: long enough for a client async re-run (`shared`,
        // 15ms) to land, so the laws read a quiescent page
        flush();
        await new Promise(r => setTimeout(r, 20));
        flush();
        break;
      case "micro":
        await microtask();
        break;
      case "dispose":
        // before the call: a disposal that completes hydration drains the
        // end callbacks synchronously, and the snapshot must read "disposed"
        w.disposedAt = w.step;
        w.clicksAtDispose = app.clicks.length;
        w.invocationsAtDispose = app.invocations.length;
        dispose?.();
        flush();
        w.textAtDispose = container.textContent;
        break;
    }
  };

  try {
    for (const e of scenario.events) {
      w.step++;
      try {
        await run(e);
      } catch (err: any) {
        find(w, "G", "no-runtime-error", `threw at ${e.t}: ${err && err.message}`);
      }
      flush();
      dump(`step ${w.step} ${e.t}${"i" in e ? e.i : ""}${"side" in e ? e.side : ""}`);
      immediateLaws(w, spies.warnings, spies.errors);
      if (e.t === "tick") settledLaws(w);
    }
    // quiesce: let every landed answer, resume and the drain's own timeout run
    w.step++;
    await quiesce();
    // the boundaries' own async memos (data:a / data:b) are adopted settled;
    // `shared`'s re-run after a write takes 15ms — wait it out
    await new Promise(r => setTimeout(r, 25));
    flush();
    dump("end");
    immediateLaws(w, spies.warnings, spies.errors);
    settledLaws(w);
    await endLaws(w);
    flush();
    immediateLaws(w, spies.warnings, spies.errors);
  } finally {
    dispose?.();
    uncapture();
    await macrotask();
    await macrotask();
    spies.restore();
    container.remove();
    delete (globalThis as any)._$HY;
  }
  return { scenario, description: describeScenario(scenario), findings: w.findings };
}
