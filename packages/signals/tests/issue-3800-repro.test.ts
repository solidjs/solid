import { describe, expect, it } from "vitest";
import {
  action,
  createLoadingBoundary,
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../src/index.js";

function hold(write: () => void) {
  let release!: () => void;
  action(function* () {
    write();
    yield new Promise<void>(resolve => (release = resolve));
  })();
  flush();
  return () => release();
}

const tick = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
  flush();
};

function setup() {
  const [count, setCount] = createSignal(1);
  const gates: Array<() => void> = [];
  const log: string[] = [];
  createRoot(() => {
    const slow = createMemo(async () => {
      const c = count();
      await new Promise<void>(r => gates.push(r));
      return c;
    });
    createRenderEffect(
      () => [count(), slow()] as const,
      ([c, s]) => void log.push(`parent ${c} ${s}`),
      undefined,
      { schedule: true }
    );
  });
  flush();
  return { count, setCount, gates, log };
}

function mountChild(s: ReturnType<typeof setup>, async: boolean) {
  createRoot(() => {
    const child = createMemo<number>(
      (async ? () => Promise.resolve(s.count()) : () => s.count()) as () => number
    );
    createRenderEffect(child, v => void s.log.push(`child ${v}`), undefined, { schedule: true });
  });
}

describe("#3800", () => {
  for (const async of [true, false]) {
    it(`${async ? "async" : "sync"} child created after flush() over a held count waits for the hold`, async () => {
      const s = setup();
      s.gates.shift()!();
      await tick();
      expect(s.log).toEqual(["parent 1 1"]);

      s.setCount(2);
      flush();
      mountChild(s, async);
      flush();
      await tick();
      expect(s.log).toEqual(["parent 1 1"]);

      s.gates.shift()!();
      await tick();
      expect(s.log).toEqual(["parent 1 1", "parent 2 2", "child 2"]);
    });
  }

  it("control: async child, no flush() before the mount, waits for the hold", async () => {
    const s = setup();
    s.gates.shift()!();
    await tick();
    s.setCount(2);
    mountChild(s, true);
    flush();
    await tick();
    expect(s.log).toEqual(["parent 1 1"]);
    s.gates.shift()!();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "parent 2 2", "child 2"]);
  });

  it("control: sync child, no flush() before the mount, reads committed 1 (A28)", async () => {
    const s = setup();
    s.gates.shift()!();
    await tick();
    s.setCount(2);
    mountChild(s, false);
    flush();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "child 1"]);
    s.gates.shift()!();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "child 1", "parent 2 2", "child 2"]);
  });
});

describe("#3800: a node created over a hold waits for it, and the hold waits for a render effect that reads it outside a boundary (column 2)", () => {
  // `slow` holds count = 2 while its flight is out; `parent` shows both.
  function setup() {
    const [count, setCount] = createSignal(1);
    const slowGates: Array<() => void> = [];
    const log: string[] = [];
    createRoot(() => {
      const slow = createMemo(async () => {
        const c = count();
        await new Promise<void>(resolve => slowGates.push(resolve));
        return c;
      });
      createRenderEffect(
        () => [count(), slow()] as const,
        ([c, s]) => {
          log.push(`parent ${c} ${s}`);
        },
        undefined,
        { schedule: true }
      );
    });
    flush();
    return { count, setCount, slowGates, log };
  }

  async function holdCount(s: ReturnType<typeof setup>) {
    s.slowGates.shift()!();
    await tick();
    s.setCount(2);
    flush();
    expect(s.log).toEqual(["parent 1 1"]);
  }

  it("a first load that reads the held value lands into the hold (the report)", async () => {
    const s = setup();
    await holdCount(s);
    createRoot(() => {
      const child = createMemo(() => Promise.resolve(s.count()));
      createRenderEffect(
        child,
        v => {
          s.log.push(`child ${v}`);
        },
        undefined,
        { schedule: true }
      );
    });
    flush();
    await tick();
    expect(s.log).toEqual(["parent 1 1"]);

    s.slowGates.shift()!();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "parent 2 2", "child 2"]);
  });

  it("under a fresh boundary: the fallback shows until the hold commits the content", async () => {
    const s = setup();
    await holdCount(s);
    createRoot(() => {
      const child = createMemo(() => Promise.resolve(s.count()));
      const view = createLoadingBoundary(
        () => `content ${child()}`,
        () => "fallback"
      );
      createRenderEffect(
        view,
        v => {
          s.log.push(`view ${v}`);
        },
        undefined,
        { schedule: true }
      );
    });
    flush();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "view fallback"]);

    s.slowGates.shift()!();
    await tick();
    expect(s.log).toEqual(["parent 1 1", "view fallback", "parent 2 2", "view content 2"]);
  });

  // The same memo created INSIDE the boundary: content that derives from the
  // hold appears at the hold's commit (D-12), whatever position the memo was
  // created in. Today its first answer lands on its own, beside the held
  // parent — the boundary's catch at creation (`_fresh`) keys on where it
  // was created (#3977 review, item 5).
  it.fails(
    "created inside a fresh boundary: the content still waits for the hold's commit",
    async () => {
      const s = setup();
      await holdCount(s);
      createRoot(() => {
        const view = createLoadingBoundary(
          () => {
            const child = createMemo(() => Promise.resolve(s.count()));
            createRenderEffect(child, v => void s.log.push(`child ${v}`));
            return "content";
          },
          () => "fallback"
        );
        createRenderEffect(view, v => void s.log.push(`view ${v}`), undefined, { schedule: true });
      });
      flush();
      await tick();
      expect(s.log).toEqual(["parent 1 1", "view fallback"]);

      s.slowGates.shift()!();
      await tick();
      expect(s.log.slice(0, 3)).toEqual(["parent 1 1", "view fallback", "parent 2 2"]);
    }
  );

  it("a slower first load keeps the hold open; parent and child reveal together when it lands", async () => {
    const s = setup();
    await holdCount(s);
    const childGates: Array<() => void> = [];
    createRoot(() => {
      const child = createMemo(async () => {
        const c = s.count();
        await new Promise<void>(resolve => childGates.push(resolve));
        return c;
      });
      createRenderEffect(
        child,
        v => {
          s.log.push(`child ${v}`);
        },
        undefined,
        { schedule: true }
      );
    });
    flush();

    s.slowGates.shift()!();
    await tick();
    expect(s.log).toEqual(["parent 1 1"]);

    childGates.shift()!();
    await tick();
    expect(s.log.slice(0, 1)).toEqual(["parent 1 1"]);
    expect([...s.log.slice(1)].sort()).toEqual(["child 2", "parent 2 2"]);
  });

  it("an action's hold waits for the pages' first loads read outside a boundary", async () => {
    const [user, setUser] = createSignal("ann");
    const log: string[] = [];
    createRoot(() => {
      createRenderEffect(user, u => {
        log.push(`header ${u}`);
      });
    });
    flush();
    const release = hold(() => setUser("bob"));

    const pageGates: Array<() => void> = [];
    const mount = (name: string) =>
      createRoot(() => {
        const page = createMemo(async () => {
          const u = user();
          await new Promise<void>(resolve => pageGates.push(resolve));
          return `${name}-${u}`;
        });
        createRenderEffect(page, v => {
          log.push(`page ${v}`);
        });
      });
    mount("fast");
    flush();
    mount("slow");
    flush();

    pageGates.shift()!();
    await tick();
    expect(log).toEqual(["header ann"]);

    release();
    await tick();
    expect(log).toEqual(["header ann"]);

    pageGates.shift()!();
    await tick();
    expect(log.slice(0, 1)).toEqual(["header ann"]);
    expect([...log.slice(1)].sort()).toEqual(["header bob", "page fast-bob", "page slow-bob"]);
  });
});
