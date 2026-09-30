/**
 * @jsxImportSource @solidjs/web
 *
 * Concurrent renders × each render's `serialize`. A finished `renderToString`
 * context lingers as the module-global `sharedConfig.context`, so a write
 * that lands later for another in-flight render must be judged by the render
 * it belongs to — never by whatever context the global happens to hold.
 */
import { describe, expect, test } from "vitest";
import { renderToString, renderToStream, Loading } from "@solidjs/web";
import { createMemo, getOwner } from "solid-js";
import { sharedConfig } from "solid-js/internal";
import { hydrationRecordKeys } from "../harness/hydration-records.js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

function otherRequestCompletes(streamContext: unknown) {
  renderToString(() => <p>other request</p>);
  expect(sharedConfig.context).not.toBe(streamContext);
}

describe("a stream's writes after another request's renderToString finished", () => {
  for (const interleave of [false, true]) {
    test(`library write from IO after the render pass (interleaved renderToString: ${interleave})`, async () => {
      let lateWrite!: () => void;
      const gate = new Promise<void>(r => (lateWrite = r));
      const hold = delay(30);
      let streamContext: unknown;
      const streamed = renderComplete(() => {
        // Captured like solid-query's provider: written later from a cache event.
        const ctx = (streamContext = sharedConfig.context) as any;
        gate.then(() => ctx.serialize("lib:late", { v: "late" }));
        function Held() {
          const m = createMemo(async () => {
            await hold;
            return "held";
          });
          return <b>{m()}</b>;
        }
        return (
          <div>
            <Loading fallback={<i>...</i>}>
              <Held />
            </Loading>
          </div>
        );
      });
      if (interleave) otherRequestCompletes(streamContext);
      lateWrite();
      expect(hydrationRecordKeys(await streamed)).toContain("lib:late");
    });

    test(`runtime write: chained async memo on a Loading retry pass (interleaved renderToString: ${interleave})`, async () => {
      const hold = delay(20);
      let bOwner: string | undefined;
      let streamContext: unknown;
      const streamed = renderComplete(() => {
        streamContext = sharedConfig.context;
        function Chained() {
          const a = createMemo(async () => {
            await hold;
            return 1;
          });
          return (() => {
            const v = a();
            const b = createMemo(async () => {
              await delay(5);
              return "b" + v;
            });
            bOwner = getOwner()?.id;
            return <b>{b()}</b>;
          })();
        }
        return (
          <div>
            <Loading fallback={<i>...</i>}>
              <Chained />
            </Loading>
          </div>
        );
      });
      if (interleave) otherRequestCompletes(streamContext);
      const html = await streamed;
      expect(html).toContain("b1");
      // b's record: the client adopts it instead of recomputing b.
      expect(hydrationRecordKeys(html)).toContain(bOwner + "1");
    });
  }
});

describe("a finished renderToString's late writes", () => {
  test("are dropped by its own closed latch, not the global context", async () => {
    let captured: any;
    renderToString(() => {
      captured = sharedConfig.context;
      return <div />;
    });
    const hold = delay(10);
    const streamed = renderComplete(() => {
      const m = createMemo(async () => {
        await hold;
        return "held";
      });
      return (
        <Loading fallback={<i>...</i>}>
          <b>{m()}</b>
        </Loading>
      );
    });
    // Another request's stream now owns the module global.
    expect(sharedConfig.context).not.toBe(captured);
    // An async value would throw if the closed render still accepted writes.
    expect(() => captured.serialize("late", Promise.resolve(1))).not.toThrow();
    expect(() => captured.serialize("late-sync", { v: 1 })).not.toThrow();
    expect(await streamed).toContain("held");
  });
});
