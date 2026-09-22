/**
 * @jsxImportSource @solidjs/web
 */
// The `@solidjs/diagnostics` server scenario (server-dev-build-plan P4): the
// contract that a server render captured with `captureArtifact` yields an
// artifact an agent can work from — the server findings with `ownerPath`,
// and the records tables (`artifact.records`) that fold `OBSERVE.records`:
// every `<Loading>` boundary that waited, every server function execution,
// every frame stream produced, joined by `invocation.boundary` →
// `boundary.id` and `frame.id` = `invocation.id`.
//
// The harness depends on `@solidjs/signals` alone and reads the channel by
// its contract, so this suite is also where its mirrored record types are
// pinned to the runtime's (compile-time, below) — the client's `"call"`
// included, since the mirrors are one package.
//
// Imports source (the dev tier) and compiles with `sourceNames`
// (vite.config.server.mjs); the server-functions runtime is the built
// observe artifact, as in server-observe-invocations.spec.tsx.
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { Loading, renderToStream, useHead } from "@solidjs/web";
import type {
  CallEvent,
  FrameAppliedEvent,
  FrameEvent,
  FrameProducedEvent,
  InvocationEvent,
  JSX
} from "@solidjs/web";
import { createMemo, createSignal, type BoundaryEvent } from "solid-js";
import {
  artifactToJSONL,
  captureArtifact,
  DiagnosticsAssertionError,
  expectDiagnostic,
  expectNoDiagnostics,
  type BoundaryRecord,
  type CallRecord,
  type FrameAppliedRecord,
  type FrameProducedRecord,
  type FrameRecord,
  type InvocationRecord
} from "@solidjs/diagnostics";
import type * as prodRuntime from "@solidjs/web/server-functions/server";

// --- The mirrored record types are the runtime's, both ways --------------
// Mutual assignability pins every required member; the key sets pin the
// optional ones too (an optional field missing on one side still assigns).
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const boundaryShape: Same<BoundaryRecord, BoundaryEvent> = true;
const boundaryKeys: Same<keyof BoundaryRecord, keyof BoundaryEvent> = true;
const invocationShape: Same<InvocationRecord, InvocationEvent> = true;
const invocationKeys: Same<keyof InvocationRecord, keyof InvocationEvent> = true;
const callShape: Same<CallRecord, CallEvent> = true;
const callKeys: Same<keyof CallRecord, keyof CallEvent> = true;
const frameShape: Same<FrameRecord, FrameEvent> = true;
const producedShape: Same<FrameProducedRecord, FrameProducedEvent> = true;
const producedKeys: Same<keyof FrameProducedRecord, keyof FrameProducedEvent> = true;
const appliedShape: Same<FrameAppliedRecord, FrameAppliedEvent> = true;
const appliedKeys: Same<keyof FrameAppliedRecord, keyof FrameAppliedEvent> = true;
void boundaryShape;
void boundaryKeys;
void invocationShape;
void invocationKeys;
void callShape;
void callKeys;
void frameShape;
void producedShape;
void producedKeys;
void appliedShape;
void appliedKeys;

const RequestContext = Symbol.for("solid.RequestContext");
let runtime: typeof prodRuntime;

beforeAll(async () => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
  const entry = new URL("./server-functions/dist/server.observe.js", `file://${process.cwd()}/`)
    .href;
  runtime = await import(/* @vite-ignore */ entry);
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Runs `fn` under an established request scope, as a request handler would. */
function underRequest<T>(fn: () => T): T {
  const storage = (globalThis as any)[RequestContext] as AsyncLocalStorage<unknown>;
  return storage.run({ request: new Request("https://app.example/page"), locals: {} }, fn);
}

/** Streams to completion; resolves with everything written. */
function stream(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

/** An async read that answers `value` after `ms`. */
function Slow(props: { ms: number; value: string }): JSX.Element {
  const data = createMemo(async () => {
    await delay(props.ms);
    return props.value;
  });
  return <div>{data()}</div>;
}

describe("captureArtifact over a server render", () => {
  test("findings, boundaries and invocations, with the boundary as the join", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const getUser = runtime.createServerReference(
        runtime.registerServerReference("getUser", async (id: number) => {
          await delay(10);
          return { id, name: "Ada" };
        })
      ) as (id: number) => Promise<{ id: number; name: string }>;

      function Profile() {
        const user = createMemo(() => getUser(1));
        return <div>{user()?.name}</div>;
      }
      function App() {
        // Two seeded dev checks, one from each server runtime.
        useHead([{ tag: "div", props: {} } as any]);
        const [, setCount] = createSignal(0);
        setCount(1);
        return (
          <Loading fallback={<i>loading</i>}>
            <Profile />
          </Loading>
        );
      }

      const { result: html, artifact } = await captureArtifact(
        () => underRequest(() => stream(() => <App />)),
        { scenario: "profile page", attribution: false }
      );
      expect(html).toContain("Ada");

      // The findings, located by component.
      expect(artifact.formatVersion).toBe(7);
      expect(artifact.timeOrigin).toBe(performance.timeOrigin);
      expect(artifact.scenario).toBe("profile page");
      expectDiagnostic(artifact, "HEAD_TAG_INVALID", { count: 1 });
      expectDiagnostic(artifact, "SERVER_WRITE", { count: 1 });
      const head = artifact.diagnostics.find(e => e.code === "HEAD_TAG_INVALID")!;
      expect(head.ownerPath).toEqual(["<App>"]);
      const write = artifact.diagnostics.find(e => e.code === "SERVER_WRITE")!;
      expect(write.ownerPath).toEqual(["<App>"]);
      expect(write.data).toEqual({ category: "signal" });
      expect(() => expectNoDiagnostics(artifact)).toThrow(DiagnosticsAssertionError);
      expectNoDiagnostics(artifact, { allow: ["HEAD_TAG_INVALID", "SERVER_WRITE"] });

      // The records tables.
      const {
        boundary: boundaries,
        invocation: invocations,
        frame: frames,
        call: calls
      } = artifact.records;
      expect(frames).toEqual([]);
      expect(calls).toEqual([]);
      expect(boundaries).toHaveLength(1);
      expect(boundaries[0]).toMatchObject({
        passes: 2,
        outcome: "settled",
        streamed: true,
        heldMs: 0,
        ownerPath: ["<App>", "<Loading>"]
      });
      expect(boundaries[0].durationMs).toBeGreaterThanOrEqual(5);
      expect(invocations).toHaveLength(1);
      expect(invocations[0]).toMatchObject({ id: "getUser", direct: true, outcome: "ok" });
      // The join: the call ran in the boundary's pass, so its record names it.
      expect(invocations[0].boundary).toBe(boundaries[0].id);
      // The boundary waited on that call, not longer than the call plus a pass.
      expect(invocations[0].durationMs).toBeLessThanOrEqual(boundaries[0].durationMs);

      // Serializable as a whole and line by line.
      expect(JSON.parse(JSON.stringify(artifact.records))).toEqual(artifact.records);
      const lines = artifactToJSONL(artifact)
        .trim()
        .split("\n")
        .map(line => JSON.parse(line));
      expect(lines[0]).toMatchObject({
        type: "meta",
        formatVersion: 7,
        timeOrigin: performance.timeOrigin,
        diagnosticCount: 2,
        recordCounts: { boundary: 1, invocation: 1, frame: 0, call: 0 }
      });
      expect(lines.filter(l => l.type === "boundary")).toEqual([
        { type: "boundary", ...boundaries[0] }
      ]);
      expect(lines.filter(l => l.type === "invocation")).toEqual([
        { type: "invocation", ...invocations[0] }
      ]);
    } finally {
      warn.mockRestore();
    }
  });

  test("a waterfall behind a boundary is a finding the artifact's assertions catch", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      function Chain(props: { depth: number }): JSX.Element {
        const data = createMemo(async () => {
          await delay(3);
          return props.depth;
        });
        return (
          <div>{data() && (props.depth > 1 ? <Chain depth={props.depth - 1} /> : "leaf")}</div>
        );
      }
      function App() {
        return (
          <Loading fallback={<i>loading</i>}>
            <Chain depth={3} />
          </Loading>
        );
      }
      const { artifact } = await captureArtifact(() => stream(() => <App />), {
        attribution: false
      });
      expectDiagnostic(artifact, "ASYNC_WATERFALL", { count: 1 });
      const [boundary] = artifact.records.boundary;
      expect(boundary.passes).toBe(4);
      // The finding and the record are the same boundary.
      const finding = artifact.diagnostics.find(e => e.code === "ASYNC_WATERFALL")!;
      expect(finding.data!.boundary).toBe(boundary.id);
      expect(finding.severity).toBe("warn");
      expect(() => expectNoDiagnostics(artifact)).toThrow(/ASYNC_WATERFALL/);
    } finally {
      warn.mockRestore();
    }
  });

  test("a server component rendered to the frame transport is a frame row", async () => {
    const { renderServerComponent } = await import("../../frames/src/frame-sink.js");
    const ServerComp = (props: any) => (
      <section>
        <props.comment id={1} />
        <Loading fallback={<i>loading</i>}>
          <Slow ms={3} value="late" />
        </Loading>
      </section>
    );
    const { artifact } = await captureArtifact(
      // The stream is a thenable that collects its chunks; awaiting it runs it to `complete`.
      async () => {
        await renderServerComponent(ServerComp, { frame: { id: "getStory" } });
      },
      { attribution: false }
    );
    expect(artifact.records.frame).toHaveLength(1);
    expect(artifact.records.frame[0]).toMatchObject({
      side: "server",
      id: "getStory",
      version: 1,
      outcome: "complete",
      fragments: 1,
      slots: 1,
      regions: 0,
      errors: 0
    });
    // The boundary inside the frame is a boundary row too.
    expect(artifact.records.boundary).toHaveLength(1);
    const lines = artifactToJSONL(artifact)
      .trim()
      .split("\n")
      .map(line => JSON.parse(line));
    expect(lines.filter(l => l.type === "frame")).toHaveLength(1);
  });

  test("a render with no waits and no calls leaves the tables empty", async () => {
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <div>ready</div>
        </Loading>
      );
    }
    const { artifact } = await captureArtifact(() => stream(() => <App />), {
      attribution: false
    });
    expectNoDiagnostics(artifact);
    expect(artifact.records).toEqual({ boundary: [], invocation: [], frame: [], call: [] });
  });

  test("records outside the capture are not in it", async () => {
    function App() {
      return (
        <Loading fallback={<i>loading</i>}>
          <Slow ms={3} value="before" />
        </Loading>
      );
    }
    await stream(() => <App />);
    const { artifact } = await captureArtifact(() => {}, { attribution: false });
    expect(artifact.records).toEqual({ boundary: [], invocation: [], frame: [], call: [] });
  });
});
