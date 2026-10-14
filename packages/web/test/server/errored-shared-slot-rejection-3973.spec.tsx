/**
 * @jsxImportSource @solidjs/web
 *
 * solidjs/solid#3973 — under `renderToStream`, an `<Errored>` that shares a
 * `{props.children}` slot with an async sibling contains a rejection (its
 * fallback renders), but the aggregate promise its `resolve` threw while the
 * hole was pending is dropped when the slot retries, so the rejection was
 * reported as unhandled and exited Node.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, Errored } from "@solidjs/web";
import { createMemo } from "solid-js";
import type { ParentProps } from "solid-js";

function delay(ms: number) {
  return new Promise(r => setTimeout(r, ms));
}

async function watchRejections<T>(run: () => Promise<T> | T, settleTurns = 4) {
  const previous = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  const escaped: unknown[] = [];
  const capture = (reason: unknown) => escaped.push(reason);
  process.on("unhandledRejection", capture);
  try {
    const value = await run();
    for (let turn = 0; turn < settleTurns; turn++) await delay(20);
    return { escaped, value };
  } finally {
    process.off("unhandledRejection", capture);
    for (const listener of previous) process.on("unhandledRejection", listener as any);
  }
}

const messages = (escaped: unknown[]) => escaped.map(e => (e as Error).message);
const stripScripts = (html: string) =>
  html.replace(/<script[\s\S]*?<\/script>/g, "").replace(/ _hk=\w+/g, "");

function Layout(props: ParentProps) {
  return <main>{props.children}</main>;
}

function Fails() {
  const value = createMemo(async () => {
    await delay(5);
    throw new Error("boom");
  });
  return <p>{value()}</p>;
}

function Later() {
  const value = createMemo(async () => {
    await delay(20);
    return "later";
  });
  return <p>{value()}</p>;
}

describe("#3973 a rejection contained by <Errored> in a shared slot is handled", () => {
  test("an async sibling in the same children slot", async () => {
    const { escaped, value } = await watchRejections(
      () =>
        renderToStream(() => (
          <Loading fallback={<p>loading</p>}>
            <Layout>
              <Errored fallback={() => <p>failed</p>}>
                <Fails />
              </Errored>
              <Later />
            </Layout>
          </Loading>
        )) as unknown as Promise<string>
    );
    expect(stripScripts(value)).toContain("<main><p>failed</p><p>later</p></main>");
    expect(messages(escaped)).toEqual([]);
  });

  test("an outer <Errored> sees no error either", async () => {
    let outer: unknown;
    const { escaped, value } = await watchRejections(
      () =>
        renderToStream(() => (
          <Errored
            fallback={error => {
              outer = error;
              return <p>outer</p>;
            }}
          >
            <Loading fallback={<p>loading</p>}>
              <Layout>
                <Errored fallback={() => <p>failed</p>}>
                  <Fails />
                </Errored>
                <Later />
              </Layout>
            </Loading>
          </Errored>
        )) as unknown as Promise<string>
    );
    expect(stripScripts(value)).toContain("<main><p>failed</p><p>later</p></main>");
    expect(outer).toBeUndefined();
    expect(messages(escaped)).toEqual([]);
  });
});
