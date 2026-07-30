/**
 * @vitest-environment jsdom
 *
 * Client-side behavior of @solidjs/web/data's query(): promise-identity
 * deduping, revalidation through the per-entry version signal, and
 * `query.set` seeding reaching tracking scopes without a refetch.
 */
import { describe, expect, it } from "vitest";
import { createMemo, createRoot, flush } from "solid-js";
import { query, revalidate } from "../src/query.js";

const tick = () => new Promise(r => setTimeout(r, 0));

describe("query()", () => {
  it("dedupes by key: same promise for loader-style and tracked reads", () => {
    let calls = 0;
    const q = query(async () => {
      calls++;
      return "value";
    }, "dedupe-test");

    const first = q();
    const second = q();
    expect(second).toBe(first);
    expect(calls).toBe(1);
    expect(q.key).toBe("dedupe-test");
    expect(q.keyFor()).toBe("dedupe-test[]");
    query.clear();
  });

  it("hashes arguments into the key", () => {
    let calls = 0;
    const q = query(async (id: number) => {
      calls++;
      return id;
    }, "args-test");

    const one = q(1);
    expect(q(1)).toBe(one);
    expect(q(2)).not.toBe(one);
    expect(calls).toBe(2);
    expect(q.keyFor(2)).toBe("args-test[2]");
    query.clear();
  });

  it("revalidate() marks entries stale and retriggers tracking scopes", async () => {
    let calls = 0;
    const q = query(async () => {
      calls++;
      return "v" + calls;
    }, "revalidate-test");

    await createRoot(async dispose => {
      const value = createMemo(() => q());
      flush();
      await tick();
      expect(calls).toBe(1);

      revalidate("revalidate-test");
      flush();
      await tick();
      // the tracking memo re-ran and the stale entry refetched
      expect(calls).toBe(2);
      expect(await value()).toBe("v2");
      dispose();
    });
    query.clear();
  });

  it("query.set seeds a value tracking scopes pick up without a refetch", async () => {
    let calls = 0;
    const q = query(async () => {
      calls++;
      return "fetched";
    }, "set-test");

    await createRoot(async dispose => {
      const value = createMemo(() => q());
      flush();
      await tick();
      expect(calls).toBe(1);

      query.set(q.keyFor(), "seeded");
      flush();
      await tick();
      expect(calls).toBe(1); // no refetch — the seeded promise was adopted
      expect(await value()).toBe("seeded");
      expect(query.get(q.keyFor())).toBe("seeded");
      dispose();
    });
    query.clear();
  });
});
