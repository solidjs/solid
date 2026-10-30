/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the async-gen hydration campaign
 * (test/consistency/async-gen/hydrate.spec.tsx). Off by default; run with
 *
 *   ASYNC_GEN_HY=1 [ASYNC_GEN_SEED=3289] [ASYNC_GEN_CASES=100]
 *   [ASYNC_GEN_REPLAY=scenarios.json]
 *   npx vitest run --config vite.config.server.mjs test/server/async-gen.gen.spec.tsx
 *
 * Each generated scenario is emitted as a TSX module under
 * test/async-gen/__gen__/ (git-ignored), rendered through renderToStream on
 * the recorder's stepped clock, and its shell and chunks written beside it.
 * Async memo m<i> answers after 10·(i+1) ms, so answers stream in chunks.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";
import fc from "fast-check";
import { emitApp, type AppContext } from "../async-gen/emit.js";
import { scenarioArb, type Scenario } from "../async-gen/scenario.js";
import { recordStream } from "./artifact-recorder.js";

const ON = !!process.env.ASYNC_GEN_HY;
const SEED = Number(process.env.ASYNC_GEN_SEED ?? 3289);
const CASES = Number(process.env.ASYNC_GEN_CASES ?? 100);
const REPLAY = process.env.ASYNC_GEN_REPLAY;
const GEN = resolve(process.cwd(), "test/async-gen/__gen__");

const serverCtx = (values: number[]): AppContext => ({
  values,
  ask: (name, v, poison) =>
    new Promise((res, rej) =>
      setTimeout(
        () => (poison !== null && v % 4 === poison ? rej(new Error(`${name}:${v}`)) : res(v)),
        10 * (Number(name.slice(1)) + 1)
      )
    )
});

test.skipIf(!ON)(`async-gen: render seed ${SEED}, ${CASES} cases`, { timeout: 0 }, async () => {
  rmSync(GEN, { recursive: true, force: true });
  mkdirSync(GEN, { recursive: true });
  // Hydration needs the memos created by the component, under its owner.
  // ASYNC_GEN_REPLAY=<file.json>: render the scenarios listed there instead.
  const scenarios = (
    REPLAY
      ? (JSON.parse(readFileSync(REPLAY, "utf8")) as Scenario[])
      : fc.sample(scenarioArb(), { seed: SEED, numRuns: CASES })
  ).map(sc => ({ ...sc, owned: true }));
  const cases: { i: number; error?: string }[] = [];
  for (let i = 0; i < scenarios.length; i++) {
    const file = resolve(GEN, `app-${i}.tsx`);
    writeFileSync(file, emitApp(scenarios[i]));
    try {
      const { createApp } = await import(/* @vite-ignore */ file);
      const { shell, chunks } = await recordStream(() => {
        const { App } = createApp(serverCtx([...scenarios[i].signals]));
        return <App />;
      });
      writeFileSync(
        resolve(GEN, `app-${i}.json`),
        JSON.stringify({ scenario: scenarios[i], shell, chunks })
      );
      cases.push({ i });
    } catch (e: any) {
      cases.push({ i, error: String(e?.message ?? e).slice(0, 240) });
    }
  }
  writeFileSync(resolve(GEN, "index.json"), JSON.stringify({ seed: SEED, cases }, null, 2));
  const failed = cases.filter(c => c.error);
  if (failed.length)
    process.stdout.write(
      `async-gen server: ${failed.length} renders failed:\n  ${failed.map(c => `#${c.i} ${c.error}`).join("\n  ")}\n`
    );
  expect(cases.length).toBe(scenarios.length);
});
