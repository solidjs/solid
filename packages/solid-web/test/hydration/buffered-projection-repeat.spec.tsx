/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 *
 * Buffered async-iterable STORE replay vs Repeat's hydration claim.
 *
 * A store-shaped async iterable (createProjection over an async generator,
 * rendered via Repeat) serializes as: full first-yield snapshot (the one row
 * the fragment's HTML shows), then one index+length patch list per later
 * yield, then the stream's return(). When hydration begins after those
 * yields are already buffered (delayed client script), the replay wrapper
 * used to apply the whole backlog synchronously inside the first store read
 * — which happens INSIDE the hydration claim pass, since Repeat reading
 * `length` is what first pulls the projection. Projection draft writes stage
 * in the override layer until the firewall commits, so the write-time
 * snapshot capture recorded the uncommitted SEED (length 0) as the pre-write
 * base instead of the first-yield state the SSR DOM shows (length 1); Repeat
 * then hydrated against an empty list, claimed nothing, and every row was
 * re-created as fresh client DOM — leaving the server-rendered row orphaned
 * beside a duplicate.
 *
 * The backlog now parks until hydration completes (where a live stream's
 * yields land), and these tests pin the claim across all three arrival
 * shapes: fully buffered, partially buffered, and live-streamed.
 */
import { describe, expect, test, vi, afterEach } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { flush } from "solid-js";
import { hydrate } from "@solidjs/web";
import { scenarios } from "../harness/scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const scenario = scenarios.find(s => s.name === "projection-repeat-stream")!;
const FINAL_TEXT = "1:one2:two3:three4:four5:five";

function loadArtifact(name: string): { shell: string; rest: string } {
  const file = resolve(artifactsDir, `${name}.json`);
  if (!existsSync(file)) {
    throw new Error(
      `Missing artifact for scenario "${name}". Run the server harness first: ` +
        `vitest run --config vite.config.server.mjs test/server/hydration-harness.spec.tsx`
    );
  }
  return JSON.parse(readFileSync(file, "utf-8"));
}

// Split a chunk into markup and inline scripts, mirroring a streaming parse.
function splitChunk(chunk: string): { markup: string; scripts: string[] } {
  const scriptRe = /<script(?:[^>]*)>([\s\S]*?)<\/script>/g;
  const scripts = [...chunk.matchAll(scriptRe)].map(m => m[1]);
  return { markup: chunk.replace(scriptRe, ""), scripts };
}

type Ctx = {
  container: HTMLDivElement;
  ssrLi: HTMLElement;
  dispose?: () => void;
  warn: ReturnType<typeof vi.spyOn>;
};

// Apply the shell plus the rest chunk's markup (the content template) and the
// first `preScripts` of the rest's inline scripts, then snapshot the
// server-rendered row before hydration runs.
function setup(shell: string, restMarkup: string, preScripts: string[]): Ctx {
  const container = document.createElement("div");
  document.body.appendChild(container);
  (globalThis as any)._$HY = { events: [], completed: new WeakSet(), r: {}, fe() {} };
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  const shellParts = splitChunk(shell);
  container.innerHTML = shellParts.markup;
  for (const s of shellParts.scripts) (0, eval)(s);
  container.insertAdjacentHTML("beforeend", restMarkup);
  for (const s of preScripts) (0, eval)(s);

  // Fragment not swapped in yet — the row may still live in the content
  // template (the shell's pl-* placeholder template is empty, skip it).
  const ssrLi = (container.querySelector("li[_hk]") ??
    [...container.querySelectorAll("template")]
      .map(t => t.content.querySelector("li[_hk]"))
      .find(Boolean))! as HTMLElement;
  expect(ssrLi.textContent).toBe("1:one");

  return { container, ssrLi, warn };
}

async function settleAndAssertClaim(ctx: Ctx) {
  await sleep(50);
  flush();
  await sleep(50);
  flush();

  const ul = ctx.container.querySelector("ul")!;
  // (a) final list content is correct — five rows, no duplicated first item
  expect(ul.textContent).toBe(FINAL_TEXT);
  const rows = [...ul.querySelectorAll("li")];
  expect(rows.length).toBe(5);
  // (b) the server-rendered row was CLAIMED — same node object, not an
  // orphaned sibling of a fresh client copy
  expect(rows[0]).toBe(ctx.ssrLi);
  expect(rows[0].getAttribute("_hk")).not.toBeNull();
  // and hydration reported no unclaimed-node/tag-mismatch warnings
  expect(ctx.warn).not.toHaveBeenCalled();
}

function teardown(ctx: Ctx) {
  ctx.warn.mockRestore();
  ctx.dispose?.();
  ctx.container.remove();
}

describe("buffered store replay keeps Repeat's hydration claim", () => {
  let ctx: Ctx | undefined;
  afterEach(async () => {
    if (ctx) teardown(ctx);
    ctx = undefined;
    await sleep(0);
  });

  test("fully buffered: every yield (and completion) precedes hydrate()", async () => {
    const { shell, rest } = loadArtifact(scenario.name);
    const restParts = splitChunk(rest);
    ctx = setup(shell, restParts.markup, restParts.scripts);

    ctx.dispose = hydrate(() => <scenario.App />, ctx.container);
    flush();

    // The claim pass hydrated against the snapshot row; the parked backlog
    // must not have produced any duplicate of it.
    expect(ctx.container.querySelectorAll("li").length).toBeLessThanOrEqual(5);

    await settleAndAssertClaim(ctx);
  });

  test("partially buffered: snapshot and first patches buffered, tail streams live", async () => {
    const { shell, rest } = loadArtifact(scenario.name);
    const restParts = splitChunk(rest);
    // Scripts: [snapshot+$df swap, _fr settle, patch1..patch4, return].
    // Buffer through patch2; deliver the rest after hydration, one per tick.
    const pre = restParts.scripts.slice(0, 4);
    const post = restParts.scripts.slice(4);
    ctx = setup(shell, restParts.markup, pre);

    ctx.dispose = hydrate(() => <scenario.App />, ctx.container);
    flush();

    for (const s of post) {
      await sleep(10);
      flush();
      (0, eval)(s);
    }

    await settleAndAssertClaim(ctx);
  });

  test("live: only the shell precedes hydrate(), all yields stream in after", async () => {
    const { shell, rest } = loadArtifact(scenario.name);
    const restParts = splitChunk(rest);
    ctx = setup(shell, restParts.markup, []);

    ctx.dispose = hydrate(() => <scenario.App />, ctx.container);
    flush();
    await sleep(10);
    flush();

    for (const s of restParts.scripts) {
      (0, eval)(s);
      await sleep(10);
      flush();
    }

    await settleAndAssertClaim(ctx);
  });
});
