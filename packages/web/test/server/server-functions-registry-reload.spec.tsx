/**
 * The dispatch registry survives a re-evaluation of the runtime (#3346).
 *
 * Under `vite dev` the server-function runtime is inlined into the SSR
 * module runner, and any edit to a module without a hot boundary makes the
 * runner "program reload": every module — the runtime included — is
 * evaluated again into a fresh instance. The RPC seam integrations reach
 * `GET` through (`getServerFunctionRPC`, a globalThis slot, first write
 * wins) keeps handing out the FIRST instance's `GET`, so a router's
 * `query()` re-declared its reads into the dead instance while dispatch —
 * imported through the runner — consulted the live one: after the first
 * edit every declared read answered 405 (`Allow: POST`).
 *
 * The registry is therefore process state, keyed on registered symbols like
 * the seam itself: a grant made through any copy's `GET` is the grant every
 * copy's dispatch sees, and the rebind revocation (#3129) fires in the same
 * maps the re-declaration re-grants.
 *
 * Runs against the built bundle like the other server-function specs; the
 * second instance is that bundle evaluated again after `vi.resetModules`.
 */
import { expect, it, vi } from "vitest";
import { getServerFunctionRPC } from "@solidjs/web";
import * as booted from "@solidjs/web/server-functions/server";

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

const readRequest = (id: string) =>
  new Request(`https://app.example/_server/${id}`, {
    method: "GET",
    headers: { "Sec-Fetch-Site": "same-origin" }
  });

// What a router's query() does at module scope: register the compiled
// function, then declare the read through the seam — never through a
// direct import of the runtime.
function declareThroughSeam(runtime: typeof booted, id: string, fn: (...args: any[]) => any) {
  const reference = runtime.createServerReference(runtime.registerServerReference(id, fn));
  return getServerFunctionRPC()!.GET(reference);
}

it("a re-evaluated runtime shares the registry the seam's GET writes to (#3346)", async () => {
  // boot: the first instance registers the read and fills the seam
  const first = vi.fn(async () => "first evaluation");
  declareThroughSeam(booted, "reload-read", first);
  expect(getServerFunctionRPC()!.GET).toBe(booted.GET);
  const before = await booted.handleServerFunctionRequest(readRequest("reload-read"), {
    provideEvent
  });
  expect(before.status).toBe(200);
  expect(await before.text()).toContain("first evaluation");

  // program reload: the runtime is evaluated again, the seam is not
  vi.resetModules();
  const reloaded: typeof booted = await import("@solidjs/web/server-functions/server");
  expect(reloaded.handleServerFunctionRequest).not.toBe(booted.handleServerFunctionRequest);
  expect(getServerFunctionRPC()!.GET).toBe(booted.GET);

  // the re-evaluated module registers its fresh closure and re-declares it
  // through the seam, which still hands out the first instance's GET
  const second = vi.fn(async () => "second evaluation");
  declareThroughSeam(reloaded, "reload-read", second);

  // dispatch through the live instance finds the grant and runs the live
  // function
  const after = await reloaded.handleServerFunctionRequest(readRequest("reload-read"), {
    provideEvent
  });
  expect(after.status).toBe(200);
  expect(after.headers.get("Allow")).toBeNull();
  expect(await after.text()).toContain("second evaluation");
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(1);
});
