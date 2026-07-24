/**
 * @jsxImportSource @solidjs/web
 */
// The client+server seam, SSR half. A client fill rendered into a server
// component is rendered INLINE during in-process SSR, so it sits inside the
// server component's own <Loading> and holds it — the parent client <Loading>
// may flush the shell (the server's fallback is concrete content), but the
// server component's <Loading> is a live server-side fragment that holds the
// fill and reveals it. Nothing is orphaned; there is no second timeline to
// miss. (The post-load half — where renderServerComponent ships a bare slot
// marker and the client reconstructs the boundary — is covered in
// frames-client.spec.tsx.)
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, dynamic } from "@solidjs/web";
import { createMemo } from "solid-js";
import {
  frameTransformDirectResult,
  ServerComponentPlugin
} from "@dom-expressions/runtime/src/frame-sink.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect(code: () => any, plugins?: any[]): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, plugins ? ({ plugins } as any) : undefined).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

describe("client+server seam under SSR", () => {
  test("an async client fill is held by the server component's own <Loading>, not orphaned", async () => {
    const AsyncFill = () => {
      // Downstream async that only appears once the fill renders — the shape of
      // a client component with its own data.
      const d = createMemo(() => wait(40).then(() => "FILLASYNC"));
      return <span>{d()}</span>;
    };
    // Server component with its OWN boundary: it shows a fallback and reports
    // "done" to the parent at first flush — the case that felt like it should
    // let the parent flush past the fill.
    const ServerComp = (props: any) => (
      <Loading fallback={<span>SERVERFB</span>}>
        <div>
          SHELL
          {props.body}
        </div>
      </Loading>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "f" }) as any;
    const Story = dynamic(() => wait(10).then(() => Inline));

    const html = await collect(
      () => (
        <Loading fallback={<span>PARENTFB</span>}>
          <Story body={() => <AsyncFill />} />
        </Loading>
      ),
      [ServerComponentPlugin]
    );

    expect(html).toContain("SHELL");
    // The fill's downstream async made it into the SSR output — held by a live
    // server fragment and revealed, not dropped when the parent flushed.
    expect(html).toContain("FILLASYNC");
  });

  test("with no server boundary, the parent itself waits for the fill", async () => {
    const AsyncFill = () => {
      const d = createMemo(() => wait(40).then(() => "FILLASYNC"));
      return <span>{d()}</span>;
    };
    const ServerComp = (props: any) => (
      <div>
        SHELL
        {props.body}
      </div>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "f" }) as any;

    const html = await collect(
      () => (
        <Loading fallback={<span>PARENTFB</span>}>{Inline({ body: () => <AsyncFill /> })}</Loading>
      ),
      [ServerComponentPlugin]
    );

    expect(html).toContain("SHELL");
    expect(html).toContain("FILLASYNC");
  });
});
