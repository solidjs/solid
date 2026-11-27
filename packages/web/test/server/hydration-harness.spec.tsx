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
  fallbackHoleFailureName,
  parkedFailures,
  lateParkedFailures,
  parkedFailure,
  parkedFailureName,
  shellFallbackFailures,
  shellFallbackFailure,
  shellFallbackFailureName,
  lazyErroredShapes,
  lazyErroredContent,
  lazyErroredName,
  erroredOutsideLoadingShapes,
  erroredOutsideLoading,
  erroredOutsideLoadingName,
  preflushNestedShapes,
  preflushNested,
  preflushNestedName,
  postflushNestedShapes,
  postflushNested,
  postflushNestedName,
  type PostflushNestedShape
} from "../harness/scenarios.jsx";
import { hydrationRecordKeys } from "../harness/hydration-records.js";
import { ctl, plans, reviewName, shapes } from "../harness/errored-postflush-review-5223.jsx";
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
describe("hydration parity harness — Errored fallback over lazy content (#4348)", () => {
  for (const shape of lazyErroredShapes) {
    const name = lazyErroredName(shape);
    test(name, async () => {
      const App = lazyErroredContent(shape);
      const { shell, rest } = await storage.run(makeEvent(), () => recordStream(() => <App />));
      writeArtifact(name, { name, shell, rest });
      // Shell: the loading fallback; the fragment: the Errored fallback, the
      // error serialized at the Errored id. None of the content's markup.
      expect(shell).toMatch(/<p[^>]*>loading<\/p>/);
      expect(rest).toContain("failed: <!--$-->no user 7<!--/--></p>");
      expect(rest).not.toContain("<button");
    });
  }
});

// #4372: a rejection under a streamed Loading caught by an Errored outside
// it. Recorded for test/hydration/errored-outside-loading-4372.spec.tsx.
describe("hydration parity harness — Errored outside a failing streamed Loading (#4372)", () => {
  for (const shape of erroredOutsideLoadingShapes) {
    const name = erroredOutsideLoadingName(shape);
    test(name, async () => {
      const App = erroredOutsideLoading(shape);
      const { shell, rest } = await storage.run(makeEvent(), () => recordStream(() => <App />));
      writeArtifact(name, { name, shell, rest });
      // Shell: the Loading's fallback; the fragment: the Errored's fallback,
      // marked as a rejected fragment.
      expect(shell).toContain("[LOAD]");
      if (shape === "text") expect(rest).toMatch(/<template id="[^"]+" e><\/template>/);
      else expect(rest).toMatch(/<template id="[^"]+" e>(<p[^>]*>)?\[ERR\]/);
    });
  }
});

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

// #4316 follow-up: a fragment failing while parked in a pending enclosing
// fragment. Recorded for test/hydration/errored-parked-async-outcome-4306
// .spec.tsx. Here: the stream carries what the twin's does (the failure
// met in the enclosing fragment's own pass), never the region blank.
describe("hydration parity harness — fragment failure parked in a pending fragment (#4316)", () => {
  const visible = (full: string) =>
    full
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]*>/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  const recorded = new Map<string, string>();
  for (const o of [...parkedFailures, ...lateParkedFailures]) {
    const name = parkedFailureName(o);
    test(name, async () => {
      const App = parkedFailure(o);
      const { shell, rest } = await storage.run(makeEvent(), () => recordStream(() => <App />));
      writeArtifact(name, { name, shell, rest });
      recorded.set(name, visible(shell + rest));
      if (o.late) {
        // Settled first, the enclosing fragment's markup is out: the inner
        // fragment rejects on its own, for the client to render.
        expect(rest).toMatch(/<template id="[^"]+" e><\/template>/);
        return;
      }
      // Never the blank region a parked failure used to settle as.
      expect(rest).not.toMatch(/<section[^>]*><\/section>/);
      if (o.A)
        expect(rest).toContain(`caught: <!--$-->${o.B ? "no hint" : "no user 7"}<!--/--></h2>`);
      else if (o.caught)
        expect(rest).toContain(`outermost: <!--$-->${o.B ? "no hint" : "no user 7"}<!--/--></h3>`);
      else expect(rest).toMatch(/<template id="[^"]+" e><\/template>/);
    });
  }
  test("a parked failure sends what its twin sends", () => {
    for (const o of parkedFailures) {
      if (o.variant !== "inner") continue;
      const name = parkedFailureName(o);
      const twin = parkedFailureName({ ...o, variant: "twin" });
      expect(recorded.get(name), name).toBe(recorded.get(twin));
    }
  });
});

// The #4316 failure at shell level, no <Loading>: an Errored fallback whose
// own hole fails, async and its sync-throw twin. Recorded (caught by an
// outer <Errored>) for test/hydration/errored-parked-async-outcome-4306
// .spec.tsx. Here: the shell carries what the twin's does — the outer
// Errored's fallback, never a blank region with the errors recorded and no
// markup for them — and with no outer Errored the request fails, as the
// twin's does.
describe("hydration parity harness — Errored fallback hole failure in the shell", () => {
  const visible = (full: string) =>
    full
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]*>/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  const recorded = new Map<string, { text: string; errors: string[] }>();
  for (const o of shellFallbackFailures) {
    const name = shellFallbackFailureName(o);
    test(name, async () => {
      const App = shellFallbackFailure(o);
      const errors: string[] = [];
      const { shell, rest } = await storage.run(makeEvent(), () =>
        recordStream(() => <App />, {
          onError: (e: unknown) => void errors.push(e instanceof Error ? e.message : String(e))
        })
      );
      recorded.set(name, { text: visible(shell + rest), errors });
      expect(rest).toBe("");
      expect(errors).toContain("no hint");
      if (o.A) {
        writeArtifact(name, { name, shell, rest });
        expect(shell).toContain("caught: <!--$-->no hint<!--/--></h2>");
        expect(shell).toContain("<b>outer</b>");
        expect(shell).not.toContain("<section");
        expect(shell).not.toContain("failed:");
      } else {
        // B's fallback failed with nothing above it: the request fails.
        expect(shell).toBe("");
      }
    });
  }
  test("the async variant sends what its sync-throw twin sends", () => {
    for (const o of shellFallbackFailures) {
      if (o.hole !== "async") continue;
      const name = shellFallbackFailureName(o);
      const twin = shellFallbackFailureName({ ...o, hole: "sync" });
      expect(recorded.get(name), name).toEqual(recorded.get(twin));
    }
  });
});

// #4287 follow-up: a `<Loading>` that is not all of its `<Errored>`'s
// content fails before the shell is handed to the sink. Recorded for
// test/hydration/errored-nested-preflush-4287.spec.tsx. Here: the shell
// carries the Errored fallback in place of the Errored's content — the
// markup between the two boundaries and every sibling with it — and the
// error at the Errored id, nothing streams after it for that content, and
// the page reads as the twin's (the read failing in the Errored's own
// pull). Never the blank the position used to keep until hydration.
describe("hydration parity harness — nested Loading failing before the shell (#4287)", () => {
  const visible = (full: string) =>
    full
      .replace(/<script[\s\S]*?<\/script>/g, "")
      .replace(/<[^>]*>/g, " ")
      .split(/\s+/)
      .filter(Boolean)
      .join(" ");
  const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
  for (const shape of preflushNestedShapes) {
    const name = preflushNestedName(shape);
    test(name, async () => {
      const App = preflushNested(shape);
      const { shell, rest } = await storage.run(makeEvent(), () => recordStream(() => <App />));
      writeArtifact(name, { name, shell, rest });
      expect(strip(shell)).toBe(
        `<div _hk=4><!--$--><p _hk=60>failed: <!--$-->no user 7<!--/--><!--$--><!--/--></p>` +
          `<!--/--><b>outer</b><span>tail</span></div>`
      );
      // Nothing streams for the replaced content: no fragment, no sibling's.
      expect(strip(rest)).not.toContain("<template");
      expect(strip(rest)).not.toContain("sib");
      // The error record the client adopts the fallback with.
      expect(hydrationRecordKeys(shell + rest)).toContain("5");
      // (Not `pending-sibling`: its twin still streams the discarded
      // sibling's fragment, a template for a position the page no longer
      // has.)
      if (shape === "pending-sibling") return;
      const Twin = preflushNested(shape, true);
      const t = await storage.run(makeEvent(), () => recordStream(() => <Twin />));
      expect(visible(shell + rest)).toBe(visible(t.shell + t.rest));
    });
  }
});

// #5223: the same nested failure landing after the shell, and the shapes
// the reviews of the first attempt found broken (H1–H7), recorded for
// test/hydration/errored-nested-postflush-5223.spec.tsx. Here: the shell
// carries nothing for it; the stream sends the nearest Errored's fallback in
// a template keyed by its id, the error staged at `<id>_ef`, and the `$dfx`
// call naming the region's two ends, then settles the failed `<Loading>` as
// before (its empty template). `null`: nothing is sent (a fallback with a
// bare async hole is not finished as it renders; a <NoHydration> zone has no
// key to name an end by), and the stream is as before.
describe("hydration parity harness — nested Loading failing after the shell (#5223)", () => {
  const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");
  async function record(name: string, App: () => any) {
    const heard: string[] = [];
    const { shell, rest } = await storage.run(makeEvent(), () =>
      recordStream(() => <App />, {
        onError: (e: any, site: any) => void heard.push(`${e.message} ${site.handling}`),
        manifest: { "src/Inner.tsx": { file: "assets/inner.js" } }
      } as any)
    );
    writeArtifact(name, { name, shell, rest });
    const sent = [...rest.matchAll(/\$dfx\("(\w+)",(.*?),1\)/g)].map(m => [m[1], m[2]]);
    return { shell, rest, heard, sent };
  }
  // The ends named: the <section> twice; for `sibling`, the placeholder to
  // the <h1> beside it.
  const section = /^\["(\w+)"\],\["\1"\]$/;
  const ends: Record<PostflushNestedShape, RegExp | null> = {
    element: section,
    sibling: /^\[\["\w+"\]\],\["\w+"\]$/,
    "pending-sibling": section,
    nested: section,
    "async-fallback": null
  };
  for (const shape of postflushNestedShapes) {
    const name = postflushNestedName(shape);
    test(name, async () => {
      const { shell, rest, heard, sent } = await record(name, postflushNested(shape));
      expect(strip(shell)).not.toContain(" e>");
      expect(strip(shell)).toContain(">loading</i>");
      expect(strip(shell)).not.toContain("failed");
      expect(rest).not.toContain("outer failed");
      if (!ends[shape]) {
        expect(sent).toEqual([]);
        expect(heard).toEqual(["no user 7 client"]);
        expect(strip(rest)).toMatch(/^<template id="\w+" e><\/template>$/);
        return;
      }
      expect(sent.length).toBe(1);
      const [id, named] = sent[0];
      expect(named).toMatch(ends[shape]!);
      expect(heard).toEqual(["no user 7 fallback"]);
      // The fallback, then the failed fragment's empty template (then, for
      // `pending-sibling`, the sibling's fragment, its value the client's).
      expect(strip(rest)).toMatch(
        new RegExp(
          `^<template id="${id}"><p _hk=\\w+>failed: <!--\\$-->no user 7<!--/--><!--\\$--><!--/--></p></template>` +
            `<template id="\\w+" e></template>${shape === "pending-sibling" ? `<template id="\\w+"><em _hk=\\w+>sib</em></template>` : ""}$`
        )
      );
      expect(rest).not.toContain("delete _$HY.r");
      // Staged: the page records it at the Errored id with the swap.
      expect(hydrationRecordKeys(shell + rest)).toContain(id + "_ef");
      expect(hydrationRecordKeys(shell + rest)).not.toContain(id);
    });
  }

  // The Errored whose fallback is sent, by the tag in its markup.
  const sends: Record<string, string | null> = {
    H1: "INNER",
    H2: "E",
    H3: null,
    // H4: the outer fragment settles in the same turn, ahead of the failure.
    H4: "E",
    H4b: "E",
    H5: "E",
    H6: "E",
    H7: "svg"
  };
  for (const key of Object.keys(plans)) {
    const name = reviewName(key);
    test(name, async () => {
      ctl.plan = plans[key];
      const { rest, heard, sent } = await record(name, shapes[key.slice(0, 2)]);
      expect(rest).not.toContain("OUTER");
      if (sends[key] === null) {
        expect(sent).toEqual([]);
        expect(rest).not.toContain("$dfx");
        expect(heard).toEqual(["boom client"]);
        return;
      }
      expect(sent.length).toBe(1);
      const [id, named] = sent[0];
      expect(rest).toMatch(
        new RegExp(
          `<template id="${id}">` +
            (sends[key] === "svg"
              ? `<circle _hk=\\w+ data-error="boom" cx="10"`
              : `<p _hk=\\w+><!--\\$-->${sends[key]}<!--/-->: `)
        )
      );
      // H1: the inner region's ends, its Loading's placeholder and, that one
      // revealed, its content's root.
      if (key === "H1") expect(named).toMatch(/^\[\["(\w+)"\],"\w+"\],\[\["\1"\],"\w+"\]$/);
      expect(heard).toEqual(["boom fallback"]);
    });
  }
});
