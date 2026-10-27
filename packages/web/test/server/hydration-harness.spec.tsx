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
 * Artifacts are committed so id/markup changes show up in diffs (and under
 * CI a recording that differs from the committed one fails — see
 * artifact-recorder.ts).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, test } from "vitest";
import type { RequestEvent, ResponseStub } from "@solidjs/web";
import {
  scenarios,
  fallbackHoleFailures,
  fallbackHoleFailure,
  fallbackHoleFailureName
} from "../harness/scenarios.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

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

describe("hydration parity harness — server render", () => {
  for (const scenario of scenarios) {
    test(scenario.name, async () => {
      const { shell, rest } = await storage.run(makeEvent(), () =>
        recordStream(() => <scenario.App />)
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
      // Element-yielding items need no text separator between them (#3383).
      if (scenario.noSeparators) expect(full).not.toContain("<!--!$-->");

      writeArtifact(scenario.name, { name: scenario.name, shell, rest });
    });
  }
});

// #4316: an Errored fallback whose own hole fails, async (rejects while the
// failure waits for it) and its sync-throw twin. Recorded for
// test/hydration/errored-parked-async-outcome-4306.spec.tsx, which holds
// the async variant to the twin's outcome on the client. Here: the same
// markup reaches the page, and the fallback's failure is the next boundary
// up's (the outer <Errored>'s fallback is drawn), never a blank region.
describe("hydration parity harness — Errored fallback hole failure (#4316)", () => {
  const visible = (full: string) =>
    full
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]*>/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  const recorded = new Map<string, string>();
  for (const o of fallbackHoleFailures) {
    const name = fallbackHoleFailureName(o);
    test(name, async () => {
      const App = fallbackHoleFailure(o);
      const { shell, rest } = await storage.run(makeEvent(), () => recordStream(() => <App />));
      writeArtifact(name, { name, shell, rest });
      recorded.set(name, visible(shell + rest));
      if (o.caught) expect(rest).toContain("caught: <!--$-->no hint<!--/--></h2>");
      else expect(rest).not.toContain("caught:");
      expect(rest).not.toContain("failed:");
    });
  }
  test("the async variant sends what its sync-throw twin sends", () => {
    for (const o of fallbackHoleFailures) {
      if (o.hole !== "async") continue;
      const name = fallbackHoleFailureName(o);
      const twin = fallbackHoleFailureName({ ...o, hole: "sync" });
      expect(recorded.get(name), name).toBe(recorded.get(twin));
    }
  });
});
