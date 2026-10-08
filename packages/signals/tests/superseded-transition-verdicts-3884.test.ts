/**
 * #3884: isPending/latest on a superseded write must not depend on whether the
 * parked computation also reads them.
 *
 * Under #3774, verdict readers see the committed screen. The "nothing" row is
 * the consistent answer, and every other variant must match it. An outside
 * `isPending(source)` read is true for as long as the superseding write is
 * parked.
 */
import { describe, expect, it } from "vitest";
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  untrack
} from "../src/index.js";

const tick = () => new Promise(r => setTimeout(r, 0));

type Extra =
  | "nothing"
  | "untracked latest"
  | "untracked isPending"
  | "tracked latest"
  | "tracked isPending";

const EXTRAS: Extra[] = [
  "nothing",
  "untracked latest",
  "untracked isPending",
  "tracked latest",
  "tracked isPending"
];

function readExtra(source: () => string, extra: Extra): void {
  if (extra === "untracked latest") untrack(() => latest(source));
  if (extra === "untracked isPending") untrack(() => isPending(source));
  if (extra === "tracked latest") latest(source);
  if (extra === "tracked isPending") isPending(source);
}

type Checkpoint = {
  label: string;
  effect: string;
  isPending: boolean;
  latest?: string;
};

/** The value the UI effect is showing at this point in the log. */
function effectAt(log: string[], index: number): string {
  let effect = "(none)";
  for (let i = 0; i <= index; i++) {
    const line = log[i];
    if (line.startsWith("effect: ")) effect = line.slice("effect: ".length);
  }
  return effect;
}

function checkpoints(log: string[]): Checkpoint[] {
  const out: Checkpoint[] = [];
  for (let i = 0; i < log.length; i++) {
    const line = log[i];
    if (!line.startsWith("| ")) continue;
    const pending = /isPending=(true|false)/.exec(line);
    const latestMatch = /latest=([^ ]+)/.exec(line);
    if (!pending) throw new Error(`checkpoint missing isPending: ${line}`);
    out.push({
      label: line.slice(2, line.indexOf(":")),
      effect: effectAt(log, i),
      isPending: pending[1] === "true",
      ...(latestMatch ? { latest: latestMatch[1] } : {})
    });
  }
  return out;
}

/**
 * Narrowed repro (rc.14 comment): the parked memo reads `source` directly and
 * the UI effect reads the verdicts directly.
 *
 * Baseline "nothing": effect `/slow1` when A parks, `/slow2` at B's flush,
 * `-` when B lands; outside isPending true from A parked until B lands.
 */
async function runNarrowed(extra: Extra): Promise<string[]> {
  const log: string[] = [];
  const gates: Record<string, PromiseWithResolvers<string>> = {};
  const gate = (k: string) => (gates[k] ??= Promise.withResolvers<string>());
  const [source, setSource] = createSignal("/");

  createRoot(() => {
    const data = createMemo(() => {
      const v = source();
      readExtra(source, extra);
      return v.startsWith("/slow") ? gate(v).promise : v;
    });
    createRenderEffect(data, () => {});
    createRenderEffect(
      () => (isPending(source) ? latest(source) : "-"),
      v => void log.push(`effect: ${v}`)
    );
  });
  flush();
  const cp = (label: string) => log.push(`| ${label}: isPending=${isPending(source)}`);

  setSource("/slow1");
  flush();
  cp("A parked");
  await tick();
  setSource("/slow2");
  flush();
  cp("B flushed");
  await tick();
  cp("B flushed +tick");
  gates["/slow1"].resolve("one");
  await tick();
  cp("A resolved");
  gates["/slow2"].resolve("two");
  await tick();
  cp("B resolved");
  return log;
}

/**
 * Original repro: a `path` memo between source and the parked memo, and the
 * effect behind a `target` memo.
 *
 * Baseline "nothing": effect shows `/slow2` at B's flush; outside isPending
 * true while B is parked.
 */
async function runOriginal(extra: Extra): Promise<string[]> {
  const log: string[] = [];
  const gates: Record<string, PromiseWithResolvers<string>> = {};
  const gate = (k: string) => (gates[k] ??= Promise.withResolvers<string>());
  const [source, setSource] = createSignal("/");

  createRoot(() => {
    const path = createMemo(() => source());
    const data = createMemo(() => {
      const v = path();
      readExtra(source, extra);
      return v.startsWith("/slow") ? gate(v).promise : v;
    });
    createRenderEffect(data, () => {});
    const target = createMemo(() => (isPending(source) ? latest(source) : "-"));
    createRenderEffect(target, v => void log.push(`effect: ${v}`));
  });
  flush();
  const cp = (label: string) =>
    log.push(`| ${label}: isPending=${isPending(source)} latest=${latest(source)}`);

  setSource("/slow1");
  flush();
  cp("A parked");
  await tick();
  setSource("/slow2");
  flush();
  cp("B flushed");
  await tick();
  cp("B flushed +tick");
  gates["/slow1"].resolve("one");
  await tick();
  cp("A resolved");
  gates["/slow2"].resolve("two");
  await tick();
  cp("B resolved");
  return log;
}

/** What "nothing" shows. Every variant must match this. */
const NARROWED: Checkpoint[] = [
  { label: "A parked", effect: "/slow1", isPending: true },
  { label: "B flushed", effect: "/slow2", isPending: true },
  { label: "B flushed +tick", effect: "/slow2", isPending: true },
  { label: "A resolved", effect: "/slow2", isPending: true },
  { label: "B resolved", effect: "-", isPending: false }
];

const ORIGINAL: Checkpoint[] = [
  { label: "A parked", effect: "/slow1", isPending: true, latest: "/slow1" },
  { label: "B flushed", effect: "/slow2", isPending: true, latest: "/slow2" },
  { label: "B flushed +tick", effect: "/slow2", isPending: true, latest: "/slow2" },
  { label: "A resolved", effect: "/slow2", isPending: true, latest: "/slow2" },
  { label: "B resolved", effect: "-", isPending: false, latest: "/slow2" }
];

describe("#3884 superseded-transition verdicts", () => {
  describe("narrowed repro", () => {
    for (const extra of EXTRAS) {
      it(`${extra} matches the nothing baseline`, async () => {
        const log = await runNarrowed(extra);
        expect(checkpoints(log), log.join(" ; ")).toEqual(NARROWED);
      });
    }
  });

  describe("original repro", () => {
    for (const extra of EXTRAS) {
      it(`${extra} matches the nothing baseline`, async () => {
        const log = await runOriginal(extra);
        expect(checkpoints(log), log.join(" ; ")).toEqual(ORIGINAL);
      });
    }
  });
});
