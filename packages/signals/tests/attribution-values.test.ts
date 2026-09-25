/**
 * `AttributionOptions.values` — what user data the engine's records carry.
 *
 * Claim under test: the level is applied AT THE SOURCE, when the record is
 * built, so nothing downstream (a formatter, an adapter, an exporter) has
 * to scrub. `"full"` (the default) keeps value previews on `ChangeRecord`/
 * `HeldWrite` and the element text on `ChangeOrigin.target`; `"labels"`
 * drops the previews and keeps the text only on a `button` or an `a`;
 * `"none"` drops both. Findings the engine phrases from those fields say
 * as much as the level allows and no more. Across holds the LEAST
 * permissive level wins, and a release restores the others'.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { attribution, formatOrigin, formatRerun } from "../src/attribution.js";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  flush,
  OBSERVE
} from "../src/index.js";
import type {
  AttributionOptions,
  AttributionValues,
  HoldEvent,
  InteractionEvent,
  RerunEvent
} from "../src/core/attribution.js";
import type { DiagnosticEvent } from "../src/core/dev.js";
import type { RecordListener, RecordType } from "../src/core/dev.js";

const offs: (() => void)[] = [];
function on<K extends RecordType>(type: K, listener: RecordListener<K>): void {
  offs.push(OBSERVE!.records.subscribe(type, listener));
}

afterEach(() => {
  for (const off of offs.splice(0)) off();
  attribution.disable();
  flush();
  vi.restoreAllMocks();
});

const QUIET: AttributionOptions = { log: false, hotRuns: false, hotTime: false, waterfalls: false };

function arm(opts: AttributionOptions = {}) {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  const release = attribution.enable({ ...QUIET, ...opts });
  const reruns: RerunEvent[] = [];
  const interactions: InteractionEvent[] = [];
  const holds: HoldEvent[] = [];
  const findings: DiagnosticEvent[] = [];
  on("rerun", e => reruns.push(e));
  on("interaction", e => interactions.push(e));
  on("hold", e => holds.push(e));
  OBSERVE!.diagnostics.subscribe(e => findings.push(e));
  return { release, reruns, interactions, holds, findings };
}

const wait = (ms: number) => new Promise<void>(r => setTimeout(r, ms));
async function until(cond: () => boolean, what: string, timeout = 5000) {
  const start = Date.now();
  for (;;) {
    flush();
    if (cond()) return;
    if (Date.now() - start > timeout) throw new Error(`timed out waiting for ${what}`);
    await wait(5);
  }
}

const CARD = { type: "click", target: 'div#card "Personal note about a person"' };
const SAVE = { type: "click", target: 'button#save "Save"' };
const LINK = { type: "click", target: 'a[name=next] "Next page"' };
const FIELD = { type: "input", target: "input#email" };

/** A signal with an effect reading it: one re-run per write, one cause each. */
function counter() {
  const [n, setN] = createSignal(0, { name: "n" });
  createRoot(() => createEffect(n, () => {}, { name: "reader" }));
  flush();
  return { n, setN };
}

/** Three interactions, one write each. */
function click(setN: (v: number) => void) {
  OBSERVE!.attribution.withInteraction(CARD, () => setN(1));
  flush();
  OBSERVE!.attribution.withInteraction(SAVE, () => setN(2));
  flush();
  OBSERVE!.attribution.withInteraction(LINK, () => setN(3));
  flush();
  OBSERVE!.attribution.withInteraction(FIELD, () => setN(4));
  flush();
}

describe("AttributionOptions.values", () => {
  describe('"full" (the dev default)', () => {
    // The suite runs the source under `__DEV__: true`; the observe build's
    // default (`"none"`) is pinned against the artifact in dist-artifacts.test.ts.
    it("is the dev default: previews and element text, as dev output has always read", () => {
      const { reruns, interactions } = arm();
      const { setN } = counter();
      click(setN);

      expect(reruns.map(r => r.causes[0])).toMatchObject([
        { name: "n", prev: "0", value: "1" },
        { name: "n", prev: "1", value: "2" },
        { name: "n", prev: "2", value: "3" },
        { name: "n", prev: "3", value: "4" }
      ]);
      expect(interactions.map(i => i.target)).toEqual([
        CARD.target,
        SAVE.target,
        LINK.target,
        FIELD.target
      ]);
      expect(reruns.map(r => r.causes[0].origin!.target)).toEqual(interactions.map(i => i.target));
      expect(formatOrigin(interactions[0].origin)).toBe(
        'click on div#card "Personal note about a person"'
      );
      expect(formatRerun(reruns[0])).toContain("0 → 1");
    });
  });

  describe('"labels"', () => {
    it("drops value previews from every change record", () => {
      const { reruns } = arm({ values: "labels" });
      const { setN } = counter();
      click(setN);
      for (const run of reruns) {
        const cause = run.causes[0];
        expect(cause.name).toBe("n");
        expect(cause.prev).toBeUndefined();
        expect(cause.value).toBeUndefined();
      }
      expect(formatRerun(reruns[0])).not.toContain("→");
      expect(formatRerun(reruns[0])).toContain('signal "n" write');
    });

    it("keeps element text on a button or a link only", () => {
      const { interactions, reruns } = arm({ values: "labels" });
      const { setN } = counter();
      click(setN);
      expect(interactions.map(i => i.target)).toEqual([
        "div#card",
        'button#save "Save"',
        'a[name=next] "Next page"',
        "input#email"
      ]);
      // The same origin object rides every record the interaction caused.
      expect(reruns.map(r => r.causes[0].origin!.target)).toEqual(interactions.map(i => i.target));
      expect(formatOrigin(interactions[0].origin)).toBe("click on div#card");
      expect(formatOrigin(interactions[1].origin)).toBe('click on button#save "Save"');
    });
  });

  describe('"none"', () => {
    it("drops previews and every element's text, buttons and links included", () => {
      const { reruns, interactions } = arm({ values: "none" });
      const { setN } = counter();
      click(setN);
      for (const run of reruns) {
        expect(run.causes[0].prev).toBeUndefined();
        expect(run.causes[0].value).toBeUndefined();
      }
      expect(interactions.map(i => i.target)).toEqual([
        "div#card",
        "button#save",
        "a[name=next]",
        "input#email"
      ]);
      expect(JSON.stringify([reruns, interactions])).not.toMatch(/Personal note|Save|Next page/);
    });

    it("never mutates the runtime's InteractionRef", () => {
      arm({ values: "none" });
      const { setN } = counter();
      const ref = { ...CARD };
      OBSERVE!.attribution.withInteraction(ref, () => setN(1));
      flush();
      expect(ref).toEqual(CARD);
    });
  });

  describe("held writes and the sentences built from them", () => {
    /** A write held behind an async memo, SILENT (no acknowledgement): one HoldEvent + one SILENT_HOLD. */
    async function silentHold(target: string) {
      const [page, setPage] = createSignal(1, { name: "page" });
      let resolve: ((v: string) => void) | null = null;
      const posts = createMemo(
        () => {
          const p = page();
          return new Promise<string>(r => (resolve = v => r(`${v}-p${p}`)));
        },
        { name: "posts" }
      );
      const shown: string[] = [];
      createRoot(() =>
        createRenderEffect(
          posts,
          v => {
            shown.push(String(v));
          },
          { name: "feed" }
        )
      );
      flush();
      resolve!("a");
      await until(() => shown.includes("a-p1"), "initial load");
      OBSERVE!.attribution.withInteraction({ type: "click", target }, () => setPage(2));
      flush();
      await wait(5);
      resolve!("b");
      await until(() => shown.includes("b-p2"), "the held page to land");
    }

    it('"full": HeldWrite carries the previews; SILENT_HOLD quotes them and the element text', async () => {
      const { holds, findings } = arm({ holds: { infoMs: 0, warnMs: 0 } });
      await silentHold('div#card "Personal note"');
      expect(holds).toHaveLength(1);
      expect(holds[0].heldWrites).toEqual([
        expect.objectContaining({ name: "page", prev: "1", value: "2" })
      ]);
      const silent = findings.find(f => f.code === "SILENT_HOLD")!;
      expect(silent.message).toContain(
        'click on div#card "Personal note" wrote "page" (1 → 2); the write was held'
      );
      expect(silent.data).toMatchObject({
        interaction: { type: "click", target: 'div#card "Personal note"' }
      });
    });

    it('"none": HeldWrite has no previews; SILENT_HOLD names the write and the element, nothing more', async () => {
      const { holds, findings } = arm({ values: "none", holds: { infoMs: 0, warnMs: 0 } });
      await silentHold('div#card "Personal note"');
      expect(holds).toHaveLength(1);
      expect(holds[0].heldWrites).toHaveLength(1);
      expect(holds[0].heldWrites[0].name).toBe("page");
      expect(holds[0].heldWrites[0].prev).toBeUndefined();
      expect(holds[0].heldWrites[0].value).toBeUndefined();
      expect(holds[0].interaction!.target).toBe("div#card");
      expect(holds[0].heldWrites[0].origin!.target).toBe("div#card");
      const silent = findings.find(f => f.code === "SILENT_HOLD")!;
      expect(silent.message).toContain('click on div#card wrote "page"; the write was held');
      expect(silent.data).toMatchObject({ interaction: { type: "click", target: "div#card" } });
      // Nothing on the finding — sentence or data — carries what the level excluded.
      expect(JSON.stringify(silent)).not.toMatch(/Personal note|1 → 2/);
    });

    it('OPTIMISTIC_REVERTED quotes the two values under "full" only', async () => {
      const revert = async (values: AttributionValues) => {
        const { findings, release } = arm({ values });
        let resolve!: () => void;
        const gate = new Promise<void>(r => (resolve = r));
        const [status, setStatus] = createOptimistic("idle", { name: "status" });
        createRoot(() => createRenderEffect(status, () => {}, { name: "badge" }));
        flush();
        const save = action(function* save() {
          setStatus("saved");
          yield gate;
        });
        const p = save();
        flush();
        resolve();
        await p;
        flush();
        release();
        return findings.find(f => f.code === "OPTIMISTIC_REVERTED")!;
      };

      const full = await revert("full");
      expect(full.message).toContain('showed "saved"; it reverted to "idle"');
      expect(full.data).toMatchObject({
        source: "status",
        how: "reverted",
        shown: '"saved"',
        truth: '"idle"'
      });

      const none = await revert("none");
      expect(none.message).toContain("the optimistic value of status reverted at settle.");
      expect(none.message).not.toMatch(/saved|idle/);
      expect(none.data).toEqual({ source: "status", how: "reverted" });
    });
  });

  describe("across holds", () => {
    it("the least permissive level wins, and a release restores the others'", () => {
      const { interactions, reruns } = arm({ values: "full" });
      const { setN } = counter();
      const releaseNone = attribution.enable({ ...QUIET, values: "none" });
      OBSERVE!.attribution.withInteraction(SAVE, () => setN(1));
      flush();
      expect(interactions.at(-1)!.target).toBe("button#save");
      expect(reruns.at(-1)!.causes[0].prev).toBeUndefined();

      const releaseLabels = attribution.enable({ ...QUIET, values: "labels" });
      OBSERVE!.attribution.withInteraction(SAVE, () => setN(2));
      flush();
      // Three holders — full, none, labels — resolve to none.
      expect(interactions.at(-1)!.target).toBe("button#save");

      releaseNone();
      OBSERVE!.attribution.withInteraction(CARD, () => setN(3));
      flush();
      // full + labels → labels: no text on the div, no previews.
      expect(interactions.at(-1)!.target).toBe("div#card");
      expect(reruns.at(-1)!.causes[0].prev).toBeUndefined();
      OBSERVE!.attribution.withInteraction(SAVE, () => setN(4));
      flush();
      expect(interactions.at(-1)!.target).toBe('button#save "Save"');

      releaseLabels();
      OBSERVE!.attribution.withInteraction(CARD, () => setN(5));
      flush();
      // The first holder's full is what remains.
      expect(interactions.at(-1)!.target).toBe(CARD.target);
      expect(reruns.at(-1)!.causes[0]).toMatchObject({ prev: "4", value: "5" });
    });

    it("a holder that does not name a level asks for the tier's default (dev: full) — it never loosens another's", () => {
      const { interactions } = arm({ values: "none" });
      const { setN } = counter();
      const release = attribution.enable(QUIET);
      OBSERVE!.attribution.withInteraction(SAVE, () => setN(1));
      flush();
      expect(interactions.at(-1)!.target).toBe("button#save");
      release();
    });

    it("applies from the moment the level is in effect: earlier records keep what they carried", () => {
      const { interactions } = arm();
      const { setN } = counter();
      OBSERVE!.attribution.withInteraction(CARD, () => setN(1));
      flush();
      const release = attribution.enable({ ...QUIET, values: "none" });
      OBSERVE!.attribution.withInteraction(CARD, () => setN(2));
      flush();
      expect(interactions.map(i => i.target)).toEqual([CARD.target, "div#card"]);
      release();
    });
  });
});
