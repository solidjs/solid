/**
 * #3222 ON THE DIRECT SSR ROAD, ONE CONTAINER DOWN.
 *
 * Calling a generator only allocates it; calling a stream's reader is what
 * runs its pull. So the request scope around the CALL does not own either
 * body — the consumer drives it later, from whatever async context it
 * happens to be in, which during SSR is the render's ambient event.
 * `scopeDeferredResult` exists to bind those deferred operations to the
 * per-call event instead, and `server-functions-request-event-scope.spec.tsx`
 * pins it for a body the function RETURNS DIRECTLY.
 *
 * It only ever looks at that top level. A generator or stream handed back
 * inside an object or an array — `return { rows: cursor() }`, the shape the
 * codec road's guard walk was taught to descend into for exactly this
 * reason — is left bound to nothing, and #3222's harm comes straight back:
 *
 *   - the body reads and WRITES the render's `locals` rather than the
 *     per-call copy #3156 made for it, so two concurrent direct calls see
 *     each other's request state (call A reading call B's tenant, auth,
 *     DB handle);
 *   - the render's own `locals` is mutated by a call that was supposed to
 *     be unable to reach it.
 *
 * Each test runs two concurrent calls whose bodies interleave by design
 * (A sleeps longer than B, so B's write lands while A is parked). Correctly
 * scoped, each call reads back its OWN write — [["A:A"], ["B:B"]]; sharing
 * the ambient event gives A whatever B wrote last — [["A:B"], ["B:B"]].
 * The call counter proves both bodies actually ran, so an assertion cannot
 * pass on a result nobody produced.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createRequestEvent, getRequestEvent } from "@solidjs/web";
import { createServerReference } from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
const requestContext = new AsyncLocalStorage<any>();

beforeAll(() => {
  (globalThis as any)[RequestContext] = requestContext;
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** A's body parks long enough for B's whole call to land inside it. */
const pause = (who: string) => delay(who === "A" ? 30 : 5);

function renderEvent() {
  const event = createRequestEvent(new Request("https://app.example/page"));
  event.locals.writer = "none";
  return event;
}

async function drain<T>(source: AsyncIterable<T>) {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

async function readAll<T>(stream: ReadableStream<T>) {
  const reader = stream.getReader();
  const values: T[] = [];
  for (;;) {
    const step = await reader.read();
    if (step.done) return values;
    values.push(step.value);
  }
}

/** The body every case shares: write, park, read back what I wrote. */
async function* witness(who: string) {
  getRequestEvent()!.locals.writer = who;
  await pause(who);
  yield `${who}:${getRequestEvent()!.locals.writer}`;
}

describe("a deferred body nested in the result of a direct SSR call (#3222)", () => {
  it("isolates concurrent calls whose generator is nested in an object", async () => {
    let calls = 0;
    const reference = createServerReference({
      id: "nested-scope-object",
      name: "nestedScopeObject",
      fn: async (who: string) => {
        calls++;
        return { rows: witness(who) };
      }
    } as any) as (who: string) => Promise<{ rows: AsyncIterable<string> }>;
    const render = renderEvent();

    const values = await requestContext.run(render, () =>
      Promise.all([
        reference("A").then(result => drain(result.rows)),
        reference("B").then(result => drain(result.rows))
      ])
    );

    expect(calls).toBe(2);
    expect({ values, renderWriter: render.locals.writer }).toEqual({
      values: [["A:A"], ["B:B"]],
      // #3156's per-call copy is only per-call while the body runs under
      // the derived event; unscoped, the nested generator writes through
      // to the render itself
      renderWriter: "none"
    });
  });

  it("isolates concurrent calls whose generator is nested in an array", async () => {
    let calls = 0;
    const reference = createServerReference({
      id: "nested-scope-array",
      name: "nestedScopeArray",
      fn: async (who: string) => {
        calls++;
        return [witness(who)];
      }
    } as any) as (who: string) => Promise<AsyncIterable<string>[]>;
    const render = renderEvent();

    const values = await requestContext.run(render, () =>
      Promise.all([
        reference("A").then(result => drain(result[0])),
        reference("B").then(result => drain(result[0]))
      ])
    );

    expect(calls).toBe(2);
    expect({ values, renderWriter: render.locals.writer }).toEqual({
      values: [["A:A"], ["B:B"]],
      renderWriter: "none"
    });
  });

  it("isolates concurrent calls whose stream is nested in an object", async () => {
    let calls = 0;
    const reference = createServerReference({
      id: "nested-scope-stream",
      name: "nestedScopeStream",
      fn: async (who: string) => {
        calls++;
        return {
          feed: new ReadableStream<string>(
            {
              async pull(controller) {
                getRequestEvent()!.locals.writer = who;
                await pause(who);
                controller.enqueue(`${who}:${getRequestEvent()!.locals.writer}`);
                controller.close();
              }
            },
            { highWaterMark: 0 }
          )
        };
      }
    } as any) as (who: string) => Promise<{ feed: ReadableStream<string> }>;
    const render = renderEvent();

    const values = await requestContext.run(render, () =>
      Promise.all([
        reference("A").then(result => readAll(result.feed)),
        reference("B").then(result => readAll(result.feed))
      ])
    );

    expect(calls).toBe(2);
    expect({ values, renderWriter: render.locals.writer }).toEqual({
      values: [["A:A"], ["B:B"]],
      renderWriter: "none"
    });
  });
});
