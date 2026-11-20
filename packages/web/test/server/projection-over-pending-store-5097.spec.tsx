/**
 * @jsxImportSource @solidjs/web
 */
// #5097: on the server, a projection whose fn returns a pending async store
// (`createProjection(() => rows, …)`, and `createOptimisticStore(() => rows,
// …)` through the same path) adopted it at creation, outside the NotReady
// retry, so the pending proxy's read escaped the component body. It now
// waits for the store like a derive that read it, as on the client.
import { describe, expect, test } from "vitest";
import { renderToStream } from "@solidjs/web";
import { createOptimisticStore, createProjection, createStore, Loading } from "solid-js";

const render = (App: () => any) =>
  new Promise<string>((resolve, reject) => {
    let out = "";
    renderToStream(() => <App />, { onError: reject }).pipe({
      write: (c: string) => {
        out += c;
      },
      end: () => resolve(out)
    });
  });

const rowsStore = () =>
  createStore(
    async () => {
      await new Promise(r => setTimeout(r, 10));
      return [{ id: 1, t: "A" }];
    },
    [] as { id: number; t: string }[],
    { key: "id" } as any
  )[0];

describe("#5097: a projection over a pending async store on the server", () => {
  test("createProjection(() => store) waits for the store", async () => {
    function App() {
      const rows = rowsStore();
      const view = createProjection((() => rows) as any, [] as any[], { key: "id" } as any);
      return (
        <Loading fallback="loading">
          <p>{view.map((r: any) => r.t).join(",")}</p>
        </Loading>
      );
    }
    const html = await render(App);
    expect(html).toMatch(/loading.*<p[^>]*>A<\/p>/s);
  });

  test("createOptimisticStore(() => store) waits for the store", async () => {
    function App() {
      const rows = rowsStore();
      const [view] = createOptimisticStore((() => rows) as any, [] as any[], { key: "id" } as any);
      return (
        <Loading fallback="loading">
          <p>{view.map((r: any) => r.t).join(",")}</p>
        </Loading>
      );
    }
    const html = await render(App);
    expect(html).toMatch(/loading.*<p[^>]*>A<\/p>/s);
  });
});
