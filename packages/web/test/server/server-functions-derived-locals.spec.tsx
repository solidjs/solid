/**
 * Derived-event `locals` scope for direct (SSR-time) server-function calls
 * (#3156). The derived event used to shallow-copy the event while SHARING
 * `locals`, so two concurrent direct calls in one render overwrote each
 * other's per-request context — tenant, user, DB handle — and the render's,
 * silently and interleaving-dependently, in exactly the applications with a
 * tenant to confuse. (The runtime always knew: its own invocation state
 * lives in a WeakMap because of this sharing. v1's `serverFunctionMeta` was
 * written into the shared locals and carried the same race from day one.)
 *
 * The ruling: `locals` is copied per derived call. Reads inherit everything
 * middleware put on the render's event — the only road context has into an
 * SSR-time call, since these calls never pass through middleware — and
 * nested objects stay shared by reference (request-scoped caches keep
 * working). Top-level writes stay call-local. `event.response` remains
 * shared on purpose: a cookie set during SSR reaching the page head is the
 * point of the stub.
 *
 * Like the other server-function specs, these run against the built bundles.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getRequestEvent } from "@solidjs/web";
import {
  createServerReference as createServerSideReference,
  registerServerReference
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");
let als: AsyncLocalStorage<unknown>;

beforeAll(() => {
  als = new AsyncLocalStorage();
  (globalThis as any)[RequestContext] = als;
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

function renderEvent(locals: Record<string, unknown>) {
  return { request: new Request("http://localhost/page"), locals };
}

describe("concurrent direct calls do not share locals writes (#3156)", () => {
  it("each call reads back what it wrote; the render is untouched", async () => {
    const make = (tenant: string) =>
      createServerSideReference(
        registerServerReference(`locals-tenant-${tenant}`, async () => {
          const event = getRequestEvent()!;
          event.locals.tenant = tenant;
          // the await is the race: the sibling call writes during this gap
          await new Promise(resolve => setTimeout(resolve, 10));
          return { wrote: tenant, readBack: event.locals.tenant };
        })
      );

    const outer = renderEvent({ tenant: "OUTER" });
    await als.run(outer, async () => {
      const [acme, globex] = await Promise.all([make("acme")(), make("globex")()]);
      // before the copy: acme read back "globex" and outer became "globex"
      expect(acme).toEqual({ wrote: "acme", readBack: "acme" });
      expect(globex).toEqual({ wrote: "globex", readBack: "globex" });
      expect(outer.locals.tenant).toBe("OUTER");
    });
  });

  it("reads inherit the render's middleware context — the copy is not a fresh bag", async () => {
    const whoami = createServerSideReference(
      registerServerReference("locals-inherit", async () => getRequestEvent()!.locals.user)
    );

    await als.run(renderEvent({ user: "authenticated-alice" }), async () => {
      expect(await whoami()).toBe("authenticated-alice");
    });
  });

  it("nested objects stay shared by reference: request-scoped caches keep working", async () => {
    // The copy is shallow ON PURPOSE — only top-level assignment is the
    // cross-call write channel. A Map or DB handle middleware installed is
    // one object for the whole request, whichever side mutates it.
    const memoize = createServerSideReference(
      registerServerReference("locals-cache", async () => {
        const cache = getRequestEvent()!.locals.cache as Map<string, number>;
        if (!cache.has("expensive")) cache.set("expensive", 42);
        return cache.get("expensive");
      })
    );

    const cache = new Map<string, number>();
    const outer = renderEvent({ cache });
    await als.run(outer, async () => {
      expect(await memoize()).toBe(42);
      // the write inside the call landed in the render's own Map
      expect(cache.get("expensive")).toBe(42);
    });
  });

  it("derives a usable locals even when the outer event carries none", async () => {
    // A custom provideEvent may establish a bare event; the derived call
    // must not crash on the copy and must still have a locals to write to.
    const writes = createServerSideReference(
      registerServerReference("locals-absent", async () => {
        const event = getRequestEvent()! as { locals: Record<string, unknown> };
        event.locals.scratch = "ok";
        return event.locals.scratch;
      })
    );

    await als.run({ request: new Request("http://localhost/page") }, async () => {
      expect(await writes()).toBe("ok");
    });
  });
});
