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

const read = (id: string) => handleServerFunctionRequest(readRequest(id), { provideEvent });

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
