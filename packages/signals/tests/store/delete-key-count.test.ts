/**
 * The store's key count follows deletes.
 *
 * `kc` gates the overlay draft (an owned plain object above
 * OVERLAY_MIN_KEYS drafts as an overlay) and caps the rebuild. It went up on
 * every new key but came down only inside the overlay rebuild paths — never
 * when a key was deleted from a plain-clone draft, and never when an
 * overlay's own add was deleted again. The natural keyed-selection shape,
 * "delete the old key, set the new one", drifted the count up by one per
 * write: after 32 selections a three-key object crossed the overlay
 * threshold and, from then on, every delete forced the full rebuild clone
 * at commit (1.4 µs of a 5.5 µs select on the js-framework fixture).
 */
import { describe, expect, it } from "vitest";
import { createRoot, createStore, flush } from "../../src/index.js";
import { $TARGET } from "../../src/store/store.js";

const target = (proxy: object): any => (proxy as any)[$TARGET];
const ownKeys = (proxy: object) => Object.keys(target(proxy).v).length;

describe("the store's key count follows deletes", () => {
  it("delete-then-set selection keeps the count at the object's own keys and never drafts as an overlay", () => {
    const [sel, setSel] = createRoot(() =>
      createStore<Record<string, any>>({ selected: null as number | null })
    );
    for (let id = 1; id <= 200; id++) {
      setSel(s => {
        const prev = s.selected;
        if (prev != null && prev !== id) delete s[prev];
        s[id] = true;
        s.selected = id;
      });
      flush();
      const t = target(sel);
      expect(t.kc).toBe(ownKeys(sel));
      expect(t.ovl).toBe(false);
    }
    expect(ownKeys(sel)).toBe(2);
  });

  it("delete and re-add in one draft leaves the count unchanged", () => {
    const [store, set] = createRoot(() => createStore<Record<string, number>>({ a: 1, b: 2 }));
    set(d => {
      delete d.a;
      d.a = 3;
    });
    flush();
    expect(target(store).kc).toBe(2);
    expect(ownKeys(store)).toBe(2);
  });

  it("deleting a never-committed key of a draft does not go below the real count", () => {
    const [store, set] = createRoot(() => createStore<Record<string, number>>({ a: 1 }));
    set(d => {
      d.b = 2;
      delete d.b;
    });
    flush();
    expect(target(store).kc).toBe(1);
    expect(ownKeys(store)).toBe(1);
  });

  it("under an overlay, an own add deleted again is uncounted and a committed key's delete counts at the rebuild", () => {
    const seed: Record<string, number> = {};
    for (let i = 0; i < 64; i++) seed["k" + i] = i;
    const [store, set] = createRoot(() => createStore(seed));
    // first fold privatizes the seed; later drafts open as overlays
    set(d => {
      d.k0 = -1;
    });
    flush();
    const t = target(store);
    expect(t.kc).toBe(64);
    set(d => {
      (d as any).added = 1;
      delete (d as any).added;
    });
    flush();
    expect(t.kc).toBe(64);
    expect(ownKeys(store)).toBe(64);
    set(d => {
      delete d.k63;
    });
    flush();
    expect(t.kc).toBe(63);
    expect(ownKeys(store)).toBe(63);
    set(d => {
      (d as any).fresh = 1;
      delete d.k62;
    });
    flush();
    expect(t.kc).toBe(63);
    expect(ownKeys(store)).toBe(63);
  });
});
