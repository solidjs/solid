import { afterEach, expect, it, vi } from "vitest";
import {
  GET,
  createServerReference,
  handleServerFunctionRequest,
  registerServerReference,
  setServerFunctionsDev
} from "@solidjs/web/server-functions/server";

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

const readRequest = (id: string) =>
  new Request(`https://app.example/_server/data/${id}`, {
    method: "GET",
    headers: { "Sec-Fetch-Site": "same-origin" }
  });

const crossSiteGet = (id: string) =>
  new Request(`https://app.example/_server/data/${id}`, {
    method: "GET",
    headers: { "Sec-Fetch-Site": "cross-site", Origin: "https://evil.example" }
  });

const read = (id: string) => handleServerFunctionRequest(readRequest(id), { provideEvent });
const readCrossSite = (id: string) =>
  handleServerFunctionRequest(crossSiteGet(id), { provideEvent });

afterEach(() => setServerFunctionsDev(false));

it("dev: a live grant follows the id across a re-registration that does not re-declare it (#3564)", async () => {
  setServerFunctionsDev(true);
  // boot: the server module registers, the data layer's query() declares
  const first = vi.fn(async () => "first evaluation");
  GET(createServerReference(registerServerReference("dev-rebind-live", first)));
  expect((await read("dev-rebind-live")).status).toBe(200);

  // program reload: the server module is evaluated again on the next
  // `/_server` request; the declaring module is not
  const second = vi.fn(async () => "second evaluation");
  registerServerReference("dev-rebind-live", second);

  const after = await read("dev-rebind-live");
  expect(after.status).toBe(200);
  expect(after.headers.get("Allow")).toBeNull();
  expect(await after.text()).toContain("second evaluation");
  expect(second).toHaveBeenCalledTimes(1);
  expect(first).toHaveBeenCalledTimes(1);
});

it("dev: a carried grant is dispatch-only — the origin gate stays on until GET() re-declares", async () => {
  setServerFunctionsDev(true);
  GET(
    createServerReference(registerServerReference("dev-rebind-undeclared", async () => "a read"))
  );
  // the declared read is exempt from the origin gate (#3114)
  expect((await readCrossSite("dev-rebind-undeclared")).status).toBe(200);

  // the reload rebinds the id to a function that never declared GET
  const mutation = vi.fn(async () => "a mutation");
  registerServerReference("dev-rebind-undeclared", mutation);

  // a cross-site GET lands on the 403 production gives it, function never run
  const refused = await readCrossSite("dev-rebind-undeclared");
  expect({ status: refused.status, calls: mutation.mock.calls.length }).toStrictEqual({
    status: 403,
    calls: 0
  });
  // while the same-origin router fetch dispatches: no 405
  const admitted = await read("dev-rebind-undeclared");
  expect(admitted.status).toBe(200);
  expect(await admitted.text()).toContain("a mutation");
  expect(mutation).toHaveBeenCalledTimes(1);
});

it("dev: the live binding re-declaring GET() turns the carried grant back into a full one", async () => {
  setServerFunctionsDev(true);
  GET(createServerReference(registerServerReference("dev-rebind-redeclare", async () => "a read")));

  // reload: the server module re-registers; the grant is carried
  const fresh = vi.fn(async () => "a read again");
  const reference = createServerReference(registerServerReference("dev-rebind-redeclare", fresh));
  expect((await readCrossSite("dev-rebind-redeclare")).status).toBe(403);

  // the next document render re-runs the data layer's query() against the
  // fresh reference: no rebind error, and the assertion is signed again
  expect(() => GET(reference)).not.toThrow();

  const crossSite = await readCrossSite("dev-rebind-redeclare");
  expect(crossSite.status).toBe(200);
  expect(await crossSite.text()).toContain("a read again");
  const sameOrigin = await read("dev-rebind-redeclare");
  expect(sameOrigin.status).toBe(200);
  expect(fresh).toHaveBeenCalledTimes(2);
});

it("dev: a stale GET() against a carried grant is discarded — no throw, grant stays provisional", async () => {
  setServerFunctionsDev(true);
  const stale = createServerReference(
    registerServerReference("dev-rebind-stale-redeclare", async () => "a read")
  );
  GET(stale);

  // reload: the server module re-registers; the grant is carried
  const second = vi.fn(async () => "second evaluation");
  registerServerReference("dev-rebind-stale-redeclare", second);

  // the declaring module re-runs, still holding the reference from before
  // the reload: a reload, not two live references colliding
  expect(() => GET(stale)).not.toThrow();

  // the stale declaration granted nothing: the grant is still provisional
  const sameOrigin = await read("dev-rebind-stale-redeclare");
  expect(sameOrigin.status).toBe(200);
  expect(await sameOrigin.text()).toContain("second evaluation");
  const crossSite = await readCrossSite("dev-rebind-stale-redeclare");
  expect(crossSite.status).toBe(403);
  expect(second).toHaveBeenCalledTimes(1);
});

it("dev: a carried grant stays provisional across further re-registrations", async () => {
  setServerFunctionsDev(true);
  GET(createServerReference(registerServerReference("dev-rebind-chain", async () => "a read")));

  registerServerReference("dev-rebind-chain", async () => "second evaluation");
  const third = vi.fn(async () => "third evaluation");
  registerServerReference("dev-rebind-chain", third);

  const sameOrigin = await read("dev-rebind-chain");
  expect(sameOrigin.status).toBe(200);
  expect(await sameOrigin.text()).toContain("third evaluation");
  const crossSite = await readCrossSite("dev-rebind-chain");
  expect(crossSite.status).toBe(403);
  expect(third).toHaveBeenCalledTimes(1);
});

it("dev: a stale grant does not come alive on a re-registration", async () => {
  setServerFunctionsDev(true);
  const declared = createServerReference(
    registerServerReference("dev-rebind-stale", async () => "a read")
  );
  registerServerReference("dev-rebind-stale", async () => "a mutation");
  GET(declared);
  const next = vi.fn(async () => "another mutation");
  registerServerReference("dev-rebind-stale", next);

  const response = await read("dev-rebind-stale");
  expect({ status: response.status, allow: response.headers.get("Allow") }).toStrictEqual({
    status: 405,
    allow: "POST"
  });
  expect(next).not.toHaveBeenCalled();
});

it("prod: a re-registration still revokes the grant (#3129)", async () => {
  GET(createServerReference(registerServerReference("prod-rebind", async () => "a read")));
  const next = vi.fn(async () => "a mutation");
  registerServerReference("prod-rebind", next);

  const response = await read("prod-rebind");
  expect({ status: response.status, allow: response.headers.get("Allow") }).toStrictEqual({
    status: 405,
    allow: "POST"
  });
  expect(next).not.toHaveBeenCalled();
});
