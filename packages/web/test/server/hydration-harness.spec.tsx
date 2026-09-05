/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the hydration parity harness (#2801).
 *
 * Renders every scenario from test/harness/scenarios.tsx with the ssr
 * generate and writes the chunk artifacts that
 * test/hydration/parity-harness.spec.tsx replays into jsdom with the
 * dom-generate compilation of the same source.
 *
 * `pnpm test` runs this project before the hydrate project, so artifacts are
 * always regenerated from current compiler + runtime before being consumed.
 * Artifacts are committed so id/markup changes show up in diffs.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStream } from "@solidjs/web";
import type { RequestEvent, ResponseStub } from "@solidjs/web";
import { scenarios } from "../harness/scenarios.jsx";
import { forSlotScenarios } from "../harness/for-slot-scenarios.jsx";

const artifactsDir = resolve(dirname(fileURLToPath(import.meta.url)), "../harness/__artifacts__");
mkdirSync(artifactsDir, { recursive: true });

// Render every scenario under a request event so the http-primitives
// scenarios' `httpStatus`/`httpHeader` calls take the FULL server write path
// (snapshot + onCleanup retraction, not the no-event early return) while the
// artifacts generate — if the write path had any hydration-id cost, it would
// show up in the artifact keys and fail parity. Write semantics themselves
// are covered by test/server/http-components.spec.tsx; scenarios that never
// call getRequestEvent don't observe the event at all.
const RequestContext = Symbol.for("solid.RequestContext");
const storage = new AsyncLocalStorage<RequestEvent & { response?: ResponseStub }>();
(globalThis as any)[RequestContext] = storage;
const makeEvent = () => ({
  request: new Request("http://localhost/"),
  locals: {},
  response: { status: 200, headers: new Headers() }
});

function collectChunks(code: () => any): Promise<{ shell: string; rest: string }> {
  return new Promise(resolvePromise => {
    const chunks: string[] = [];
    let shell = "";
    let shellDone = false;
    renderToStream(code, {
      onCompleteShell() {
        shellDone = true;
      }
    }).pipe({
      write(chunk: string) {
        chunks.push(chunk);
        if (shellDone && !shell) shell = chunks.join("");
      },
      end() {
        const full = chunks.join("");
        if (!shell) shell = full;
        resolvePromise({ shell, rest: full.slice(shell.length) });
      }
    });
  });
}

describe("hydration parity harness — server render", () => {
  for (const scenario of scenarios) {
    test(scenario.name, async () => {
      const { shell, rest } = await storage.run(makeEvent(), () =>
        collectChunks(() => <scenario.App />)
      );
      const full = shell + rest;

      // Text sanity: strip scripts, then tags. Template contents survive the
      // tag strip, so late-streamed fragment text is included. serverText
      // overrides expectedText for scenarios with client-only content.
      const visible = full.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");
      for (const token of (scenario.serverText ?? scenario.expectedText)
        .split(/\s+/)
        .filter(Boolean)) {
        expect(visible).toContain(token);
      }

      writeFileSync(
        resolve(artifactsDir, `${scenario.name}.json`),
        JSON.stringify({ name: scenario.name, shell, rest }, null, 2)
      );
    });
  }
});

// Unified For hydration scenarios (test/hydration/for-slot.spec.tsx consumes
// these artifacts). Kept out of `scenarios` because the mismatch cases
// legitimately diverge from the generic parity invariants (key-miss
// warnings, client-created rows) by design.
describe("unified For hydration scenarios — server render", () => {
  for (const scenario of forSlotScenarios) {
    test(scenario.name, async () => {
      const { shell, rest } = await storage.run(makeEvent(), () =>
        collectChunks(() => <scenario.App />)
      );
      const full = shell + rest;
      const visible = full.replace(/<script[\s\S]*?<\/script>/g, "").replace(/<[^>]*>/g, "");
      for (const token of (scenario.serverText ?? scenario.expectedText)
        .split(/\s+/)
        .filter(Boolean)) {
        expect(visible).toContain(token);
      }
      writeFileSync(
        resolve(artifactsDir, `${scenario.name}.json`),
        JSON.stringify({ name: scenario.name, shell, rest }, null, 2)
      );
    });
  }
});
