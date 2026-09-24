/**
 * OPTIMISTIC_REVERTED — the person saw the guess, then the correction.
 *
 * Claim under test: when an optimistic override the screen displayed is
 * replaced by a different value — the source answered with something else
 * (`superseded`), or the override lifted at settle back to a differing
 * committed value (`dropped`) — the engine emits one `info` finding naming
 * the source, both values, and the interaction that wrote the guess. A guess
 * the truth confirms, by identity or by the node's own equality, is silent.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution } from "../src/attribution.js";
import {
  action,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  isPending,
  latest,
  OBSERVE
} from "../src/index.js";
import type { DiagnosticEvent } from "../src/core/dev.js";

afterEach(() => {
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

function deferred<T = void>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>(r => (resolve = r));
  return { promise, resolve };
}

function arm(opts: { optimisticReverts?: boolean } = {}) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  attribution.enable({ log: false, hotRuns: false, hotTime: false, waterfalls: false, ...opts });
  const findings: DiagnosticEvent[] = [];
  OBSERVE!.diagnostics.subscribe(e => {
    if (e.code === "OPTIMISTIC_REVERTED") findings.push(e);
  });
  return { findings };
}

describe("OPTIMISTIC_REVERTED", () => {
  it("reverted: the action ends without the guess coming true, and the value snaps back", async () => {
    const { findings } = arm();
    const gate = deferred();
    const [status, setStatus] = createOptimistic("idle", { name: "status" });
    createRoot(() => createRenderEffect(status, () => {}, { name: "badge" }));
    flush();
    const save = action(function* save() {
      setStatus("saved");
      yield gate.promise;
      // The server said no; nothing writes the truth. The override lifts.
    });
    const p = save();
    flush();
    expect(status()).toBe("saved");
    expect(findings).toHaveLength(0);
    gate.resolve();
    await p;
    flush();
    expect(status()).toBe("idle");
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      code: "OPTIMISTIC_REVERTED",
      kind: "responsiveness",
      severity: "info",
      nodeName: "status",
      data: { source: "status", shown: '"saved"', truth: '"idle"', how: "reverted" }
    });
    expect(findings[0].message).toContain('showed "saved"; it reverted to "idle"');
  });

  it("superseded: the source answers with a different value while the guess is showing", async () => {
    const { findings } = arm();
    const gate = deferred();
    const [count, setCount] = createSignal(0, { name: "count" });
    const [shown, setShown] = createOptimistic(() => count(), { name: "shownCount" });
    createRoot(() => createRenderEffect(shown, () => {}, { name: "counter" }));
    flush();
    const increment = action(function* increment() {
      setShown(1);
      yield gate.promise;
      setCount(2); // the server counted someone else's click too
    });
    const p = increment();
    flush();
    expect(shown()).toBe(1);
    gate.resolve();
    await p;
    flush();
    expect(shown()).toBe(2);
    expect(findings).toHaveLength(1);
    expect(findings[0].data).toMatchObject({
      source: "shownCount",
      shown: "1",
      truth: "2",
      how: "superseded"
    });
    expect(findings[0].message).toContain("settled to 2");
  });

  it("a guess the truth confirms is silent", async () => {
    const { findings } = arm();
    const gate = deferred();
    const [count, setCount] = createSignal(0, { name: "count" });
    const [shown, setShown] = createOptimistic(() => count(), { name: "shownCount" });
    createRoot(() => createRenderEffect(shown, () => {}, { name: "counter" }));
    flush();
    const increment = action(function* increment() {
      setShown(1);
      yield gate.promise;
      setCount(1);
    });
    const p = increment();
    flush();
    gate.resolve();
    await p;
    flush();
    expect(shown()).toBe(1);
    expect(findings).toHaveLength(0);
  });

  it("the node's own equality decides: a structurally equal correction is not a revert", async () => {
    const { findings } = arm();
    const gate = deferred();
    const [user, setUser] = createSignal({ name: "Ada" }, { name: "user" });
    const [shownUser, setShownUser] = createOptimistic(() => user(), {
      name: "shownUser",
      equals: (a, b) => a.name === b.name
    });
    createRoot(() => createRenderEffect(shownUser, () => {}, { name: "profile" }));
    flush();
    const rename = action(function* rename() {
      setShownUser({ name: "Grace" });
      yield gate.promise;
      setUser({ name: "Grace" }); // a fresh object, the same name
    });
    const p = rename();
    flush();
    gate.resolve();
    await p;
    flush();
    expect(shownUser().name).toBe("Grace");
    expect(findings).toHaveLength(0);
  });

  it("an acknowledged hold — isPending and latest doing their job — is not a revert", async () => {
    // The regression: isPending()'s companion is an optimistic signal that
    // goes true while pending and back to false at commit, by design. It is
    // the acknowledgement SILENT_HOLD asks for, not a guess the person saw.
    const { findings } = arm();
    const [page, setPage] = createSignal(1, { name: "page" });
    let resolve!: (v: string) => void;
    const posts = createMemo(
      () => {
        const p = page();
        return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
      },
      { name: "posts" }
    );
    const shown: string[] = [];
    createRoot(() => {
      createRenderEffect(posts, v => void shown.push(String(v)), { name: "feed" });
      createRenderEffect(
        () => isPending(() => posts()),
        () => {},
        { name: "spinner" }
      );
      createRenderEffect(
        () => latest(page),
        () => {},
        { name: "pageLabel" }
      );
    });
    flush();
    resolve("a");
    await new Promise(r => setTimeout(r, 10));
    flush();
    expect(shown).toContain("a-p1");
    // A held write: the companions flip on, then off at commit.
    setPage(2);
    flush();
    await new Promise(r => setTimeout(r, 10));
    resolve("b");
    await new Promise(r => setTimeout(r, 10));
    flush();
    expect(shown).toContain("b-p2");
    expect(findings).toHaveLength(0);
  });

  it("`optimisticReverts: false` disables the finding", async () => {
    const { findings } = arm({ optimisticReverts: false });
    const gate = deferred();
    const [status, setStatus] = createOptimistic("idle", { name: "status" });
    createRoot(() => createRenderEffect(status, () => {}, { name: "badge" }));
    flush();
    const save = action(function* save() {
      setStatus("saved");
      yield gate.promise;
    });
    const p = save();
    flush();
    gate.resolve();
    await p;
    flush();
    expect(status()).toBe("idle");
    expect(findings).toHaveLength(0);
  });

  it("with no engine, the sites are inert", async () => {
    const gate = deferred();
    const [status, setStatus] = createOptimistic("idle", { name: "status" });
    createRoot(() => createRenderEffect(status, () => {}, { name: "badge" }));
    flush();
    const save = action(function* save() {
      setStatus("saved");
      yield gate.promise;
    });
    const p = save();
    flush();
    gate.resolve();
    await p;
    flush();
    expect(status()).toBe("idle");
    expect(attribution.history("rerun")).toEqual([]);
  });
});
