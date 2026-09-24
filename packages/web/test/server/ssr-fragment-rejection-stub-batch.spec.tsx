/**
 * @jsxImportSource @solidjs/web
 *
 * A fragment whose `<key>_fr` promise rejects while it still waits in the
 * pre-shell batch.
 *
 * Sibling of ssr-serialized-rejection-stub-batch.spec.tsx: that one covers the
 * `trackSerialized` race; this one covers the other promise `registerFragment`
 * parks in `stubBatch` before the shell completes — the fragment's own
 * `<key>_fr`. The batch is flushed at the top of a shell flush attempt, and no
 * attempt runs while the shell is held on a root hole (`allSettled` on the
 * blocking set) or a no-progress timer. A `<Loading>` whose content throws on
 * a retry pass inside that window settles through `done(undefined, err)`
 * (`item.resolve(err)`), rejecting a promise nothing has subscribed to yet:
 * Node reports an `unhandledRejection` and, by default, exits the process.
 *
 * Only shapes where the FRAGMENT rejects are exposed. An `<Errored>` inside
 * the boundary catches first and the fragment resolves clean (that shape is
 * the serialized-race case in the sibling spec). An `<Errored>` OUTSIDE the
 * boundary does not help pre-shell: once the fragment is registered its
 * channel owns error routing (#2997), so `_fr` rejects all the same.
 *
 * Detection as in the sibling spec: each test owns the process's
 * `unhandledRejection` listeners for its duration, so a leak fails THIS test.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, Loading, Errored } from "@solidjs/web";
import { createMemo } from "solid-js";

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
const stripScripts = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");

/** A read that settles a few macrotasks later — long enough to hold the shell. */
function useSlow(value: string, ms = 30) {
  return createMemo(async () => {
    await delay(ms);
    return value;
  });
}

/**
 * The shell is held on the root hole `held`; the sibling boundary `slow`
 * keeps the fragment registry non-empty so the render does not complete in
 * the same drain. The boundary under test rejects inside that window.
 */
function renderHeld(content: () => any) {
  const errors: string[] = [];
  const App = () => {
    const held = useSlow("shell");
    const slow = useSlow("slow");
    return (
      <div>
        <span>{held()}</span>
        <Loading fallback="loading slow">
          <span>{slow()}</span>
        </Loading>
        {content()}
      </div>
    );
  };
  const run = () =>
    renderToStream(() => <App />, {
      onError(error: any) {
        errors.push(error.message);
      }
    }).then(html => html);
  return { run, errors };
}

/** The errored region inlines away pre-shell; `_fr` carries the rejection. */
function expectRoutedToClient(html: string, errors: string[], message: string) {
  const markup = stripScripts(html);
  expect(markup).toMatch(/<span[^>]*>slow<\/span>/);
  expect(markup).not.toContain(message);
  expect(markup).toContain("<!--$--><!--/--></div>");
  // Defusing the parked promise does not hide the rejection from seroval:
  // it still reaches the wire once the batch is flushed.
  expect(html).toContain(`new Error("${message}")`);
  expect(errors).toEqual([message]);
}

describe("a fragment whose <key>_fr rejects while it waits in the pre-shell batch", () => {
  test("an async memo rejecting in its first microtask, read under a bare <Loading>", async () => {
    const { run, errors } = renderHeld(() => {
      const data = createMemo(async (): Promise<string> => {
        throw new Error("refused");
      });
      return (
        <Loading fallback="loading">
          <p>{data()}</p>
        </Loading>
      );
    });
    const { escaped, value } = await watchRejections(run);
    expect(messages(escaped)).toEqual([]);
    expectRoutedToClient(value, errors, "refused");
  });

  test("the same read with an <Errored> OUTSIDE the <Loading> — the fragment channel still owns the error", async () => {
    const { run, errors } = renderHeld(() => {
      const data = createMemo(async (): Promise<string> => {
        throw new Error("refused");
      });
      return (
        <Errored fallback={error => <p>{String(error())}</p>}>
          <Loading fallback="loading">
            <p>{data()}</p>
          </Loading>
        </Errored>
      );
    });
    const { escaped, value } = await watchRejections(run);
    expect(messages(escaped)).toEqual([]);
    expectRoutedToClient(value, errors, "refused");
  });

  test("a component body throwing synchronously on the retry pass, after its read resolved", async () => {
    const { run, errors } = renderHeld(() => {
      const data = useSlow("data", 5);
      const Throws = () => {
        const v = data();
        throw new Error("refused after " + v);
      };
      return (
        <Loading fallback="loading">
          <Throws />
        </Loading>
      );
    });
    const { escaped, value } = await watchRejections(run);
    expect(messages(escaped)).toEqual([]);
    expectRoutedToClient(value, errors, "refused after data");
  });
});
