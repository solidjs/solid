/**
 * @jsxImportSource @solidjs/web
 */
// #4028: in async mode (`await renderToStream(...)`) identical data must give
// identical bytes, whatever order the async sources settle in — a body-digest
// ETag on a cached page otherwise misses revalidations that should be 304s.
import { describe, expect, test } from "vitest";
import { renderToStream } from "@solidjs/web";
import { createMemo, Loading } from "solid-js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

function App(props: { delays: number[] }) {
  const items = props.delays.map((ms, i) =>
    createMemo(async () => {
      await wait(ms);
      return { id: i, name: "item-" + i, tags: ["t" + i, "shared"] };
    })
  );
  return (
    <div>
      {items.map(item => (
        <Loading fallback={<span>loading</span>}>
          <p>{item().name}</p>
        </Loading>
      ))}
    </div>
  );
}

describe("async-mode output is settle-order independent (#4028)", () => {
  test("identical data, different settle timing -> identical bytes", async () => {
    const fast = await renderToStream(() => <App delays={[5, 15, 25]} />);
    const slow = await renderToStream(() => <App delays={[25, 15, 5]} />);
    const mixed = await renderToStream(() => <App delays={[15, 25, 5]} />);
    expect(fast).toContain("item-2");
    expect(slow).toBe(fast);
    expect(mixed).toBe(fast);
  });

  test("a shared promise payload settling out of order stays deterministic", async () => {
    function Shared(props: { delays: number[] }) {
      const shared = { s: "shared" };
      const items = props.delays.map((ms, i) =>
        createMemo(async () => {
          await wait(ms);
          return { i, shared };
        })
      );
      return (
        <ul>
          {items.map(item => (
            <Loading fallback="...">
              <li>{item().i}</li>
            </Loading>
          ))}
        </ul>
      );
    }
    const a = await renderToStream(() => <Shared delays={[5, 20]} />);
    const b = await renderToStream(() => <Shared delays={[20, 5]} />);
    expect(b).toBe(a);
  });

  test("values first serialized by a settled boundary's retry pass stay in key order", async () => {
    function Detail(props: { id: number; ms: number }) {
      const detail = createMemo(async () => {
        await wait(props.ms);
        return { detail: "d" + props.id };
      });
      return <i>{detail().detail}</i>;
    }
    function Nested(props: { delays: number[] }) {
      const items = props.delays.map((ms, i) =>
        createMemo(async () => {
          await wait(ms);
          return { i };
        })
      );
      return (
        <ul>
          {items.map((item, i) => (
            <Loading fallback="...">
              <li>
                {item().i}
                <Loading fallback="..">
                  <Detail id={item().i} ms={props.delays[props.delays.length - 1 - i]} />
                </Loading>
              </li>
            </Loading>
          ))}
        </ul>
      );
    }
    const a = await renderToStream(() => <Nested delays={[5, 20, 10]} />);
    const b = await renderToStream(() => <Nested delays={[20, 10, 5]} />);
    expect(a).toContain("d2");
    // Different delays shift which item waits on which, but the data is the
    // same: the bytes must be too.
    expect(b).toBe(a);
  });

  test("a streaming consumer keeps delivering in settle order", async () => {
    const chunks: string[] = [];
    await new Promise<void>(resolve =>
      renderToStream(() => <App delays={[25, 5]} />).pipe({
        write: (c: string) => chunks.push(c),
        end: () => resolve()
      })
    );
    const html = chunks.join("");
    expect(html.indexOf("item-1")).toBeLessThan(html.indexOf("item-0"));
  });
});
