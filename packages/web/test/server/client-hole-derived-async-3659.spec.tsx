/**
 * @jsxImportSource @solidjs/web
 */
// #3659: a derived ASYNC computation whose compute reads a bare
// `ssrSource: "client"` source inside `<Loading>` must classify FINAL and
// hand the position to the client, the same as a direct or sync-derived
// read does. Before the fix the derived computation's own pending source
// (its deferred / the shell blocker) was a fresh untagged promise that could
// never settle: the boundary awaited it forever, seroval awaited the
// serialized channel forever, and the response never completed.
//
// Pinned against the real renderer: each shape's stream must END. A hang
// here is the test's timeout — the assertion is completion, not a duration.
import { describe, expect, test } from "vitest";
import { Loading, dynamic, renderToStream } from "@solidjs/web";
import { createMemo, createProjection, OBSERVE, type BoundaryEvent } from "solid-js";

/** Streams through a sink like a response does; resolves with everything written. */
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

function boundaryRecords() {
  const seen: BoundaryEvent[] = [];
  const off = OBSERVE!.records.subscribe("boundary", event => {
    seen.push(event);
  });
  return { seen, off };
}

const clientSource = () =>
  (createMemo as any)(() => Promise.resolve([1, 2, 3]), { ssrSource: "client" }) as () => number[];

describe("derived async computations over a client hole hand off instead of hanging (#3659)", () => {
  test("control: a SYNC derived memo over the hole hands off at discovery", async () => {
    const { seen, off } = boundaryRecords();
    function Derived() {
      const client = clientSource();
      const derived = createMemo(() => client().length);
      return <div>{derived()}</div>;
    }
    const html = await stream(() => (
      <Loading fallback={<i>loading</i>}>
        <Derived />
      </Loading>
    ));
    off();
    expect(html).toContain("loading");
    expect(seen.map(e => e.outcome)).toEqual(["client"]);
  });

  test("async memo: createMemo(async () => client().length) completes and hands off", async () => {
    const { seen, off } = boundaryRecords();
    function Derived() {
      const client = clientSource();
      const derived = createMemo(async () => client().length);
      return <div>{derived()}</div>;
    }
    const html = await stream(() => (
      <Loading fallback={<i>loading</i>}>
        <Derived />
      </Loading>
    ));
    off();
    expect(html).toContain("loading");
    // The client renders the content: no server-rendered `<div>3</div>`.
    expect(html).not.toContain("<div>3</div>");
    expect(seen.map(e => e.outcome)).toEqual(["client"]);
  });

  test("projection: createProjection(d => { d.n = client().length }) completes and hands off", async () => {
    const { seen, off } = boundaryRecords();
    function Derived() {
      const client = clientSource();
      const proj = createProjection(
        (d: { n: number }) => {
          d.n = client().length;
        },
        { n: 0 }
      );
      return <div>{proj.n}</div>;
    }
    const html = await stream(() => (
      <Loading fallback={<i>loading</i>}>
        <Derived />
      </Loading>
    ));
    off();
    expect(html).toContain("loading");
    expect(html).not.toContain("<div>3</div>");
    expect(seen.map(e => e.outcome)).toEqual(["client"]);
  });

  test("dynamic({ deferStream }): a client-hole source never blocks the shell; the boundary hands off", async () => {
    const { seen, off } = boundaryRecords();
    function Derived() {
      const client = clientSource();
      const Dyn = dynamic(() => (client().length ? "span" : "b"), { deferStream: true });
      return <Dyn>x</Dyn>;
    }
    const html = await stream(() => (
      <Loading fallback={<i>loading</i>}>
        <Derived />
      </Loading>
    ));
    off();
    expect(html).toContain("loading");
    expect(html).not.toContain("<span");
    expect(seen.map(e => e.outcome)).toEqual(["client"]);
  });

  test("control: dynamic({ deferStream }) over a REAL async source still holds the shell for it", async () => {
    function Derived() {
      const tag = createMemo(async () => {
        await new Promise(r => setTimeout(r, 5));
        return "span";
      });
      const Dyn = dynamic(() => tag() as any, { deferStream: true });
      return <Dyn>x</Dyn>;
    }
    const html = await stream(() => (
      <Loading fallback={<i>loading</i>}>
        <Derived />
      </Loading>
    ));
    // deferStream: the shell waited for the source, so the content is inline
    // in the shell — not behind a streamed fragment.
    expect(html).toContain("<span");
    expect(html.indexOf("<span")).toBeLessThan(html.indexOf("<script"));
  });

  test("outside <Loading>: a derived async read of the hole is still the loud error, not a hang", async () => {
    const errors: unknown[] = [];
    function Derived() {
      const client = clientSource();
      const derived = createMemo(async () => client().length);
      return <div>{derived()}</div>;
    }
    const html = await new Promise<string>(resolve => {
      const chunks: string[] = [];
      renderToStream(() => <Derived />, {
        onError(err: unknown) {
          errors.push(err);
        }
      } as any).pipe({
        write(chunk: string) {
          chunks.push(chunk);
        },
        end() {
          resolve(chunks.join(""));
        }
      });
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(String(errors[0])).toMatch(/ASYNC_OUTSIDE_LOADING_BOUNDARY/);
    expect(html).not.toContain("<div>3</div>");
  });
});
