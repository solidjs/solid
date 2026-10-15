/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
// A re-ask is one request (see frames-errored-reset-refetch.spec.tsx for
// the contract): `reset`, or a fresh consumer of an errored address, opens
// ONE new flight, and that flight's error surfaces like any other — it is
// not the error the node already surfaced, whatever its payload.
//
// The server writes an escaped render failure as an unkeyed error whose
// payload is the sanitized MESSAGE (`sink.error("", message)`), a string.
// Two flights that fail the same way carry equal strings; telling "the
// error already surfaced" from "the next flight's error" by the payload
// read every re-asked flight's error as the old one and re-asked again, a
// request per flight with no end.
import { afterEach, describe, expect, test, vi } from "vitest";
import { createRoot, Errored, Loading, resetErrorHalt, type Component } from "solid-js";
import { dynamic, dynamicComponent } from "../src/index.js";
import { installServerComponents } from "../frames/src/client.js";
import { createServerReference, GET } from "../server-functions/src/client.js";
import { makeHost, frameResponse, pump } from "./lifecycle-matrix/harness.js";

/** The server's shape for a component that threw: start, the message, complete. */
const errored = (id: string, message: string) =>
  frameResponse(id, [
    { type: "start", id, version: 1 },
    { type: "error", id, version: 1, error: message },
    { type: "complete", id, version: 1 }
  ]);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  resetErrorHalt();
});

function mount(code: () => any) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  let div!: HTMLDivElement;
  const dispose = createRoot(d => {
    <div ref={div}>{code()}</div>;
    container.appendChild(div);
    return d;
  });
  return {
    div,
    cleanup() {
      dispose();
      container.remove();
    }
  };
}

/**
 * Every request fails the same way. Past `cap` the stub never answers, so
 * a runaway re-ask stops at a count the assertions can read.
 */
function failingServer(message: string, cap = 25) {
  const counter = { calls: 0 };
  vi.stubGlobal("fetch", async () => {
    counter.calls++;
    if (counter.calls > cap) return new Promise<Response>(() => {});
    return errored("srv", message);
  });
  return counter;
}

const VIA: ReadonlyArray<[string, (source: () => any) => Component<any>]> = [
  ["dynamic", dynamic],
  ["dynamicComponent", dynamicComponent]
];

describe.each(VIA)("a re-ask is one request — via %s", (_via, dyn) => {
  test("reset() re-asks once, and the re-asked flight's equal error surfaces again", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const server = failingServer("boom");
    const getUser = createServerReference("reask-loop/reset");
    const Page = dyn(() => getUser() as any);
    let reset: (() => void) | undefined;
    const m = mount(() => (
      <Errored
        fallback={(err, r) => {
          reset = r;
          return <span class="err">failed: {String(err())}</span>;
        }}
      >
        <Loading fallback={<span class="shell">loading</span>}>
          <Page />
        </Loading>
      </Errored>
    ));
    await pump();
    expect(server.calls).toBe(1);
    expect(m.div.querySelector(".err")!.textContent).toBe("failed: boom");

    for (const asked of [2, 3]) {
      reset!();
      await pump(20);
      expect(server.calls).toBe(asked);
      // Surfaced: the boundary is back on its fallback, not pending on the
      // re-asked flight behind the <Loading>.
      expect(m.div.querySelector(".err")!.textContent).toBe("failed: boom");
      expect(m.div.querySelector(".shell")).toBeNull();
      await pump(20);
      expect(server.calls).toBe(asked);
    }
    m.cleanup();
  });

  test("a mount over an errored preload surfaces the next flight's equal error, then stops asking", async () => {
    const { host } = makeHost();
    installServerComponents(host);
    const server = failingServer("boom");
    const getUser = GET(createServerReference("reask-loop/preload"));
    // The router's hover preload: the call made ahead of the mount.
    void Promise.resolve(getUser()).catch(() => {});
    await pump();
    expect(server.calls).toBe(1);

    const Page = dyn(() => getUser() as any);
    const m = mount(() => (
      <Errored fallback={err => <span class="err">failed: {String(err())}</span>}>
        <Loading fallback={<span class="shell">loading</span>}>
          <Page />
        </Loading>
      </Errored>
    ));
    await pump(20);
    expect(m.div.querySelector(".err")!.textContent).toBe("failed: boom");
    const surfaced = server.calls;
    // The mount's call and at most one re-ask behind it.
    expect(surfaced).toBeLessThanOrEqual(3);
    await pump(40);
    expect(server.calls).toBe(surfaced);
    m.cleanup();
  });
});

test("with no <Errored>, a mount over an errored preload halts on the next flight's equal error instead of re-asking", async () => {
  // The halt's rethrow out of scheduled flushes (see the reset spec's (d)).
  const queue = queueMicrotask;
  vi.stubGlobal("queueMicrotask", (fn: () => void) =>
    queue(() => {
      try {
        fn();
      } catch {}
    })
  );
  vi.stubGlobal("reportError", () => {});
  const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  const { host } = makeHost();
  installServerComponents(host);
  const server = failingServer("boom");
  const getUser = GET(createServerReference("reask-loop/uncaught"));
  void Promise.resolve(getUser()).catch(() => {});
  await pump();

  const Page = dynamicComponent(() => getUser() as any);
  const m = mount(() => (
    <Loading fallback={<span class="shell">loading</span>}>
      <Page />
    </Loading>
  ));
  await pump(20);
  const surfaced = server.calls;
  expect(surfaced).toBeLessThanOrEqual(3);
  expect(consoleError.mock.calls.some(args => /REACTIVITY_HALTED/.test(String(args[0])))).toBe(
    true
  );
  await pump(40);
  expect(server.calls).toBe(surfaced);
  m.cleanup();
});
