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

process.env.CANVAS_SEATS = "3";
process.env.CANVAS_ADMIN_KEY = "hostkey";
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

// The host takes the first seat; the writes below are its.
const S = room.join({ id: "host0001", name: "host" }).entry.seat;

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
  room.createShape(S, "shape001", "note", 10, 20, "#579dff");
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
  room.createShape(S, "shape001", "rect", 99, 99, "#f87168");
  await frame();
  assert.equal(seen.length, before);
});
await check("unchanged shapes are the same objects in the next value", async () => {
  const before = last();
  room.recolorShape(S, mid(), "seedcirc1", "#4bce97");
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
    room.moveShape(S, m, "seedrect1", 300, 400);
    await frame();
    assert.ok(last().applied.includes(m));
    assert.equal(last().shapes.at(-1).id, "seedrect1");
    assert.deepEqual([shape("seedrect1").x, shape("seedrect1").y], [300, 400]);
    const before = seen.length;
    room.moveShape(S, m, "seedrect1", 0, 0);
    await frame();
    assert.equal(seen.length, before);
  }
);
await check("refusals change nothing and remember nothing", async () => {
  const before = seen.length;
  const m = mid();
  rejects(() => room.moveShape(S, m, "nosuchshape", 1, 1), /deleted/);
  rejects(() => room.writeNote(S, mid(), "seedrect1", "hi"), /Only a note/);
  rejects(() => room.recolorShape(S, mid(), "seedrect1", "red"), /color/);
  rejects(() => room.createShape(S, "BAD ID", "rect", 1, 1, "#579dff"), /shape id/);
  rejects(() => room.createShape(S, "shape002", "star", 1, 1, "#579dff"), /kind/);
  rejects(() => room.moveShape(S, "x", "seedrect1", 1, 1), /mutation id/);
  rejects(() => room.createShape("noseat", "shape009", "rect", 1, 1, "#579dff"), /watching/);
  await frame();
  assert.equal(seen.length, before);
  assert.ok(!last().applied.includes(m));
});
await check("deleting what is already deleted is acknowledged", async () => {
  room.deleteShape(S, mid(), "seedcirc1");
  const m = mid();
  room.deleteShape(S, m, "seedcirc1");
  await frame();
  assert.ok(!shape("seedcirc1"));
  assert.ok(last().applied.includes(m));
});
await check("the canvas holds at most SHAPE_LIMIT shapes", async () => {
  for (let i = last().shapes.length; i < room.SHAPE_LIMIT; i++)
    room.createShape(S, `fill${String(i).padStart(4, "0")}`, "rect", i, i, "#579dff");
  rejects(() => room.createShape(S, "onetoomany", "rect", 0, 0, "#579dff"), /is full/);
  await frame();
  assert.equal(last().shapes.length, room.SHAPE_LIMIT);
  for (const s of last().shapes.filter(s => s.id.startsWith("fill")))
    room.deleteShape(S, mid(), s.id);
  await frame();
});
await check(`applied keeps the room's last 64 ids`, async () => {
  const ids = [];
  for (let i = 0; i < 70; i++) {
    const m = mid();
    ids.push(m);
    room.writeNote(S, m, "seednote1", `Note ${i}`);
  }
  await frame();
  assert.deepEqual(last().applied, ids.slice(-64));
});

console.log("pointers");
const tabA = room.join({ id: "taba1", name: "one" });
const tabB = room.join({ id: "tabb1", name: "two" });
const [A, B] = [tabA.entry.seat, tabB.entry.seat];
const leaveA = tabA.leave;
const leaveB = tabB.leave;
await check("only a present member's pointer shows", async () => {
  room.point("nobody1", 1, 2, 3);
  room.point(A, 10.4, 20.6, 5);
  await frame();
  assert.deepEqual(last().pointers, [{ id: "taba1", name: "one", x: 10, y: 21, t: 5 }]);
});
await check("many positions inside one frame are sent as one value with the latest", async () => {
  const before = seen.length;
  for (let i = 0; i < 50; i++) room.point(A, i, i, i);
  await frame();
  assert.ok(seen.length - before <= 2, `${seen.length - before} values`);
  assert.equal(last().pointers.find(p => p.id === "taba1").x, 49);
});
await check("a drag shows on the pointer, and a position without one keeps it", async () => {
  room.point(A, 50, 50, 6, { id: "seednote1", key: "dragkey1", x: 40, y: 45 });
  await frame();
  assert.deepEqual(last().pointers.find(p => p.id === "taba1").drag, {
    id: "seednote1",
    key: "dragkey1",
    x: 40,
    y: 45
  });
  room.point(A, 60, 60, 7);
  await frame();
  assert.equal(last().pointers.find(p => p.id === "taba1").drag.key, "dragkey1");
});
await check("the move that ends a drag lands in the same value that ends it", async () => {
  const before = seen.length;
  room.moveShape(S, "dragkey1", "seednote1", 70, 75);
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
  room.point(A, 80, 80, 8, { id: "seednote1", key: "dragkey1", x: 10, y: 10 });
  await frame();
  const pointer = last().pointers.find(p => p.id === "taba1");
  assert.equal(pointer.x, 80);
  assert.ok(!pointer.drag);
});
await check("a drag let go without a move ends, and the shape stays put", async () => {
  room.point(B, 5, 5, 9, { id: "seednote1", key: "dragkey2", x: 500, y: 500 });
  await frame();
  room.drop("dragkey2");
  await frame();
  assert.ok(!last().pointers.find(p => p.id === "tabb1").drag);
  assert.equal(shape("seednote1").x, 70);
});
await check("a refused drop still ends its drag", async () => {
  room.point(B, 5, 5, 11, { id: "seednote1", key: "dragkey4", x: 9, y: 9 });
  room.deleteShape(S, mid(), "seednote1");
  rejects(() => room.moveShape(S, "dragkey4", "seednote1", 9, 9), /deleted/);
  await frame();
  assert.ok(!last().pointers.find(p => p.id === "tabb1").drag);
});

console.log("strokes");
const inkOf = id => last().pointers.find(p => p.id === id).ink;
await check("a full chunk of a stroke is the same object in every later value", async () => {
  const send = (from, points) =>
    room.point(A, 0, 0, 12, undefined, { key: "strokech", color: "#f87168", from, points });
  for (let i = 0; i < 40; i++) send(i, [i, i]);
  await frame();
  const full = inkOf("taba1").chunks[0];
  assert.equal(full.length, 64);
  assert.deepEqual(
    inkOf("taba1").chunks[1],
    [32, 32, 33, 33, 34, 34, 35, 35, 36, 36, 37, 37, 38, 38, 39, 39]
  );
  send(40, [40, 40]);
  await frame();
  assert.equal(inkOf("taba1").chunks[0], full);
  assert.equal(inkOf("taba1").chunks[1].length, 18);
  room.drop("strokech");
});
await check("a stroke's points arrive a frame at a time", async () => {
  room.point(A, 0, 0, 12, undefined, {
    key: "stroke01",
    color: "#f87168",
    from: 0,
    points: [10, 10, 20, 15]
  });
  await frame();
  const first = inkOf("taba1");
  assert.deepEqual(first, { key: "stroke01", color: "#f87168", chunks: [[10, 10, 20, 15]] });
  room.point(A, 0, 0, 13, undefined, {
    key: "stroke01",
    color: "#f87168",
    from: 2,
    points: [30, 25]
  });
  await frame();
  assert.deepEqual(inkOf("taba1").chunks, [[10, 10, 20, 15, 30, 25]]);
});
await check("points sent again are not added twice, and a gap waits for the resend", async () => {
  room.point(A, 0, 0, 14, undefined, {
    key: "stroke01",
    color: "#f87168",
    from: 2,
    points: [30, 25, 40, 30]
  });
  room.point(A, 0, 0, 15, undefined, {
    key: "stroke01",
    color: "#f87168",
    from: 9,
    points: [99, 99]
  });
  await frame();
  assert.deepEqual(inkOf("taba1").chunks.flat(), [10, 10, 20, 15, 30, 25, 40, 30]);
});
await check("a position without ink keeps the stroke", async () => {
  room.point(A, 50, 50, 16);
  await frame();
  assert.equal(inkOf("taba1").key, "stroke01");
});
await check("the stroke lands in the same value that ends its ink", async () => {
  const before = seen.length;
  room.createStroke(S, "stroke01", "#f87168", [10, 10, 20, 15, 30, 25, 40, 30]);
  await frame();
  for (const value of seen.slice(before)) {
    const landed = value.shapes.some(s => s.id === "stroke01");
    const drawing = !!value.pointers.find(p => p.id === "taba1").ink;
    assert.notEqual(landed, drawing);
  }
  assert.deepEqual(shape("stroke01"), {
    id: "stroke01",
    kind: "stroke",
    x: 10,
    y: 10,
    w: 30,
    h: 20,
    color: "#f87168",
    text: "",
    points: [0, 0, 10, 5, 20, 15, 30, 20]
  });
  room.point(A, 0, 0, 17, undefined, {
    key: "stroke01",
    color: "#f87168",
    from: 4,
    points: [1, 1]
  });
  await frame();
  assert.ok(!inkOf("taba1"), "a late piece of a landed stroke draws nothing");
});
await check("a stroke let go without landing ends; bad strokes are refused", async () => {
  room.point(A, 0, 0, 18, undefined, {
    key: "stroke02",
    color: "#579dff",
    from: 0,
    points: [1, 1, 2, 2]
  });
  await frame();
  room.drop("stroke02");
  await frame();
  assert.ok(!inkOf("taba1"));
  rejects(() => room.createStroke(S, "stroke03", "#579dff", [1, 1]), /Bad stroke/);
  rejects(() => room.createStroke(S, "stroke03", "#579dff", [1, 1, 2]), /Bad stroke/);
  rejects(() => room.createStroke(S, "stroke03", "#579dff", new Array(4002).fill(1)), /Bad stroke/);
});
await check("leaving takes the pointer, and what it was drawing", async () => {
  room.point(A, 0, 0, 19, undefined, {
    key: "stroke04",
    color: "#579dff",
    from: 0,
    points: [1, 1, 2, 2]
  });
  await frame();
  leaveA();
  await frame();
  assert.ok(!last().pointers.some(p => p.id === "taba1"));
});

await check("leaving takes the pointer, and what it was dragging", async () => {
  room.point(B, 5, 5, 10, { id: "seednote1", key: "dragkey3", x: 1, y: 1 });
  await frame();
  leaveB();
  await frame();
  assert.deepEqual(last().pointers, []);
});

console.log("presence");
await check(
  "join and leave reach the room's value; a late leave removes only what it joined",
  async () => {
    const ids = () => last().members.map(m => m.id);
    const first = room.join({ id: "tab1", name: "one" });
    const second = room.join({ id: "tab1", name: "one" }); // the reconnect
    first.leave(); // the dead connection's cleanup, arriving late
    await frame();
    assert.deepEqual(ids(), ["host0001", "tab1"]);
    second.leave();
    await frame();
    assert.deepEqual(ids(), ["host0001"]);
  }
);
await check("the member list is the same array until someone joins or leaves", async () => {
  const before = last().members;
  room.point(S, 3, 3, 1);
  await frame();
  assert.equal(last().members, before);
});
await check(
  "past the seats people watch, and a freed seat goes to whoever waited longest",
  async () => {
    const two = room.join({ id: "seat2", name: "two" });
    const three = room.join({ id: "seat3", name: "three" });
    const four = room.join({ id: "seat4", name: "four" });
    const five = room.join({ id: "seat5", name: "five" });
    assert.ok(two.entry.seat && three.entry.seat, "seats 2 and 3 of 3");
    assert.equal(four.entry.seat, null);
    assert.equal(five.entry.seat, null);
    // A watcher's stream carries no token, and its pointer and writes do nothing.
    const end = new AbortController();
    const told = [];
    const done = (async () => {
      for await (const value of room.watchSeat(four.entry, end.signal)) told.push(value);
    })();
    await frame();
    assert.equal(told.at(-1).seat, null);
    assert.deepEqual(
      last().members.map(m => [m.id, m.seated]),
      [
        ["host0001", true],
        ["seat2", true],
        ["seat3", true],
        ["seat4", false],
        ["seat5", false]
      ]
    );
    assert.ok(!JSON.stringify(last()).includes(two.entry.seat), "no token in the list");
    rejects(() => room.createShape(null, "shape010", "rect", 1, 1, "#579dff"), /watching/);
    two.leave();
    await frame();
    assert.equal(typeof told.at(-1).seat, "string", "four, who waited longest, is told its token");
    assert.equal(five.entry.seat, null);
    room.point(told.at(-1).seat, 7, 7, 1);
    await frame();
    assert.ok(last().pointers.some(p => p.id === "seat4"));
    // A reconnect keeps its seat even with someone waiting.
    const again = room.join({ id: "seat3", name: "three" });
    assert.equal(again.entry.seat, three.entry.seat);
    three.leave(); // the dead connection, late: nothing changes
    assert.equal(five.entry.seat, null);
    end.abort();
    await done;
    for (const left of [again, four, five]) left.leave();
  }
);

console.log("reset");
await check("only the host's key clears the room", async () => {
  assert.ok(last().shapes.length > 0);
  assert.equal(room.clear("wrong"), false);
  assert.equal(room.clear(""), false);
  await frame();
  assert.ok(last().shapes.length > 0);
  assert.equal(room.clear("hostkey"), true);
  await frame();
  assert.deepEqual(last().shapes, []);
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
