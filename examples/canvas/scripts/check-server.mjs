// The server module with no UI. Runs the source directly (Node strips the
// types), standing in for the two things the build provides: the
// `server-only` marker and the `~` alias.
//
//   pnpm check:server
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";

const src = new URL("../src/", import.meta.url);
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "server-only") return { url: "data:text/javascript,", shortCircuit: true };
    if (specifier.startsWith("~/")) specifier = new URL(specifier.slice(2), src).href;
    if (/^(\.|file:)/.test(specifier) && !/\.[a-z]+$/.test(specifier)) {
      const base = specifier.startsWith("file:")
        ? specifier
        : new URL(specifier, context.parentURL).href;
      if (existsSync(fileURLToPath(base + ".ts"))) specifier = base + ".ts";
    }
    return next(specifier, context);
  }
});

const room = await import("../src/server/room.ts");

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const rejects = (fn, pattern) =>
  assert.throws(fn, err => err.name === "Rejected" && pattern.test(err.message));
const frame = () => new Promise(r => setTimeout(r, 40));
let n = 0;
const mid = () => `mut${String(++n).padStart(5, "0")}`;

// One long-lived watcher, as the broadcast holds.
const stop = new AbortController();
const seen = [];
const watching = (async () => {
  for await (const value of room.watchRoom(stop.signal)) seen.push(value);
})();
const last = () => seen.at(-1);
const shape = id => last().shapes.find(s => s.id === id);
await frame();

console.log("room");
await check("first value is the seed, nothing applied, nobody pointing", () => {
  assert.deepEqual(
    last().shapes.map(s => s.id),
    ["seedrect1", "seedcirc1", "seednote1"]
  );
  assert.deepEqual(last().applied, []);
  assert.deepEqual(last().pointers, []);
});
await check("a create lands, and its retry does nothing", async () => {
  room.createShape("shape001", "note", 10, 20, "#579dff");
  await frame();
  assert.deepEqual(shape("shape001"), {
    id: "shape001",
    kind: "note",
    x: 10,
    y: 20,
    w: 200,
    h: 130,
    color: "#579dff",
    text: ""
  });
  const before = seen.length;
  room.createShape("shape001", "rect", 99, 99, "#f87168");
  await frame();
  assert.equal(seen.length, before);
});
await check("unchanged shapes are the same objects in the next value", async () => {
  const before = last();
  room.recolorShape(mid(), "seedcirc1", "#4bce97");
  await frame();
  assert.equal(
    shape("seedrect1"),
    before.shapes.find(s => s.id === "seedrect1")
  );
  assert.notEqual(
    shape("seedcirc1"),
    before.shapes.find(s => s.id === "seedcirc1")
  );
});
await check(
  "a move lands with its id in applied, comes to the top, and a retry does nothing",
  async () => {
    const m = mid();
    room.moveShape(m, "seedrect1", 300, 400);
    await frame();
    assert.ok(last().applied.includes(m));
    assert.equal(last().shapes.at(-1).id, "seedrect1");
    assert.deepEqual([shape("seedrect1").x, shape("seedrect1").y], [300, 400]);
    const before = seen.length;
    room.moveShape(m, "seedrect1", 0, 0);
    await frame();
    assert.equal(seen.length, before);
  }
);
await check("refusals change nothing and remember nothing", async () => {
  const before = seen.length;
  const m = mid();
  rejects(() => room.moveShape(m, "nosuchshape", 1, 1), /deleted/);
  rejects(() => room.writeNote(mid(), "seedrect1", "hi"), /Only a note/);
  rejects(() => room.recolorShape(mid(), "seedrect1", "red"), /color/);
  rejects(() => room.createShape("BAD ID", "rect", 1, 1, "#579dff"), /shape id/);
  rejects(() => room.createShape("shape002", "star", 1, 1, "#579dff"), /kind/);
  rejects(() => room.moveShape("x", "seedrect1", 1, 1), /mutation id/);
  await frame();
  assert.equal(seen.length, before);
  assert.ok(!last().applied.includes(m));
});
await check("deleting what is already deleted is acknowledged", async () => {
  room.deleteShape(mid(), "seedcirc1");
  const m = mid();
  room.deleteShape(m, "seedcirc1");
  await frame();
  assert.ok(!shape("seedcirc1"));
  assert.ok(last().applied.includes(m));
});
await check("the canvas holds at most SHAPE_LIMIT shapes", async () => {
  for (let i = last().shapes.length; i < room.SHAPE_LIMIT; i++)
    room.createShape(`fill${String(i).padStart(4, "0")}`, "rect", i, i, "#579dff");
  rejects(() => room.createShape("onetoomany", "rect", 0, 0, "#579dff"), /is full/);
  await frame();
  assert.equal(last().shapes.length, room.SHAPE_LIMIT);
  for (const s of last().shapes.filter(s => s.id.startsWith("fill"))) room.deleteShape(mid(), s.id);
  await frame();
});
await check(`applied keeps the room's last 64 ids`, async () => {
  const ids = [];
  for (let i = 0; i < 70; i++) {
    const m = mid();
    ids.push(m);
    room.writeNote(m, "seednote1", `Note ${i}`);
  }
  await frame();
  assert.deepEqual(last().applied, ids.slice(-64));
});

console.log("pointers");
const leaveA = room.join({ id: "taba1", name: "one" });
const leaveB = room.join({ id: "tabb1", name: "two" });
await check("only a present member's pointer shows", async () => {
  room.point("nobody1", 1, 2, 3);
  room.point("taba1", 10.4, 20.6, 5);
  await frame();
  assert.deepEqual(last().pointers, [{ id: "taba1", name: "one", x: 10, y: 21, t: 5 }]);
});
await check("many positions inside one frame are sent as one value with the latest", async () => {
  const before = seen.length;
  for (let i = 0; i < 50; i++) room.point("taba1", i, i, i);
  await frame();
  assert.ok(seen.length - before <= 2, `${seen.length - before} values`);
  assert.equal(last().pointers.find(p => p.id === "taba1").x, 49);
});
await check("a drag shows on the pointer, and a position without one keeps it", async () => {
  room.point("taba1", 50, 50, 6, { id: "seednote1", key: "dragkey1", x: 40, y: 45 });
  await frame();
  assert.deepEqual(last().pointers.find(p => p.id === "taba1").drag, {
    id: "seednote1",
    key: "dragkey1",
    x: 40,
    y: 45
  });
  room.point("taba1", 60, 60, 7);
  await frame();
  assert.equal(last().pointers.find(p => p.id === "taba1").drag.key, "dragkey1");
});
await check("the move that ends a drag lands in the same value that ends it", async () => {
  const before = seen.length;
  room.moveShape("dragkey1", "seednote1", 70, 75);
  await frame();
  const after = seen.slice(before);
  // No value shows the shape moved with the drag still held, or the drag
  // gone with the shape not yet moved.
  for (const value of after) {
    const moved = value.shapes.find(s => s.id === "seednote1").x === 70;
    const held = !!value.pointers.find(p => p.id === "taba1").drag;
    assert.notEqual(moved, held);
  }
  assert.ok(!last().pointers.find(p => p.id === "taba1").drag);
});
await check("a late position for an ended drag only moves the pointer", async () => {
  room.point("taba1", 80, 80, 8, { id: "seednote1", key: "dragkey1", x: 10, y: 10 });
  await frame();
  const pointer = last().pointers.find(p => p.id === "taba1");
  assert.equal(pointer.x, 80);
  assert.ok(!pointer.drag);
});
await check("a drag let go without a move ends, and the shape stays put", async () => {
  room.point("tabb1", 5, 5, 9, { id: "seednote1", key: "dragkey2", x: 500, y: 500 });
  await frame();
  room.drop("tabb1", "dragkey2");
  await frame();
  assert.ok(!last().pointers.find(p => p.id === "tabb1").drag);
  assert.equal(shape("seednote1").x, 70);
});
await check("leaving takes the pointer, and what it was dragging", async () => {
  room.point("tabb1", 5, 5, 10, { id: "seednote1", key: "dragkey3", x: 1, y: 1 });
  await frame();
  leaveB();
  await frame();
  assert.ok(!last().pointers.some(p => p.id === "tabb1"));
  leaveA();
  await frame();
  assert.deepEqual(last().pointers, []);
});

console.log("presence");
await check("join and leave yield; a late leave removes only what it joined", async () => {
  const members = [];
  const end = new AbortController();
  const done = (async () => {
    for await (const value of room.watchMembers(end.signal)) members.push(value.map(m => m.id));
  })();
  await frame();
  const leaveFirst = room.join({ id: "tab1", name: "one" });
  const leaveSecond = room.join({ id: "tab1", name: "one" }); // the reconnect
  leaveFirst(); // the dead connection's cleanup, arriving late
  await frame();
  assert.deepEqual(members.at(-1), ["tab1"]);
  leaveSecond();
  await frame();
  assert.deepEqual(members.at(-1), []);
  end.abort();
  await done;
});

console.log("teardown");
await check("aborting ends a parked watcher now", async () => {
  stop.abort();
  await Promise.race([
    watching,
    new Promise((_, reject) => setTimeout(() => reject(new Error("watcher still parked")), 200))
  ]);
});

console.log(`\n${passed} checks passed`);
