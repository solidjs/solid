/**
 * The fold must own a `transformFlightResult` Response before stamping it.
 *
 * `transformFlightResult` is the seam where an integration builds the
 * single-flight body itself, and its contract is "return a Response" —
 * nothing in it says the Response must be freshly constructed on every
 * call. `foldFlightData` then appends the mutation's `Set-Cookie`s onto
 * whatever came back and gap-fills the accumulated headers into it, writing
 * through to an object the integration may still hold.
 *
 * That the runtime knows this is in-contract is visible in the thrown
 * path's own fold tail, which copies before ITS write with the comment "the
 * fold may hand back a Response an integration hook caches (see
 * ownResponse)" — the same argument, applied on one leg and not the other.
 * Copying there does not help: the fold's writes already landed on the
 * shared object before the copy is taken.
 *
 * What leaks is the worst thing that can: session cookies. A transform that
 * memoizes its rendered shell hands tenant A's `Set-Cookie` to tenant B and
 * then hands both to tenant C, with no error anywhere — the same class of
 * defect `ownResponse` was introduced for (#3155).
 *
 * Reachability, stated honestly: stock Solid is not affected. The frames
 * policy (`frameTransformFlightResult`) constructs a fresh Response per
 * call, so nothing in-tree caches one. These specs pin the contract for the
 * seam as documented, which any integration may implement.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  SINGLE_FLIGHT_HEADER,
  handleServerFunctionRequest,
  registerFlightDataSource,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

// not re-exported from the server entry; the wire name is the contract here
const BODY_FORMAT_HEADER = "X-Server-Function-Format";
const JSON_BODY_FORMAT = "8";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

/**
 * A transform that keeps the Response it built — the shape the contract
 * permits and this spec is about. `retained` is the object the integration
 * still holds after the request is over.
 */
function memoizingTransform() {
  let retained: Response | undefined;
  const transform = async () => {
    if (!retained) {
      retained = new Response("<frame>region</frame>", {
        status: 200,
        headers: { "X-Content-Raw": "1", "Content-Type": "text/html" }
      });
    }
    return retained;
  };
  return {
    transform,
    get retained() {
      return retained!;
    }
  };
}

/** One tenant's mutation: it sets that tenant's session cookie. */
async function callAs(id: string, tenant: string, transformFlightResult: any) {
  return handleServerFunctionRequest(
    new Request(`http://localhost/_server/data/${id}`, {
      method: "POST",
      headers: {
        "Sec-Fetch-Site": "same-origin",
        "X-Server-Function-Instance": "server-function:test",
        [BODY_FORMAT_HEADER]: JSON_BODY_FORMAT,
        referer: `http://localhost/tenant/${tenant}/cart`,
        [SINGLE_FLIGHT_HEADER]: "router"
      },
      body: JSON.stringify([tenant])
    }),
    { transformFlightResult }
  );
}

describe("single-flight fold owns the transformed response", () => {
  it("does not stamp one tenant's session cookie onto the next tenant's response (returned outcome)", async () => {
    registerServerFunction(
      "sf-own-returned",
      async (tenant: string) =>
        new Response(null, {
          status: 303,
          headers: { Location: `/tenant/${tenant}/orders`, "Set-Cookie": `session=${tenant}` }
        })
    );
    registerFlightDataSource("router", (_event: any, outcome: any) => ({
      [outcome.targetUrl ?? "/"]: ["x"]
    }));
    const memo = memoizingTransform();

    const cookies: Record<string, string[]> = {};
    for (const tenant of ["ALICE", "BOB", "CAROL"]) {
      const response = await callAs("sf-own-returned", tenant, memo.transform);
      cookies[tenant] = response.headers.getSetCookie();
    }

    expect(cookies.ALICE).toEqual(["session=ALICE"]);
    expect(cookies.BOB, `BOB's response carried ${JSON.stringify(cookies.BOB)}`).toEqual([
      "session=BOB"
    ]);
    expect(cookies.CAROL, `CAROL's response carried ${JSON.stringify(cookies.CAROL)}`).toEqual([
      "session=CAROL"
    ]);
  });

  it("leaves the Response the integration retains unwritten (returned outcome)", async () => {
    registerServerFunction(
      "sf-own-retained",
      async (tenant: string) =>
        new Response(null, {
          status: 303,
          headers: { Location: `/tenant/${tenant}/orders`, "Set-Cookie": `session=${tenant}` }
        })
    );
    registerFlightDataSource("router", () => ({ "/": ["x"] }));
    const memo = memoizingTransform();

    await callAs("sf-own-retained", "ALICE", memo.transform);

    const stamped = memo.retained.headers.getSetCookie();
    expect(
      stamped,
      `the fold wrote ${JSON.stringify(stamped)} onto the integration's own object`
    ).toEqual([]);
    expect(
      memo.retained.headers.get(SINGLE_FLIGHT_HEADER),
      "the fold stamped its protocol header onto the integration's own object"
    ).toBe(null);
  });

  it("does not stamp one tenant's session cookie onto the next tenant's response (thrown outcome)", async () => {
    // The thrown leg is the common single-flight shape (a mutation that
    // throws a redirect) and the one whose tail already knows to copy — its
    // copy is simply taken after the fold has written.
    registerServerFunction("sf-own-thrown", async (tenant: string) => {
      throw new Response(null, {
        status: 303,
        headers: { Location: `/tenant/${tenant}/orders`, "Set-Cookie": `session=${tenant}` }
      });
    });
    registerFlightDataSource("router", (_event: any, outcome: any) => ({
      [outcome.targetUrl ?? "/"]: ["x"]
    }));
    const memo = memoizingTransform();

    const cookies: Record<string, string[]> = {};
    for (const tenant of ["ALICE", "BOB", "CAROL"]) {
      const response = await callAs("sf-own-thrown", tenant, memo.transform);
      cookies[tenant] = response.headers.getSetCookie();
    }

    expect(cookies.ALICE).toEqual(["session=ALICE"]);
    expect(cookies.BOB, `BOB's response carried ${JSON.stringify(cookies.BOB)}`).toEqual([
      "session=BOB"
    ]);
    expect(cookies.CAROL, `CAROL's response carried ${JSON.stringify(cookies.CAROL)}`).toEqual([
      "session=CAROL"
    ]);
  });
});
