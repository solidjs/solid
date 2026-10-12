/**
 * @vitest-environment jsdom
 *
 * #3959: a synchronous `prepareRequest` hook must send inside hydration's
 * synchronous trace, where the mocked fetch absorbs the adopted read. Before
 * the fix the hook was always awaited, so the read reached the network.
 */
import { afterEach, expect, test, vi } from "vitest";
import { createMemo, createRoot, enableHydration, flush, sharedConfig } from "solid-js";
import {
  configureServerFunctionsClient,
  createServerReference
} from "../../server-functions/src/client.js";

enableHydration();

const { has, load, gather } = sharedConfig as any;

afterEach(() => {
  sharedConfig.hydrating = false;
  Object.assign(sharedConfig, { has, load, gather });
  configureServerFunctionsClient({ prepareRequest: null as any });
  vi.unstubAllGlobals();
});

test.each([
  ["no prepareRequest", undefined],
  ["a synchronous prepareRequest", (init: RequestInit) => init]
])("an adopted server-function read does not refetch with %s", async (_, hook) => {
  const data: Record<string, unknown> = { t0: "server" };
  sharedConfig.hydrating = true;
  (sharedConfig as any).has = (id: string) => id in data;
  (sharedConfig as any).load = (id: string) => data[id];
  (sharedConfig as any).gather = () => {};
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    urls.push(String(input));
    return new Response("null");
  });
  if (hook) configureServerFunctionsClient({ prepareRequest: hook });

  const read = createServerReference("prepare-request-3959");
  let value!: () => unknown;
  createRoot(
    () => {
      value = createMemo(() => read());
    },
    { id: "t" }
  );
  flush();
  sharedConfig.hydrating = false;
  await new Promise(resolve => setTimeout(resolve, 20));

  expect(value()).toBe("server");
  expect(urls).toEqual([]);
});
