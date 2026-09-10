/**
 * Responsiveness evidence in the artifact, and the gates over it.
 *
 * Claim under test: a capture carries every transition hold the scenario
 * caused (`attribution.holds`) and the feedback tables folded from them
 * (`attribution.feedback`); `expectNoSilentHolds` fails on a hold the screen
 * never acknowledged and passes once an affordance answers it; `expectHoldBudget`
 * bounds hold latency regardless of acknowledgment; budgets and matchers wrap
 * both; JSONL egress and the browser bridge carry the same records.
 */
import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  OBSERVE,
  flush,
  isPending
} from "@solidjs/signals";
import {
  artifactToJSONL,
  assertBudget,
  captureArtifact,
  DiagnosticsAssertionError,
  expectHoldBudget,
  expectNoSilentHolds
} from "../src/index.js";
import { installDiagnosticsBridge } from "../src/browser.js";
import "../src/vitest.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    flush();
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await wait(5);
  }
}

// Silent-hold thresholds pushed out of the way: these tests are about the
// budget's verdict, not the console's.
const attribution = { hotTime: false, holds: { infoMs: 60_000, warnMs: 60_000 } } as const;

/**
 * A paged feed: `page` drives an async `posts` memo a render effect shows.
 * With `busy` mounted, an isPending reader acknowledges every hold.
 */
function pagedFeed(withBusyIndicator: boolean) {
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
  const dispose = createRoot(dispose => {
    createRenderEffect(
      posts,
      v => {
        shown.push(v);
      },
      { name: "feed" }
    );
    if (withBusyIndicator)
      createRenderEffect(
        () => isPending(() => posts()),
        () => {},
        { name: "busy" }
      );
    return dispose;
  });
  flush();
  return {
    setPage,
    dispose,
    async load(v: string) {
      resolve(v);
      await until(() => shown.some(s => s.startsWith(v)), `posts to show ${v}`);
    }
  };
}

/** Click through one page under capture; returns the artifact. */
async function capturePageTurn(withBusyIndicator: boolean, holdFor = 20) {
  const feed = pagedFeed(withBusyIndicator);
  await feed.load("a");
  const { artifact } = await captureArtifact(
    async () => {
      OBSERVE!.attribution.withInteraction({ type: "click", target: 'button#next "Next →"' }, () =>
        feed.setPage(2)
      );
      flush();
      await wait(holdFor);
      await feed.load("b");
    },
    { scenario: "next-page", attribution }
  );
  feed.dispose();
  return artifact;
}

describe("artifact — responsiveness evidence", () => {
  it("carries the holds and the feedback tables", async () => {
    const artifact = await capturePageTurn(false);
    expect(artifact.formatVersion).toBe(4);
    const { holds, feedback } = artifact.attribution!;
    expect(holds).toHaveLength(1);
    expect(holds[0]).toMatchObject({
      heldWrites: [{ name: "page", prev: "1", value: "2" }],
      blockers: ["posts"],
      acknowledgements: [],
      paintedDuringHold: 0,
      action: false,
      interaction: { kind: "interaction", name: "click", target: 'button#next "Next →"' }
    });
    expect(holds[0].holdMs).toBeGreaterThanOrEqual(20);
    expect(feedback.sources).toHaveLength(1);
    expect(feedback.sources[0]).toMatchObject({ sources: ["posts"], holds: 1, silent: 1 });
    expect(feedback.interactions[0]).toMatchObject({
      interaction: 'click on button#next "Next →"',
      dispatches: 1,
      holds: 1
    });
    // Serializable end to end.
    expect(JSON.parse(JSON.stringify(artifact.attribution))).toEqual(artifact.attribution);
  });

  it("egresses holds and feedback as JSONL records", async () => {
    const artifact = await capturePageTurn(false);
    const lines = artifactToJSONL(artifact)
      .trim()
      .split("\n")
      .map(l => JSON.parse(l));
    expect(lines[0]).toMatchObject({ type: "meta", holdCount: 1 });
    const hold = lines.find(l => l.type === "hold");
    expect(hold).toMatchObject({ blockers: ["posts"] });
    const feedback = lines.find(l => l.type === "feedback");
    expect(feedback.sources[0].sources).toEqual(["posts"]);
  });
});

describe("expectNoSilentHolds", () => {
  it("fails on a hold the screen never acknowledged, with the hold as evidence", async () => {
    const artifact = await capturePageTurn(false);
    let error: DiagnosticsAssertionError | undefined;
    try {
      expectNoSilentHolds(artifact);
    } catch (e) {
      error = e as DiagnosticsAssertionError;
    }
    expect(error).toBeInstanceOf(DiagnosticsAssertionError);
    expect(error!.message).toContain("1 (worst");
    expect(error!.message).toContain("isPending()");
    expect(error!.evidence[0]).toMatchObject({
      interaction: 'click on button#next "Next →"',
      heldWrites: ["page"],
      blockers: ["posts"],
      acknowledgements: []
    });
  });

  it("passes once an affordance answers the hold", async () => {
    const artifact = await capturePageTurn(true);
    expect(artifact.attribution!.holds[0].acknowledgements).toMatchObject([
      { kind: "isPending", source: "posts" }
    ]);
    expectNoSilentHolds(artifact);
    expect(artifact.attribution!.feedback.sources[0]).toMatchObject({
      silent: 0,
      acknowledgedBy: [{ by: "isPending:posts", holds: 1 }]
    });
  });

  it("tolerates silent holds under maxSilentMs", async () => {
    const artifact = await capturePageTurn(false, 5);
    expect(() => expectNoSilentHolds(artifact)).toThrow(DiagnosticsAssertionError);
    expectNoSilentHolds(artifact, { maxSilentMs: 4_000 });
  });

  it("requires attribution", async () => {
    const { artifact } = await captureArtifact(() => {}, { attribution: false });
    expect(() => expectNoSilentHolds(artifact)).toThrow(/requires attribution data/);
  });
});

describe("expectHoldBudget", () => {
  it("bounds hold latency whether or not the hold was acknowledged", async () => {
    const artifact = await capturePageTurn(true, 30);
    expectNoSilentHolds(artifact);
    expect(() => expectHoldBudget(artifact, 10)).toThrow(/settle within 10ms but 1 did not/);
    expectHoldBudget(artifact, 4_000);
    // Filtered by source.
    expect(() => expectHoldBudget(artifact, 10, { source: "posts" })).toThrow(
      DiagnosticsAssertionError
    );
    expectHoldBudget(artifact, 10, { source: /comments/ });
  });
});

describe("budgets and matchers", () => {
  it("enforces maxSilentHoldMs and maxHoldMs from a scenario budget", async () => {
    const silent = await capturePageTurn(false);
    expect(() => assertBudget(silent, { maxSilentHoldMs: 0 })).toThrow(DiagnosticsAssertionError);
    assertBudget(silent, { maxSilentHoldMs: 4_000 });
    assertBudget(silent, {}); // unstated bounds are not enforced

    const acknowledged = await capturePageTurn(true);
    assertBudget(acknowledged, { maxSilentHoldMs: 0 });
    expect(() => assertBudget(acknowledged, { maxSilentHoldMs: 0, maxHoldMs: 5 })).toThrow(
      /settle within 5ms/
    );
  });

  it("registers vitest matchers with negated forms", async () => {
    const silent = await capturePageTurn(false);
    expect(silent).not.toHaveNoSilentHolds();
    expect(silent).toHaveNoSilentHolds({ maxSilentMs: 4_000 });
    expect(silent).toStayWithinHoldBudget(4_000);
    expect(silent).not.toStayWithinHoldBudget(5);
    expect(silent).not.toStayWithinBudget({ maxSilentHoldMs: 0 });

    const acknowledged = await capturePageTurn(true);
    expect(acknowledged).toHaveNoSilentHolds();
    expect(acknowledged).toStayWithinBudget({ maxSilentHoldMs: 0, maxHoldMs: 4_000 });
  });
});

describe("browser bridge", () => {
  it("answers holds() and feedback() against the open session and carries them in end()", async () => {
    const realm: Record<string, unknown> = {};
    const bridge = installDiagnosticsBridge(realm);
    expect(() => bridge.holds()).toThrow(/requires an open session/);

    const feed = pagedFeed(false);
    await feed.load("a");
    bridge.begin({ attribution });
    feed.setPage(2);
    flush();
    await feed.load("b");

    const holds = bridge.holds();
    expect(holds).toHaveLength(1);
    expect(holds[0].blockers).toEqual(["posts"]);
    expect(bridge.feedback().sources[0]).toMatchObject({ sources: ["posts"], silent: 1 });

    const payload = bridge.end();
    expect(payload.attribution!.holds).toHaveLength(1);
    expect(payload.attribution!.feedback.sources).toHaveLength(1);
    feed.dispose();
  });
});
