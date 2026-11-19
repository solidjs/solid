// Time travel driven by `openView`, with steps recorded from the attribution
// engine's `flush` record (`view-time-travel.ts`): what a devtool's history
// view shows, resumes and branches. Tests named "known gap" pin a shortfall of the view, not a
// wanted behavior; each is listed in 08-dev-diagnostics.md.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  action,
  createEffect,
  createMemo,
  createOptimistic,
  createRenderEffect,
  createRoot,
  createSignal,
  createStore,
  flush,
  isPending,
  latest,
  OBSERVE,
  snapshot,
  untrack
} from "../src/index.js";
import { attribution } from "../src/attribution.js";
import { createTimeTravel } from "./view-time-travel.js";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));
const settle = async () => {
  await tick();
  await tick();
  flush();
};

const timeTravel = createTimeTravel();
let stop: () => void;
let dispose: (() => void) | undefined;

beforeEach(() => {
  stop = timeTravel.record();
});
afterEach(() => {
  timeTravel.reset();
  dispose?.();
  dispose = undefined;
  flush();
  stop();
  attribution.disable();
  vi.restoreAllMocks();
});

/** Mounts under a root; `show` is a render effect whose values are logged. */
function mount(fn: (show: (compute: () => string) => void) => void): string[] {
  const log: string[] = [];
  createRoot(d => {
    dispose = d;
    fn(compute => createRenderEffect(compute, v => void log.push(v)));
  });
  flush();
  return log;
}

const described = () =>
  timeTravel.steps().map(s => s.map(c => `${c.nodeName}:${String(c.prev)}>${String(c.value)}`));

describe("time travel: signals and memos", () => {
  it("records one step per drain that changed the screen", () => {
    const [count, setCount] = createSignal(1, { name: "count" });
    mount(show => show(() => `${count()}`));
    setCount(2);
    flush();
    setCount(3);
    flush();
    expect(described()).toEqual([["count:1>2"], ["count:2>3"]]);
  });

  it("shows an earlier step through the render path; sync memos re-derive", () => {
    const [count, setCount] = createSignal(1, { name: "count" });
    const [other, setOther] = createSignal(10, { name: "other" });
    let runs = 0;
    const log = mount(show => {
      const double = createMemo(() => (runs++, count() * 2), { name: "double" });
      show(() => `${count()}/${double()}/${other()}`);
    });
    setCount(2);
    flush();
    setCount(3);
    flush();
    expect(log).toEqual(["1/2/10", "2/4/10", "3/6/10"]);

    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1/2/10");
    expect(timeTravel.viewing()).toBe(-1);

    // Live writes are hidden, to pinned and unpinned nodes alike.
    setCount(4);
    setOther(11);
    flush();
    expect(log.at(-1)).toBe("1/2/10");
    expect(count()).toBe(1);

    // Forwards, to the same step, backwards.
    timeTravel.view(0);
    expect(log.at(-1)).toBe("2/4/10");
    timeTravel.view(1);
    expect(log.at(-1)).toBe("3/6/10");
    const n = log.length;
    timeTravel.view(1);
    expect(log.length).toBe(n);
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1/2/10");

    const before = log.length;
    expect(timeTravel.resume()).toBe(true);
    // One run lands everything the live program did meanwhile.
    expect(log.slice(before)).toEqual(["4/8/11"]);
    expect(timeTravel.viewing()).toBe(null);
    expect(count()).toBe(4);

    // The landing is one step, recorded against the present the view opened over.
    expect(described().at(-1)!.sort()).toEqual(["count:3>4", "double:6>8", "other:10>11"]);
    expect(timeTravel.steps().length).toBe(3);
  });

  it("a live write on one pin leaves the other pins shown", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const [b, setB] = createSignal(10, { name: "b" });
    const log = mount(show => show(() => `${a()}/${b()}`));
    setA(2);
    setB(20);
    flush();
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1/10");
    const n = log.length;
    setA(3);
    flush();
    setB(30);
    flush();
    expect(log.length).toBe(n);
    expect([a(), b()]).toEqual([1, 10]);
    timeTravel.resume();
    expect(log.at(-1)).toBe("3/30");
  });

  it("viewing the last step freezes the present", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    setA(2);
    flush();
    timeTravel.view(0);
    setA(3);
    flush();
    expect(log.at(-1)).toBe("2");
    timeTravel.resume();
    expect(log.at(-1)).toBe("3");
  });

  it("a live write on a pin, then moving between steps, then resume", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    setA(2);
    flush();
    setA(3);
    flush();
    timeTravel.view(-1);
    setA(50);
    flush();
    expect(log.at(-1)).toBe("1");
    timeTravel.view(0);
    expect(log.at(-1)).toBe("2");
    expect(untrack(a)).toBe(2);
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1");
    timeTravel.view(1);
    expect(log.at(-1)).toBe("3");
    timeTravel.resume();
    expect(log.at(-1)).toBe("50");
  });

  it("an updater after a live write composes on the live truth (F-10)", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    setA(2);
    flush();
    timeTravel.view(-1);
    setA(10);
    flush();
    setA(v => v + 1);
    flush();
    expect(log.at(-1)).toBe("1");
    timeTravel.resume();
    expect(log.at(-1)).toBe("11");
  });

  it("a live write equal to the pin lands at resume", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    setA(2);
    flush();
    timeTravel.view(-1);
    setA(1);
    flush();
    expect(log.at(-1)).toBe("1");
    timeTravel.view(0);
    expect(log.at(-1)).toBe("2");
    timeTravel.resume();
    expect(log.at(-1)).toBe("1");
  });

  it("drops the oldest steps past the limit; -1 is before the oldest kept", () => {
    stop();
    stop = timeTravel.record({ limit: 2 });
    const [a, setA] = createSignal(0, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    for (let i = 1; i <= 5; i++) (setA(i), flush());
    expect(timeTravel.steps().length).toBe(2);
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("3");
    timeTravel.resume();
    expect(log.at(-1)).toBe("5");
  });
});

describe("time travel: user effects", () => {
  function setup(viaMemo: boolean) {
    const [a, setA] = createSignal(1, { name: "a" });
    const ev: string[] = [];
    mount(() => {
      const src = viaMemo ? createMemo(() => a() * 10) : a;
      createEffect(
        () => src(),
        v => {
          ev.push("run" + v);
          return () => ev.push("clean" + v);
        }
      );
    });
    setA(2);
    flush();
    ev.length = 0;
    return { setA, ev };
  }

  for (const viaMemo of [false, true]) {
    const m = viaMemo ? 10 : 1;
    const via = viaMemo ? " (through a memo)" : "";

    it(`nothing changed beneath the view: no run and no cleanup at resume${via}`, () => {
      const { ev } = setup(viaMemo);
      timeTravel.view(-1);
      timeTravel.resume();
      flush();
      expect(ev).toEqual([]);
    });

    it(`a source's truth moved beneath the view: one run, with the landed value${via}`, () => {
      const { setA, ev } = setup(viaMemo);
      timeTravel.view(-1);
      setA(3);
      flush();
      setA(4);
      flush();
      expect(ev).toEqual([]);
      timeTravel.resume();
      flush();
      expect(ev).toEqual([`clean${2 * m}`, `run${4 * m}`]);
    });

    it(`a source that moved and came back: no run${via}`, () => {
      const { setA, ev } = setup(viaMemo);
      timeTravel.view(-1);
      setA(3);
      flush();
      setA(2);
      flush();
      timeTravel.view(0);
      timeTravel.resume();
      flush();
      expect(ev).toEqual([]);
    });
  }

  it("a user effect waits while viewing and runs at the landing", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const seen: number[] = [];
    mount(() => createEffect(a, v => void seen.push(v)));
    setA(2);
    flush();
    timeTravel.view(-1);
    setA(5);
    flush();
    timeTravel.view(0);
    expect(seen).toEqual([1, 2]);
    timeTravel.resume();
    flush();
    expect(seen).toEqual([1, 2, 5]);
  });

  it("effects: true runs user effects on the view", () => {
    stop();
    stop = timeTravel.record({ effects: true });
    const [a, setA] = createSignal(1, { name: "a" });
    const seen: number[] = [];
    mount(() => createEffect(a, v => void seen.push(v)));
    setA(2);
    flush();
    timeTravel.view(-1);
    expect(seen).toEqual([1, 2, 1]);
    timeTravel.resume();
    flush();
    expect(seen).toEqual([1, 2, 1, 2]);
  });

  it("known gap: a reader the view moved back to the present runs once more at resume, with the same value", () => {
    stop();
    stop = timeTravel.record({ effects: true });
    const [a, setA] = createSignal(1, { name: "a" });
    const user: number[] = [];
    const render: number[] = [];
    mount(() => {
      createEffect(a, v => void user.push(v));
      createRenderEffect(a, v => void render.push(v));
    });
    setA(2);
    flush();
    timeTravel.view(-1);
    timeTravel.view(0);
    expect(render).toEqual([1, 2, 1, 2]);
    timeTravel.resume();
    flush();
    expect(render).toEqual([1, 2, 1, 2, 2]);
    expect(user).toEqual([1, 2, 1, 2, 2]);
  });
});

describe("time travel: branch", () => {
  it("makes the viewed step the truth and forgets the later steps", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const [b, setB] = createSignal(10, { name: "b" });
    const log = mount(show => {
      const sum = createMemo(() => a() + b());
      show(() => `${a()}+${b()}=${sum()}`);
    });
    setA(2);
    flush();
    setA(3);
    flush();
    timeTravel.view(0);
    expect(log.at(-1)).toBe("2+10=12");
    // Live writes beneath are dropped by the branch.
    setA(9);
    setB(99);
    flush();
    const n = log.length;
    timeTravel.branch();
    expect(timeTravel.viewing()).toBe(null);
    expect(log.slice(n).every(v => v === "2+10=12")).toBe(true);
    expect([a(), b()]).toEqual([2, 10]);
    expect(timeTravel.steps().length).toBe(1);
    // Later writes compose on the branch value.
    setA(v => v + 1);
    flush();
    expect(log.at(-1)).toBe("3+10=13");
    expect(timeTravel.steps().length).toBe(2);
  });

  it("after a live write on a pin: the pin is the truth", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    setA(2);
    flush();
    timeTravel.view(-1);
    setA(10);
    flush();
    timeTravel.branch();
    expect(log.at(-1)).toBe("1");
    expect(a()).toBe(1);
    setA(v => v + 1);
    flush();
    expect(log.at(-1)).toBe("2");
  });

  it("two live writes on one pin, moving steps, then branch", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const [b, setB] = createSignal(10, { name: "b" });
    const log = mount(show => show(() => `${a()}/${b()}`));
    setA(2);
    flush();
    setB(20);
    flush();
    timeTravel.view(-1);
    setA(7);
    flush();
    setA(8);
    flush();
    expect(log.at(-1)).toBe("1/10");
    timeTravel.view(0);
    expect(log.at(-1)).toBe("2/10");
    timeTravel.branch();
    expect(log.at(-1)).toBe("2/10");
    expect([a(), b()]).toEqual([2, 10]);
  });
});

describe("time travel: structure", () => {
  it("a flipped condition remounts the earlier branch, and the live one on resume", () => {
    const [on, setOn] = createSignal(true, { name: "on" });
    const [n, setN] = createSignal(0, { name: "n" });
    const mounts: string[] = [];
    const log: string[] = [];
    mount(() => {
      const branch = createMemo(() => {
        const side = on() ? "A" : "B";
        mounts.push(side);
        createRenderEffect(
          () => `${side}:${n()}`,
          v => void log.push(v)
        );
        return side;
      });
      createRenderEffect(
        () => `branch=${branch()}`,
        v => void log.push(v)
      );
    });
    setOn(false);
    flush();
    setN(1);
    flush();
    expect(log).toEqual(["A:0", "branch=A", "B:0", "branch=B", "B:1"]);
    log.length = 0;

    timeTravel.view(-1);
    expect(log).toEqual(["A:0", "branch=A"]);
    log.length = 0;
    timeTravel.view(0);
    expect(log).toEqual(["B:0", "branch=B"]);
    log.length = 0;
    timeTravel.view(-1);
    setN(2);
    flush();
    log.length = 0;
    timeTravel.resume();
    expect(log.slice().sort()).toEqual(["B:2", "branch=B"]);
    expect(mounts.join("")).toBe("ABABAB");
  });

  it("a branch mounted beneath the view stays hidden until resume", () => {
    const [on, setOn] = createSignal(false, { name: "on" });
    const [x, setX] = createSignal(0, { name: "x" });
    const mounts: string[] = [];
    const log = mount(show => {
      const inner = createMemo(() => {
        if (!on()) return "off";
        mounts.push("on");
        return `on:${x()}`;
      });
      show(() => inner());
    });
    setX(1);
    flush();
    timeTravel.view(-1);
    setOn(true);
    flush();
    expect(log.at(-1)).toBe("off");
    timeTravel.resume();
    expect(log.at(-1)).toBe("on:1");
  });
});

describe("time travel: stores", () => {
  it("rewinds a property, an array push and a nested write", () => {
    const [s, setS] = createStore({ a: 1, list: [{ t: "x" }] as { t: string }[] });
    const log = mount(show => show(() => `${s.a}/${s.list.map(i => i.t).join(",")}`));
    setS(d => {
      d.a = 2;
    });
    flush();
    setS(d => {
      d.list.push({ t: "y" });
    });
    flush();
    setS(d => {
      d.list[0].t = "z";
    });
    flush();
    expect(log.at(-1)).toBe("2/z,y");
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1/x");
    timeTravel.view(0);
    expect(log.at(-1)).toBe("2/x");
    timeTravel.view(1);
    expect(log.at(-1)).toBe("2/x,y");
    setS(d => {
      d.a = 5;
    });
    flush();
    expect(log.at(-1)).toBe("2/x,y");
    timeTravel.resume();
    expect(log.at(-1)).toBe("5/z,y");
  });

  it("a key added since is gone in the view: its value, `in` and the key list", () => {
    const [s, setS] = createStore<{ a: number; b?: number }>({ a: 1 });
    const log = mount(show => show(() => `${s.a}/${s.b}/${"b" in s}/${Object.keys(s).join(",")}`));
    setS(d => {
      d.b = 2;
    });
    flush();
    expect(log.at(-1)).toBe("1/2/true/a,b");
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1/undefined/false/a");
    timeTravel.resume();
    expect(log.at(-1)).toBe("1/2/true/a,b");
  });

  it("keyed list items: added, reordered and edited rows come back", () => {
    type Row = { id: number; text: string };
    const [s, setS] = createStore({
      rows: [
        { id: 1, text: "a" },
        { id: 2, text: "b" }
      ] as Row[]
    });
    const log = mount(show => show(() => s.rows.map(r => `${r.id}${r.text}`).join(",")));
    setS(d => {
      d.rows.push({ id: 3, text: "c" });
    });
    flush();
    setS(d => {
      d.rows.reverse();
    });
    flush();
    setS(d => {
      d.rows[0].text = "C";
    });
    flush();
    expect(log.at(-1)).toBe("3C,2b,1a");
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1a,2b");
    timeTravel.view(0);
    expect(log.at(-1)).toBe("1a,2b,3c");
    timeTravel.view(1);
    expect(log.at(-1)).toBe("3c,2b,1a");
    timeTravel.resume();
    expect(log.at(-1)).toBe("3C,2b,1a");
  });

  it("known gap: an index removed since stays absent in the view", () => {
    const [s, setS] = createStore({ rows: ["a", "b", "c"] });
    const log = mount(show =>
      show(() => {
        const r = s.rows;
        const out: string[] = [];
        for (let i = 0; i < r.length; i++) out.push(`${i in r}:${r[i]}`);
        return out.join(",");
      })
    );
    setS(d => {
      d.rows.splice(1, 1);
    });
    flush();
    expect(log.at(-1)).toBe("true:a,true:c");
    timeTravel.view(-1);
    // The index's value and presence nodes are pinned (`c`, `true`); the
    // length comes back, the removed index does not.
    expect(log.at(-1)).toBe("true:a,true:b,false:undefined");
    timeTravel.resume();
    expect(log.at(-1)).toBe("true:a,true:c");
  });

  it("known gap: a property nothing read when it changed has no node, so it does not rewind", () => {
    const [s, setS] = createStore({ shown: 1, hidden: 1 });
    const [peek, setPeek] = createSignal(false, { name: "peek" });
    const log = mount(show => show(() => `${s.shown}/${peek() ? s.hidden : "-"}`));
    setS(d => {
      d.shown = 2;
      d.hidden = 2;
    });
    flush();
    expect(timeTravel.steps()[0].map(c => c.key)).toEqual(["shown"]);
    setPeek(true);
    flush();
    expect(log.at(-1)).toBe("2/2");
    timeTravel.view(0);
    // `hidden` was 1 at step 0's end only in the past nobody recorded.
    expect(log.at(-1)).toBe("2/-");
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1/-");
    timeTravel.resume();
  });

  it("known gap: snapshot() reads the store's backing, which is the present", () => {
    const [s, setS] = createStore({ a: 1 });
    const log = mount(show => show(() => `${s.a}`));
    setS(d => {
      d.a = 2;
    });
    flush();
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1");
    expect(s.a).toBe(1);
    expect(snapshot(s).a).toBe(2);
    timeTravel.resume();
  });

  it("known gap: branch() lands the nodes, not the store's backing", () => {
    const [s, setS] = createStore({ a: 1 });
    const log = mount(show => show(() => `${s.a}`));
    setS(d => {
      d.a = 2;
    });
    flush();
    timeTravel.view(-1);
    timeTravel.branch();
    expect(log.at(-1)).toBe("1");
    expect(s.a).toBe(1);
    expect(snapshot(s).a).toBe(2);
  });
});

describe("time travel: state born in a remounted branch", () => {
  it("known gap: a remounted branch's own signals start over; their history is not replayed", () => {
    const [on, setOn] = createSignal(true, { name: "on" });
    const log: string[] = [];
    let bump!: () => void;
    mount(() => {
      const branch = createMemo(() => {
        if (!on()) return "off";
        const [local, setLocal] = createSignal(0, { name: "local" });
        bump = () => setLocal(v => v + 1);
        createRenderEffect(
          () => `local:${local()}`,
          v => void log.push(v)
        );
        return "on";
      });
      createRenderEffect(branch, () => {});
    });
    bump();
    flush();
    setOn(false);
    flush();
    expect(log).toEqual(["local:0", "local:1"]);
    timeTravel.view(0);
    // Step 0 showed `local:1`; the remount creates a new `local`.
    expect(log.at(-1)).toBe("local:0");
    timeTravel.resume();
  });
});

describe("time travel: async", () => {
  it("an async memo is pinned: no refetch while viewing, between steps or on resume", async () => {
    const [id, setId] = createSignal(1, { name: "id" });
    let fetches = 0;
    const log = mount(show => {
      const user = createMemo(
        async () => {
          const i = id();
          fetches++;
          await tick();
          return "user" + i;
        },
        { name: "user" }
      );
      show(() => `${id()}/${user()}`);
    });
    await settle();
    setId(2);
    flush();
    await settle();
    setId(3);
    flush();
    await settle();
    expect(log.at(-1)).toBe("3/user3");
    expect(fetches).toBe(3);

    // A landing is one step with the input that asked it.
    expect(described()).toEqual([
      ["id:1>2", "user:user1>user2"],
      ["id:2>3", "user:user2>user3"]
    ]);
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1/user1");
    await settle();
    timeTravel.view(0);
    expect(log.at(-1)).toBe("2/user2");
    timeTravel.view(1);
    expect(log.at(-1)).toBe("3/user3");
    timeTravel.view(-1);
    await settle();
    expect(fetches).toBe(3);
    expect(log.at(-1)).toBe("1/user1");

    expect(timeTravel.resume()).toBe(true);
    expect(log.at(-1)).toBe("3/user3");
    await settle();
    expect(fetches).toBe(3);
  });

  it("a live write beneath the view asks once, at the landing", async () => {
    const [id, setId] = createSignal(1, { name: "id" });
    const asked: number[] = [];
    const log = mount(show => {
      const user = createMemo(async () => {
        const i = id();
        asked.push(i);
        await tick();
        return "user" + i;
      });
      show(() => `${id()}/${user()}`);
    });
    await settle();
    setId(2);
    flush();
    await settle();
    timeTravel.view(-1);
    setId(3);
    flush();
    await settle();
    expect(asked).toEqual([1, 2]);
    expect(log.at(-1)).toBe("1/user1");
    timeTravel.resume();
    await settle();
    expect(asked).toEqual([1, 2, 3]);
    expect(log.at(-1)).toBe("3/user3");
  });

  it("resume() is false while the landing waits; the view stays until it lands", async () => {
    const [id, setId] = createSignal(1, { name: "id" });
    const asked: number[] = [];
    const log = mount(show => {
      const user = createMemo(
        async () => {
          const i = id();
          asked.push(i);
          await tick(15);
          return "user" + i;
        },
        { name: "user" }
      );
      show(() => `${id()}/${user()}`);
    });
    await tick(40);
    flush();
    setId(2);
    flush();
    await tick(40);
    flush();
    timeTravel.view(-1);
    setId(3);
    flush();
    expect(timeTravel.resume()).toBe(false);
    expect(timeTravel.landing()).toBe(true);
    expect(log.at(-1)).toBe("1/user1");
    await tick(40);
    flush();
    expect(timeTravel.landing()).toBe(false);
    expect(log.at(-1)).toBe("3/user3");
    expect(asked).toEqual([1, 2, 3]);
    expect(timeTravel.resume()).toBe(true);
    // The landing is recorded against what was recorded before the view.
    expect(described().at(-1)!.sort()).toEqual(["id:2>3", "user:user2>user3"]);
  });

  it("an async landing beneath the view stays hidden until resume", async () => {
    const [id, setId] = createSignal(1, { name: "id" });
    const log = mount(show => {
      const user = createMemo(async () => {
        const i = id();
        await tick(10);
        return "user" + i;
      });
      show(() => `${user()}`);
    });
    await tick(30);
    flush();
    setId(2);
    flush();
    await tick(30);
    flush();
    // A sibling that is not pinned: its own refetch lands beneath the view.
    const [n, setN] = createSignal(0, { name: "n" });
    const other = createRoot(() =>
      createMemo(async () => {
        const v = n();
        await tick(10);
        return v;
      })
    );
    const seen: unknown[] = [];
    createRoot(() => createRenderEffect(other, v => void seen.push(v)));
    await tick(30);
    flush();
    timeTravel.view(-1);
    setN(1);
    flush();
    await tick(30);
    flush();
    expect(seen.at(-1)).toBe(0);
    expect(log.at(-1)).toBe("user1");
    timeTravel.resume();
    await tick(30);
    flush();
    expect(seen.at(-1)).toBe(1);
    expect(log.at(-1)).toBe("user2");
  });

  it("known gap: a flight in flight at view entry lands beneath the view and is asked again at resume", async () => {
    const [id, setId] = createSignal(1, { name: "id" });
    let fetches = 0;
    const log = mount(show => {
      const user = createMemo(async () => {
        const i = id();
        fetches++;
        await tick(15);
        return "user" + i;
      });
      show(() => `${id()}/${user()}`);
    });
    await tick(30);
    flush();
    setId(2);
    flush();
    await tick(30);
    flush();
    setId(3);
    flush();
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1/user1");
    await tick(30);
    flush();
    expect(log.at(-1)).toBe("1/user1");
    timeTravel.resume();
    await tick(30);
    flush();
    expect(log.at(-1)).toBe("3/user3");
    // `user3` landed beneath the pin; the held input still reads as moved,
    // so the pinned pass is owed and asks once more.
    expect(fetches).toBe(4);
  });

  it("known gap: isPending under a view reports the live program's pending", async () => {
    const [id, setId] = createSignal(1, { name: "id" });
    const out: string[] = [];
    mount(show => {
      const user = createMemo(
        async () => {
          const i = id();
          await tick(10);
          return "user" + i;
        },
        { name: "user" }
      );
      show(() => `${user()}`);
      createRenderEffect(
        () => `${isPending(() => user())}/${latest(() => id())}`,
        v => void out.push(v)
      );
    });
    await tick(30);
    flush();
    setId(2);
    flush();
    await tick(30);
    flush();
    timeTravel.view(-1);
    const entered = out.at(-1);
    setId(3);
    flush();
    const afterLiveWrite = out.at(-1);
    await tick(30);
    flush();
    timeTravel.resume();
    await tick(30);
    flush();
    expect({ entered, afterLiveWrite, end: out.at(-1) }).toEqual({
      entered: "false/1",
      afterLiveWrite: "true/1",
      end: "false/3"
    });
  });
});

describe("time travel: actions", () => {
  it("an action in flight when the view opens lands at the resume", async () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    setA(2);
    flush();
    const save = action(function* () {
      setA(3);
      yield tick(20);
      setA(4);
    });
    save();
    flush();
    timeTravel.view(-1);
    expect(log.at(-1)).toBe("1");
    await tick(40);
    flush();
    expect(log.at(-1)).toBe("1");
    expect(timeTravel.resume()).toBe(true);
    expect(log.at(-1)).toBe("4");
  });

  it("an action started beneath the view runs hidden; its updaters compose on the truth", async () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    setA(2);
    flush();
    timeTravel.view(-1);
    const save = action(function* () {
      setA(v => v + 10);
      yield tick(10);
      setA(v => v + 10);
    });
    save();
    await tick(30);
    flush();
    expect(log.at(-1)).toBe("1");
    timeTravel.resume();
    expect(log.at(-1)).toBe("22");
  });

  it("an action that wrote a pinned node beneath the view: branch drops its writes", async () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    setA(2);
    flush();
    timeTravel.view(-1);
    const save = action(function* () {
      setA(100);
      yield tick(5);
      setA(200);
    });
    save();
    flush();
    await tick(20);
    flush();
    expect(log.at(-1)).toBe("1");
    timeTravel.branch();
    flush();
    await tick(20);
    flush();
    expect(log.at(-1)).toBe("1");
    expect(a()).toBe(1);
  });

  it("a user's optimistic guess shown at view entry", async () => {
    const [count, setCount] = createSignal(1, { name: "count" });
    const [shownCount, setShown] = createOptimistic(() => count(), { name: "shown" });
    const log = mount(show => show(() => `${shownCount()}`));
    setCount(2);
    flush();
    const save = action(function* () {
      setShown(99);
      yield tick(20);
      setCount(3);
    });
    save();
    flush();
    expect(log.at(-1)).toBe("99");
    expect(described()).toEqual([["count:1>2", "shown:1>2"], ["shown:2>99"]]);
    timeTravel.view(0);
    expect(log.at(-1)).toBe("2");
    await tick(40);
    flush();
    expect(log.at(-1)).toBe("2");
    timeTravel.resume();
    flush();
    expect(log.at(-1)).toBe("3");
  });
});

describe("time travel: untracked reads", () => {
  it("known gap: a handler's read sees the view, so a computed write derives from the past", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const log = mount(show => show(() => `${a()}`));
    setA(2);
    flush();
    timeTravel.view(-1);
    setA(a() * 10);
    flush();
    timeTravel.resume();
    expect(log.at(-1)).toBe("10");
  });
});

describe("time travel: the engine's records under a view", () => {
  it("a flush listener sees the pins, none of the hidden live writes, and the landing", () => {
    const [a, setA] = createSignal(1, { name: "a" });
    const [b, setB] = createSignal(10, { name: "b" });
    mount(show => show(() => `${a()}/${b()}`));
    setA(2);
    flush();
    const seen: string[][] = [];
    const off = OBSERVE!.records.subscribe(
      "flush",
      (e, live) =>
        void (
          e.changes.length &&
          seen.push(
            e.changes.map(
              (c, i) => `${c.nodeName}:${live!.changes[i].prev}>${live!.changes[i].value}`
            )
          )
        ),
      { bodies: true }
    );
    timeTravel.view(-1);
    // The pin shows: the record lists what the screen showed.
    expect(seen).toEqual([["a:2>1"]]);
    setA(3);
    flush();
    setB(20);
    flush();
    expect(seen).toEqual([["a:2>1"]]);
    timeTravel.resume();
    // One record: the landing, against what the view showed.
    expect(seen.length).toBe(2);
    expect(seen[1].sort()).toEqual(["a:1>3", "b:10>20"]);
    off();
  });
});

describe("time travel: the engine's holds and interactions under a view", () => {
  // Thresholds low enough that a short view would be judged as a hold.
  const sensitive = () =>
    attribution.enable({
      log: false,
      holds: { infoMs: 10, warnMs: 20 },
      longHolds: { infoMs: 10, warnMs: 20 }
    });

  it("the view's hold is not an app hold: no hold record and no hold finding", async () => {
    const release = sensitive();
    const codes: string[] = [];
    const holds: unknown[] = [];
    const offs = [
      OBSERVE!.diagnostics.subscribe(e => void codes.push(e.code)),
      OBSERVE!.records.subscribe("hold", e => void holds.push(e))
    ];
    try {
      const [a, setA] = createSignal(1, { name: "a" });
      const log = mount(show => show(() => `${a()}`));
      setA(2);
      flush();
      timeTravel.view(-1);
      OBSERVE!.attribution.withInteraction({ type: "click", target: "button#inc" }, () =>
        setA(v => v + 1)
      );
      flush();
      await tick(40);
      timeTravel.resume();
      expect(log.at(-1)).toBe("3");
      expect(holds).toEqual([]);
      expect(codes).toEqual([]);
    } finally {
      offs.forEach(off => off());
      release();
    }
  });

  it("an app hold open when the view opens is not reported as held through the view", async () => {
    const release = sensitive();
    const codes: string[] = [];
    const holds: number[] = [];
    const offs = [
      OBSERVE!.diagnostics.subscribe(e => void codes.push(e.code)),
      OBSERVE!.records.subscribe("hold", e => void holds.push(e.holdMs))
    ];
    try {
      const [id, setId] = createSignal(1, { name: "id" });
      const log = mount(show => {
        const user = createMemo(
          async () => {
            const i = id();
            await tick(5);
            return "user" + i;
          },
          { name: "user" }
        );
        show(() => `${id()}/${user()}`);
      });
      await tick(20);
      flush();
      setId(2);
      flush();
      await tick(20);
      flush();
      codes.length = holds.length = 0;
      setId(3);
      flush();
      timeTravel.view(-1);
      await tick(60);
      flush();
      timeTravel.resume();
      await tick(20);
      flush();
      expect(log.at(-1)).toBe("3/user3");
      // The one hold left is the landing's own refetch (the known extra fetch).
      expect(holds.length).toBeLessThanOrEqual(1);
      expect(holds.every(ms => ms < 50)).toBe(true);
      expect(codes.filter(c => c !== "SILENT_HOLD")).toEqual([]);
    } finally {
      offs.forEach(off => off());
      release();
    }
  });

  it("an interaction whose write the view hid settles at the landing", async () => {
    const outcomes: string[] = [];
    const off = OBSERVE!.records.subscribe(
      "interaction",
      e => void outcomes.push(`${e.outcome}:${e.writes}`)
    );
    try {
      const [a, setA] = createSignal(1, { name: "a" });
      const [b, setB] = createSignal(1, { name: "b" });
      mount(show => show(() => `${a()}/${b()}`));
      setA(2);
      flush();
      timeTravel.view(-1);
      OBSERVE!.attribution.withInteraction({ type: "click", target: "button#b" }, () => setB(5));
      flush();
      await tick(10);
      flush();
      expect(outcomes).toEqual([]);
      timeTravel.resume();
      expect(outcomes).toEqual(["held:1"]);
    } finally {
      off();
    }
  });

  it("known gap: a click that only wrote a pinned node is recorded with no writes", () => {
    const outcomes: string[] = [];
    const off = OBSERVE!.records.subscribe(
      "interaction",
      e => void outcomes.push(`${e.outcome}:${e.writes}`)
    );
    try {
      const [a, setA] = createSignal(1, { name: "a" });
      mount(show => show(() => `${a()}`));
      setA(2);
      flush();
      timeTravel.view(-1);
      OBSERVE!.attribution.withInteraction({ type: "click", target: "button#a" }, () => setA(7));
      flush();
      expect(outcomes).toEqual(["idle:0"]);
      timeTravel.resume();
    } finally {
      off();
    }
  });
});
