import {
  createMemo,
  createRenderEffect,
  createRoot,
  createSignal,
  flush
} from "../../src/index.js";
import { OutputTree, checkAttachment } from "./output.js";
import { checkFrame } from "./rules.js";
import { HostTasks } from "./host.js";
import type { Scenario } from "./scenario.js";

const scalar: Scenario = {
  version: 1,
  show: true,
  nodes: [],
  turns: [],
  readers: [{ id: 0, refs: [-1], gated: false, boundary: "none" }]
};

test("only attachment publishes prepared values; premature attachment violates consistency", () => {
  const tree = new OutputTree(),
    root = tree.create(true);
  const old = tree.create(),
    prepared = tree.create();
  tree.write(old, [0]);
  tree.append(root, old);
  tree.write(prepared, [1]);
  const frame = () => ({ at: "probe", input: 0, show: true, outputs: { 0: tree.read(root) } });
  expect(checkFrame(scalar, frame())).toBeUndefined();
  expect(tree.privateWrites).toBe(2);
  tree.replace(root, prepared); // deliberately broken renderer
  expect(checkFrame(scalar, frame())?.rule).toBe("S1");
});

test("visible cleanup is observable; detached cleanup and same-flush replacement are harmless", () => {
  const tree = new OutputTree(),
    root = tree.create(true);
  const old = tree.create(),
    discarded = tree.create(),
    replacement = tree.create();
  tree.write(old, [0]);
  tree.append(root, old);
  tree.write(discarded, [1]);
  tree.append(tree.create(), discarded);
  tree.detach(discarded);
  tree.read(root);
  expect(checkAttachment(0, tree.count, true, true)).toBeUndefined();

  tree.detach(old); // deliberately early cleanup, sampled at a host checkpoint
  tree.read(root);
  expect(checkAttachment(0, tree.count, true, true)?.rule).toBe("A1");
  tree.write(replacement, [1]);
  tree.append(root, replacement);
  tree.read(root); // cleanup + replacement inside one flush is allowed
  expect(checkAttachment(0, tree.count, true, true)).toBeUndefined();
  expect(checkAttachment(0, tree.count, true, false)?.rule).toBe("A1");
  tree.clear(root);
  tree.read(root);
  expect(checkAttachment(0, tree.count, true, false)).toBeUndefined();
  expect(checkAttachment(0, tree.count, false, true)).toBeUndefined();
});

test("portal visibility follows its destination, independently of the detached logical owner", () => {
  const tree = new OutputTree(),
    root = tree.create(true),
    logical = tree.create();
  const target = tree.create(),
    child = tree.create();
  tree.write(child, [1]);
  tree.append(target, child);
  expect(tree.read(target)).toBe("absent");
  tree.append(root, target);
  expect(tree.visible(logical)).toBe(false);
  expect(tree.read(target)).toEqual([1]);
  tree.detach(child);
  tree.read(target);
  expect(checkAttachment(0, tree.count, true, true)?.rule).toBe("A1");
});

test("duplicate contributions, moves and stale cleanup keep exact host identity", () => {
  const tree = new OutputTree(),
    root = tree.create(true),
    other = tree.create(true);
  const a = tree.create(),
    b = tree.create();
  tree.write(a, [0]);
  tree.write(b, [0]);
  tree.append(root, a);
  tree.append(root, b);
  tree.read(root);
  expect(checkAttachment(0, tree.count, true, true)?.message).toContain("duplicate");
  tree.append(other, a);
  tree.detach(a);
  tree.detach(a);
  expect(tree.read(root)).toEqual([0]);
  expect(tree.count).toBe(1);
  expect(tree.read(other)).toBe("absent");
  expect(() => tree.append(b, b)).toThrow("Cyclic");
});

test("default nested effects can prepare fresh content while a scheduled parent is held", async () => {
  const host = new HostTasks(),
    tree = new OutputTree(),
    root = tree.create(true);
  const requests: Array<() => void> = [];
  let set!: (v: number) => void, dispose!: () => void;
  createRoot(d => {
    dispose = d;
    const [value, write] = createSignal(0);
    set = write;
    const slow = createMemo(() => {
      const v = value();
      return new Promise<number>(resolve => requests.push(() => resolve(v)));
    });
    createRenderEffect(
      () => {
        const v = value(),
          cell = tree.create();
        createRenderEffect(
          () => v,
          next => tree.write(cell, [next])
        );
        createRenderEffect(slow, () => {});
        return cell;
      },
      cell => tree.replace(root, cell),
      { schedule: true }
    );
  });
  try {
    flush();
    requests.shift()!();
    await host.drain();
    expect(tree.read(root)).toEqual([0]);
    set(1);
    flush();
    expect(tree.privateWrites).toBe(2);
    expect(tree.read(root)).toEqual([0]);
    requests.shift()!();
    await host.drain();
    expect(tree.read(root)).toEqual([1]);
  } finally {
    dispose();
    flush();
    host.close();
  }
});
