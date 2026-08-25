/**
 * @jsxImportSource @solidjs/web
 */
// The context barrier at server-component render roots. A server component
// renders inline in the document at t=0 but standalone on every refetch and
// mutation region, so app context must never cross its root — a read that
// "worked" once and broke on the next response would be a silent divergence.
// The barrier rebuilds the scope's context record: user context is severed
// (default-less reads throw an explanatory error, defaulted reads agree with
// the standalone default), providers INSIDE the component work normally, and
// the boundary plumbing (Loading / error / reveal coordination) still
// crosses — the back-and-forth between a server component's async content
// and the enclosing boundaries at t=0 is intentional. Client slot positions
// re-enter the zone owner captured outside the barrier, so the client's own
// components keep full app context during document SSR.
import { describe, expect, test } from "vitest";
import { renderToStream, Errored, Loading } from "@solidjs/web";
import { createContext, useContext, createMemo } from "solid-js";
import { frameTransformDirectResult, ServerComponentPlugin } from "../../frames/src/frame-sink.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function collect(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code, { plugins: [ServerComponentPlugin] } as any).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

describe("server-component context barrier", () => {
  test("a default-less app context read inside a server component throws the explanatory error, even at t=0 under a live provider", async () => {
    const Ctx = createContext<string>(undefined, { name: "AppCtx" });
    const Reader = () => <span>{useContext(Ctx)}</span>;
    const ServerComp = () => (
      <div>
        <Reader />
      </div>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "sc-ctx" }) as any;

    const html = await collect(() => (
      <Ctx value="OUTER-VALUE">
        <Errored fallback={(e: any) => <div>ERR:{e().message}</div>}>{Inline({})}</Errored>
      </Ctx>
    ));

    expect(html).toContain("cannot be read inside a server component");
    expect(html).toContain("AppCtx");
    expect(html).not.toContain("OUTER-VALUE");
  });

  test("a defaulted context reads its default inside a server component, not the app value (t=0 agrees with standalone)", async () => {
    const Theme = createContext("default-theme");
    const ServerComp = () => <div>{useContext(Theme)}</div>;
    const Inline = frameTransformDirectResult(ServerComp, { id: "sc-theme" }) as any;

    const html = await collect(() => <Theme value="app-theme">{Inline({})}</Theme>);

    expect(html).toContain("default-theme");
    expect(html).not.toContain("app-theme");
  });

  test("a provider rendered inside the server component works normally", async () => {
    const Ctx = createContext<string>();
    const Inner = () => <em>{useContext(Ctx)}</em>;
    const ServerComp = () => (
      <Ctx value="inner-value">
        <Inner />
      </Ctx>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "sc-provider" }) as any;

    const html = await collect(() => Inline({}));

    expect(html).toContain("inner-value");
  });

  test("client slot content keeps full app context at t=0 (positions re-enter the caller's zone, outside the barrier)", async () => {
    const Ctx = createContext<string>();
    const ClientReader = () => <button>{useContext(Ctx)}</button>;
    const ServerComp = (props: any) => (
      <div>
        SHELL
        {props.body}
      </div>
    );
    const Inline = frameTransformDirectResult(ServerComp, { id: "sc-slot" }) as any;

    const html = await collect(() => (
      <Ctx value="app-value">{Inline({ body: () => <ClientReader /> })}</Ctx>
    ));

    expect(html).toContain("SHELL");
    expect(html).toContain("app-value");
  });

  test("async content inside a server component still coordinates with the enclosing Loading (boundary plumbing crosses)", async () => {
    const ServerComp = () => {
      const d = createMemo(() => wait(10).then(() => "ASYNC-DONE"));
      return <div>{d()}</div>;
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "sc-async" }) as any;

    const html = await collect(() => <Loading fallback={<span>FB</span>}>{Inline({})}</Loading>);

    expect(html).toContain("ASYNC-DONE");
  });

  test("a real error inside a server component reaches the app's Errored boundary (error routing crosses)", async () => {
    const ServerComp = () => {
      throw new Error("boom-inside-sc");
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "sc-error" }) as any;

    const html = await collect(() => (
      <Errored fallback={(e: any) => <div>CAUGHT:{e().message}</div>}>{Inline({})}</Errored>
    ));

    expect(html).toContain("CAUGHT:");
    expect(html).toContain("boom-inside-sc");
  });
});
