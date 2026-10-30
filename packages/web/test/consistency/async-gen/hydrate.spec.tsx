/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Client half of the async-gen hydration campaign: replays what
 * test/server/async-gen.gen.spec.tsx rendered. Off by default; run the
 * server half first, then
 *
 *   ASYNC_GEN_HY=1 npx vitest run --config vite.config.hydrate.mjs test/consistency/async-gen
 *
 * Per case, the shell is hydrated and every chunk applied, then:
 *
 * - NO REFETCH (Ryan, 2026-10-30): "a refetch is a re-ask of a read the
 *   server answered (value or error); a first ask of a read the server
 *   never reached is the client's ordinary ask". Hydration is CSR with the
 *   server's answers claimed, so an ask counts only when the payload carries
 *   that memo's answer and it comes before the first client write. An ask
 *   made under hydration's dry run, with its fake Promise, is not one.
 * - CLEAN: no console.error, no hydration warning.
 * - HYDRATED = CSR: the hydrated screen equals a fresh client render of the
 *   same inputs with every memo synchronous.
 * - Then the scenario's steps run as in the client campaign, and LIVENESS:
 *   once every flight settles, the screen equals a fresh render of the
 *   final inputs.
 *
 * ASYNC_GEN_RECORD / ASYNC_GEN_DIFF: see test/async-gen/differential.ts.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import { action, flush, getOwner, resetErrorHalt } from "solid-js";
import { peekNextChildId } from "@solidjs/signals";
import { hydrate, render } from "@solidjs/web";
import { sharedConfig } from "solid-js/internal";
import type { AppContext } from "../../async-gen/emit.js";
import type { Scenario } from "../../async-gen/scenario.js";
import { describeScenario } from "../../async-gen/scenario.js";
import { recordOrDiff, type Trace } from "../../async-gen/differential.js";
import { serialize as serializeDom } from "../../async-gen/run.js";

/** The screen, without hydration keys. */
const serialize = (el: globalThis.Node) => serializeDom(el).replace(/ _hk=[^ >]*/g, "");

const ON = !!process.env.ASYNC_GEN_HY;
const GEN = resolve(process.cwd(), "test/async-gen/__gen__");
const MATCH = process.env.ASYNC_GEN_MATCH ? new RegExp(process.env.ASYNC_GEN_MATCH) : null;
const ONLY = process.env.ASYNC_GEN_ONLY?.split(",").map(Number);
const RealPromise = Promise;

type Finding = { law: string; step: number; detail: string };
type Flight = {
  label: string;
  value: number;
  rejects: boolean;
  resolve(v: number): void;
  reject(e: unknown): void;
};

const micro = () => RealPromise.resolve();
const task = () => new RealPromise<void>(r => setTimeout(r, 0));

function applyChunk(container: HTMLElement, chunk: string, first: boolean) {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  const stripped = chunk.replace(scriptRe, "");
  if (first) container.innerHTML = stripped;
  else container.insertAdjacentHTML("beforeend", stripped);
  for (const s of scripts) (0, eval)(s);
}

const poisoned = (poison: number | null, v: number) => poison !== null && v % 4 === poison;
/** Every memo synchronous: the screen a settled app must show. */
const freshCtx = (values: number[]): AppContext => ({
  values,
  ask(name, v, poison) {
    if (poisoned(poison, v)) throw new Error(`${name}:${v}`);
    return v;
  }
});

async function freshScreen(createApp: (ctx: AppContext) => any, values: number[]) {
  const el = document.createElement("div");
  const { App } = createApp(freshCtx(values));
  try {
    const dispose = render(() => <App />, el);
    flush();
    const out = serialize(el);
    dispose();
    return out;
  } catch (e: any) {
    return `<fresh render threw: ${e?.message ?? e}${sharedConfig.hydrating ? " (still hydrating)" : ""}>`;
  }
}

async function runCase(
  i: number
): Promise<{ sc: Scenario; findings: Finding[]; screens: string[]; final: string }> {
  const {
    scenario: sc,
    shell,
    chunks
  } = JSON.parse(readFileSync(resolve(GEN, `app-${i}.json`), "utf8")) as {
    scenario: Scenario;
    shell: string;
    chunks: string[];
  };
  const { createApp } = await import(/* @vite-ignore */ resolve(GEN, `app-${i}.tsx`));
  const findings: Finding[] = [];
  const flights: Flight[] = [];
  const asks: string[] = [];
  const values = [...sc.signals];
  let step = -1;
  let hydrating = true;
  const screens: string[] = [];
  let final = "";

  const origError = console.error;
  const origWarn = console.warn;
  const report =
    (law: string) =>
    (...args: unknown[]) =>
      findings.push({
        law,
        step,
        detail: args
          .map(a => (a instanceof Error ? a.message : String(a)))
          .join(" ")
          .slice(0, 240)
      });
  console.error = report("console-error");
  // Warnings matter while hydrating (key misses, mismatches); after it, the
  // client campaign's posture (muted) applies.
  console.warn = (...args) => hydrating && report("hydration-warning")(...args);
  const onUnhandled = (e: unknown) =>
    findings.push({
      law: "unhandled-rejection",
      step,
      detail: String((e as any)?.message ?? e).slice(0, 240)
    });
  process.on("unhandledRejection", onUnhandled);
  process.on("uncaughtException", onUnhandled);
  const guard = (law: string, fn: () => void) => {
    try {
      fn();
    } catch (e: any) {
      findings.push({ law, step, detail: String(e?.message ?? e).slice(0, 240) });
    }
  };
  const drain = async () => {
    for (let r = 0; r < 4; r++) {
      for (let j = 0; j < 6; j++) await micro();
      guard("throw", flush);
      await task();
    }
    guard("throw", flush);
  };

  // Each memo's hydration id, taken just before it is created.
  const ids = new Map<string, string>();
  const ctx: AppContext = {
    values,
    id(name) {
      const owner = getOwner();
      if (owner && !ids.has(name)) ids.set(name, String(peekNextChildId(owner)));
    },
    ask(name, v, poison) {
      // Hydration's dry run swaps the global Promise for a mock: that run's
      // flight is never consumed, so it is not an ask.
      if (Promise !== RealPromise) return new Promise(() => {});
      asks.push(`${name}:${v}`);
      return new RealPromise<number>((res, rej) =>
        flights.push({
          label: `${name}:${v}`,
          value: v,
          rejects: poisoned(poison, v),
          resolve: res,
          reject: rej
        })
      );
    }
  };

  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const container = document.createElement("div");
  document.body.appendChild(container);
  let dispose: (() => void) | undefined;
  try {
    const { App, S } = createApp(ctx);
    applyChunk(container, shell, true);
    guard("throw", () => {
      dispose = hydrate(() => <App />, container);
      flush();
    });
    for (const c of chunks) {
      applyChunk(container, c, false);
      await drain();
    }
    await drain();
    hydrating = false;
    // Only an answer the payload carried can be re-asked.
    const payload = shell + chunks.join("");
    const served = (name: string) =>
      ids.has(name) && payload.includes(`_$HY.r["${ids.get(name)}"]`);
    const refetched = asks.filter(a => served(a.slice(0, a.indexOf(":"))));
    if (refetched.length) findings.push({ law: "refetch", step, detail: refetched.join(",") });
    const hydrated = serialize(container);
    screens.push(hydrated);
    const csr = await freshScreen(createApp, [...sc.signals]);
    if (hydrated !== csr)
      findings.push({ law: "hydrated-vs-csr", step, detail: `${hydrated}  ≠  csr ${csr}` });

    const act = action(function* (s: number, v: number) {
      S[s][1](v);
      yield new RealPromise<number>(res =>
        flights.push({
          label: `act:s${s}=${v}`,
          value: v,
          rejects: false,
          resolve: res,
          reject: () => {}
        })
      );
    });
    for (step = 0; step < sc.steps.length; step++) {
      const st = sc.steps[step];
      switch (st.t) {
        case "write":
          values[st.s] = st.v;
          guard("throw", () => S[st.s][1](st.v));
          break;
        case "settle":
          if (flights.length) {
            const [f] = flights.splice(st.pick % flights.length, 1);
            f.rejects ? f.reject(new Error(f.label)) : f.resolve(f.value);
          }
          break;
        case "action":
          values[st.s] = st.v;
          guard("throw", () => (act(st.s, st.v) as Promise<unknown>)?.catch?.(() => {}));
          break;
        case "flush":
          guard("throw", flush);
          break;
        case "micro":
          await micro();
          break;
        case "task":
          await task();
          guard("throw", flush);
          break;
      }
      screens.push(serialize(container));
    }
    step = sc.steps.length;
    await drain();
    for (let rounds = 0; flights.length && rounds < 25; rounds++) {
      while (flights.length) {
        const f = flights.shift()!;
        f.rejects ? f.reject(new Error(f.label)) : f.resolve(f.value);
      }
      await drain();
    }
    if (flights.length)
      findings.push({ law: "endless-flights", step, detail: flights.map(f => f.label).join(",") });
    final = serialize(container);
    const expected = await freshScreen(createApp, values);
    if (final !== expected)
      findings.push({ law: "final-screen", step, detail: `${final}  ≠  fresh ${expected}` });
  } finally {
    try {
      dispose?.();
    } catch {}
    container.remove();
    resetErrorHalt();
    await task();
    delete (globalThis as any)._$HY;
    process.off("unhandledRejection", onUnhandled);
    process.off("uncaughtException", onUnhandled);
    console.error = origError;
    console.warn = origWarn;
  }
  return { sc, findings, screens, final };
}

const signature = (f: Finding) =>
  `${f.law}: ${f.detail.replace(/\d+/g, "#").replace(/≠.*/, "≠ …").slice(0, 90)}`;

test.skipIf(!ON)("async-gen hydration campaign", { timeout: 0 }, async () => {
  const index = resolve(GEN, "index.json");
  expect(existsSync(index), "run the server half first (test/server/async-gen.gen.spec.tsx)").toBe(
    true
  );
  const { seed, cases } = JSON.parse(readFileSync(index, "utf8")) as {
    seed: number;
    cases: { i: number; error?: string }[];
  };
  const tally = new Map<string, { count: number; first: number; detail: string; sc: Scenario }>();
  let failing = 0;
  let ran = 0;
  // Per-case laws, for minimize-hydration.mts.
  const results: { i: number; laws: string[] }[] = [];
  const traces: Record<number, Trace> = {};
  for (const c of cases) {
    if (c.error || (ONLY && !ONLY.includes(c.i))) continue;
    ran++;
    const { sc, findings, screens, final } = await runCase(c.i);
    traces[c.i] = { screens, final, laws: [...new Set(findings.map(f => f.law))].sort() };
    const fs = findings.filter(f => !MATCH || MATCH.test(`${f.law}: ${f.detail}`));
    if (fs.length) failing++;
    results.push({ i: c.i, laws: [...new Set(fs.map(f => f.law))] });
    const seen = new Set<string>();
    for (const f of fs) {
      const sig = signature(f);
      if (seen.has(sig)) continue;
      seen.add(sig);
      const t = tally.get(sig);
      if (t) t.count++;
      else tally.set(sig, { count: 1, first: c.i, detail: `@${f.step} ${f.detail}`, sc });
    }
  }
  writeFileSync(resolve(GEN, "results.json"), JSON.stringify(results));
  const out = (s: string) => process.stdout.write(s + "\n");
  out(
    `async-gen hydration: seed ${seed}, ${ran} cases, ${failing} with findings, ${tally.size} signatures`
  );
  for (const [sig, t] of [...tally].sort((a, b) => b[1].count - a[1].count)) {
    out(`  ${t.count}× ${sig}`);
    out(`     #${t.first} ${describeScenario(t.sc)}`);
    out(`     ${t.detail.slice(0, 400)}`);
  }
  const diffs = recordOrDiff("hydration", seed, cases.length, traces);
  if (diffs.length)
    out(`async-gen differential: ${diffs.length} cases differ\n  ${diffs.join("\n  ")}`);
  expect(diffs, "cases that differ from ASYNC_GEN_DIFF's recording").toEqual([]);
});
