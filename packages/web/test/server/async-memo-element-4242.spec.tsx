/**
 * @jsxImportSource @solidjs/web
 *
 * Server half of the #4242 remainder (see test/harness/async-memo-element-
 * 4242.tsx): an async memo that resolves to rendered output is refused with
 * ASYNC_MEMO_ELEMENT where it lands, before the serializer sees it, and the
 * memo's boundary contains the error like any render error. Before the fix
 * the landing went to the serializer: a boundary's accessor failed in seroval
 * (`SerovalUnsupportedTypeError`, the record never resolved, the client memo
 * waited forever) and a template object shipped as data (`{t:"<p…>"}`). The
 * nested-boundary shape also failed the whole request once refused, through
 * `abandonSubtree` reading the inner boundary's undefined fragment key.
 *
 * Renders each variant with renderToStream and writes the artifacts
 * test/hydration/async-memo-element-4242.spec.tsx replays; then pins the
 * finding and the detection's edges (what is refused, what is data).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createMemo, Errored, Loading, NoHydration, OBSERVE, type DiagnosticEvent } from "solid-js";
import { renderToStream } from "@solidjs/web";
import {
  codeOf,
  control,
  DATA_TEXT,
  useTiming,
  variants
} from "../harness/async-memo-element-4242.jsx";
import { recordStream, writeArtifact } from "./artifact-recorder.js";

const MESSAGE =
  "[ASYNC_MEMO_ELEMENT] An async memo resolved to rendered output (JSX, or a component's " +
  "result), which cannot be serialized for hydration: the client would wait on a value " +
  "that never arrives, and the boundary around it would never hydrate. Return data from " +
  "the async memo and render the JSX from it in the component " +
  "(`const user = createMemo(async () => fetchUser(id)); return <Profile user={user()} />`).";

const visibleText = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/g, "")
    .replace(/<template[\s\S]*?<\/template>/g, m => (m.includes('id="undefined"') ? "" : m))
    .replace(/<[^>]*>/g, "");

const original = { ...control };
afterEach(() => Object.assign(control, original));

describe("async memo resolving to rendered output (#4242) — server render", () => {
  for (const variant of variants) {
    test(`${variant.name}: writes the artifact`, async () => {
      useTiming(variant.timing);
      const logged: string[] = [];
      const errors: unknown[] = [];
      const error = vi
        .spyOn(console, "error")
        .mockImplementation((...a: unknown[]) => void logged.push(a.map(String).join(" ")));
      let recording;
      try {
        recording = await recordStream(() => <variant.App />, {
          onError: (e: unknown) => void errors.push(e)
        });
      } finally {
        error.mockRestore();
      }
      const { shell, rest } = recording;
      const doc = shell + rest;
      writeArtifact(variant.name, { name: variant.name, shell, rest });

      // Nothing reached the serializer that it could not encode, and the
      // request was never failed as a whole.
      expect(logged.join("\n")).not.toMatch(/cannot be parsed\/serialized|Seroval/);
      expect(logged.join("\n")).not.toContain("the request failed");
      // Shell first, landing later — or all in the shell.
      if (variant.timing === "streamed") expect(visibleText(shell)).toMatch(/outer|loading/);
      else expect(rest).toBe("");

      if (variant.shape === "data") {
        expect(errors).toEqual([]);
        expect(logged).toEqual([]);
        expect(visibleText(doc)).toContain(DATA_TEXT.replace(/</g, "&lt;"));
        // Every value crossed as data: the client adopts these records.
        expect(doc).toContain('new Date("2026-10-24T00:00:00.000Z")');
        expect(doc).toContain('{t:"plain text"}');
        expect(doc).toContain('{name:"Ada"');
        return;
      }

      const code = variant.reference ? "SERVER_RENDER_ERROR" : "ASYNC_MEMO_ELEMENT";
      // One error, the refusal (or the twin's), heard once by the render's
      // hook — and routed by the boundary, not dropped by the serializer.
      expect(errors.map(codeOf)).toEqual([code]);
      expect(logged).toHaveLength(1);
      expect(logged[0]).toMatch(/^\[SSR_RENDER_ERROR_CONTAINED\]/);
      expect(logged[0]).toContain(`[${code}]`);
      // The memo's record is the rejection; no rendered output is data.
      expect(doc).toContain(`new Error("[${code}]`);
      expect(doc).not.toMatch(/\{t:"/);
      expect(visibleText(doc)).not.toMatch(/jsx-41|nested-41/);
      if (!variant.reference) expect(errors[0]).toEqual(new Error(MESSAGE));

      if (variant.errored) {
        // Caught by the <Errored> inside the <Loading>: its fallback is the
        // boundary's content, and the client hydrates it.
        expect(logged[0]).toContain("caught by <Errored>");
        if (variant.shape === "jsx")
          expect(doc).toMatch(/<b[^>]*id="caught">ASYNC_MEMO_ELEMENT<\/b>/);
        else expect(visibleText(doc)).toContain("caught:ASYNC_MEMO_ELEMENT");
      } else {
        // Uncontained: the <Loading> fragment rejects and the client renders
        // the subtree — the same road as the reference twin's plain Error.
        expect(logged[0]).toContain("the fragment rejected and the client re-renders it");
        if (variant.shape === "jsx") expect(shell).toMatch(/^<main/);
      }
    });
  }
});

describe("ASYNC_MEMO_ELEMENT — the finding and what the detection refuses", () => {
  let capture: ReturnType<NonNullable<typeof OBSERVE>["diagnostics"]["capture"]>;
  let error: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    capture = OBSERVE!.diagnostics.capture();
    error = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    capture.stop();
    error.mockRestore();
  });
  const findings = () =>
    capture.events.filter((e: DiagnosticEvent) => e.code === "ASYNC_MEMO_ELEMENT");
  const tick = () => new Promise<void>(r => setTimeout(r, 2));

  /**
   * Renders a memo over `source` inside <Loading><Errored>, its value shown
   * through `show` (the value itself by default); the markup without scripts.
   */
  async function land(
    source: () => any,
    opts: { noHydration?: boolean; show?: (v: any) => any } = {}
  ) {
    const errors: unknown[] = [];
    const show = opts.show || ((v: any) => v);
    function Body() {
      const value = createMemo(source);
      return <div id="value">{show(value())}</div>;
    }
    const tree = () => (
      <Loading fallback={<span>loading</span>}>
        <Errored fallback={err => <i id="caught">{codeOf(err())}</i>}>
          <Body />
        </Errored>
      </Loading>
    );
    const html = await renderToStream(
      () => (opts.noHydration ? <NoHydration>{tree()}</NoHydration> : tree()),
      { onError: (e: unknown) => void errors.push(e) }
    );
    return { html: html.replace(/<script[\s\S]*?<\/script>/g, ""), errors };
  }

  test("a refusal is recorded once, an ssr error carrying the message and the memo's owner path", async () => {
    const { html, errors } = await land(() => {
      const el = <b>element</b>;
      return tick().then(() => el);
    });
    expect(html).toMatch(/<i[^>]*id="caught">ASYNC_MEMO_ELEMENT<\/i>/);
    expect(html).not.toContain("element</b>");
    expect(errors).toEqual([new Error(MESSAGE)]);
    const [finding, ...rest] = findings();
    expect(rest).toHaveLength(0);
    expect(finding.kind).toBe("ssr");
    expect(finding.severity).toBe("error");
    expect(finding.message).toBe(MESSAGE);
    expect(finding.ownerPath).toContain("<Body>");
  });

  test("a fragment (array) of elements and a boundary's output are refused", async () => {
    const fragment = await land(() => {
      const els = [<b>one</b>, [<b>two</b>]];
      return tick().then(() => els);
    });
    expect(fragment.html).toMatch(/id="caught">ASYNC_MEMO_ELEMENT</);
    const boundary = await land(() => {
      const el = <Loading fallback="inner">{"x"}</Loading>;
      return tick().then(() => el);
    });
    expect(boundary.html).toMatch(/id="caught">ASYNC_MEMO_ELEMENT</);
    expect(findings()).toHaveLength(2);
  });

  test("an async iterable whose first value is an element is refused; one yielding data is not", async () => {
    const element = await land(() => {
      const el = <b>yielded</b>;
      return (async function* () {
        await tick();
        yield el;
      })();
    });
    expect(element.html).toMatch(/id="caught">ASYNC_MEMO_ELEMENT</);
    expect(findings()).toHaveLength(1);

    const data = await land(() =>
      (async function* () {
        await tick();
        yield "first";
        yield "second";
      })()
    );
    expect(data.errors).toEqual([]);
    expect(data.html).toContain("first");
    expect(findings()).toHaveLength(1);
  });

  test("a promise resolving to an async iterable of elements is refused at its first yield", async () => {
    const { html } = await land(() => {
      const el = <b>yielded</b>;
      return tick().then(() =>
        (async function* () {
          yield el;
        })()
      );
    });
    expect(html).toMatch(/id="caught">ASYNC_MEMO_ELEMENT</);
    expect(findings()).toHaveLength(1);
  });

  test("data near the markers is never refused", async () => {
    class Point {
      constructor(
        public t: string,
        public y = 1
      ) {}
    }
    const cyclic: any[] = [1];
    cyclic.push(cyclic, [cyclic]);
    const values: unknown[] = [
      { t: "plain" },
      { t: "<b>markup in data</b>", id: 1 },
      [{ t: "plain" }, "<p>", 3, [{ t: "<i>", n: 1 }]],
      "<p>a string</p>",
      new Date(0),
      new Map([["t", "<b>"]]),
      Object.assign(Object.create(null), { t: "<b>" }),
      cyclic
    ];
    for (const value of values) {
      const { html, errors } = await land(() => tick().then(() => value), {
        show: v => `landed:${typeof v}`
      });
      expect(errors).toEqual([]);
      expect(html).toContain("landed:");
    }
    // A class instance is never inspected: whether it crosses is the
    // serializer's (and its plugins') call, as before — seroval has no
    // encoding for this one and says so itself.
    const instance = await land(() => tick().then(() => new Point("<b>")), {
      show: v => `landed:${typeof v}`
    });
    expect(instance.html).toContain("landed:object");
    expect(instance.errors.map(e => String(e))).toEqual([
      expect.stringContaining("cannot be parsed/serialized")
    ]);
    expect(findings()).toHaveLength(0);
  });

  test("where nothing is serialized (NoHydration) an element landing renders as before", async () => {
    const { html, errors } = await land(
      () => {
        const el = <b>server-only</b>;
        return tick().then(() => el);
      },
      { noHydration: true }
    );
    expect(errors).toEqual([]);
    expect(html).toContain("<b>server-only</b>");
    expect(findings()).toHaveLength(0);
  });
});
