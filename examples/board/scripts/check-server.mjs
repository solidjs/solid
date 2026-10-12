// Step 2's check: the server module with no UI. Runs the source directly
// (Node strips the types), standing in for the two things the build
// provides: the `server-only` marker and the `~` alias.
//
//   pnpm check:server
//
// The last section runs this file twice more as child processes with
// BOARD_STORAGE=fs in a temp directory, to see a commit survive a restart.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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

const { between, byPos, isKey } = await import("../src/order.ts");
const db = await import("../src/server/db.ts");
const presence = await import("../src/server/presence.ts");

const phase = process.env.CHECK_PHASE;
if (phase === "write") {
  await db.createCard("restart1", "seeddone", "Survives a restart", between());
  await db.moveCard("clienta1", "mutrestart", "seedtodocard0", "seeddone", "z");
  await db.flushed();
  process.exit(0);
}
if (phase === "read") {
  const board = (await db.watchBoard("clienta1").next()).value;
  assert.ok(
    board.cards.some(c => c.id === "restart1"),
    "created card persisted"
  );
  assert.equal(
    board.cards.find(c => c.id === "seedtodocard0").listId,
    "seeddone",
    "move persisted"
  );
  assert.deepEqual(board.applied, ["mutrestart"], "applied ids persisted with the board");
  process.exit(0);
}

let passed = 0;
const check = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ok  ${name}`);
};
const rejects = (promise, pattern) =>
  assert.rejects(promise, err => err.name === "Rejected" && pattern.test(err.message));
const now = async client => (await db.watchBoard(client).next()).value;
let n = 0;
const mid = () => `mut${String(++n).padStart(5, "0")}`;
const A = "clienta1";
const B = "clientb1";

console.log("order");
await check("keys stay sorted and well-formed under random inserts", () => {
  for (let run = 0; run < 20; run++) {
    const keys = [];
    for (let i = 0; i < 400; i++) {
      // Biased toward the ends and toward one gap, the cases that grow keys.
      const r = Math.random();
      const at =
        r < 0.2
          ? 0
          : r < 0.4
            ? keys.length
            : r < 0.6
              ? Math.min(1, keys.length)
              : Math.floor(Math.random() * (keys.length + 1));
      const key = between(keys[at - 1], keys[at]);
      assert.ok(isKey(key), `well-formed: ${key}`);
      if (at > 0) assert.ok(keys[at - 1] < key, `${keys[at - 1]} < ${key}`);
      if (at < keys.length) assert.ok(key < keys[at], `${key} < ${keys[at]}`);
      keys.splice(at, 0, key);
    }
  }
});
await check("no room between equal keys is an error, and ties order by id", () => {
  assert.throws(() => between("V", "V"), RangeError);
  assert.throws(() => between("b", "a"), RangeError);
  const rows = [
    { id: "b", pos: "V" },
    { id: "a", pos: "V" },
    { id: "c", pos: "F" }
  ];
  assert.deepEqual(
    rows.sort(byPos).map(r => r.id),
    ["c", "a", "b"]
  );
});
await check("isKey refuses what between cannot produce", () => {
  for (const bad of ["", "V0", "a-b", "é", 3, null, "x".repeat(65)])
    assert.equal(isKey(bad), false);
});

console.log("board");
await check("first value is the seed, lists and cards in order, nothing acknowledged", async () => {
  const board = await now(null);
  assert.deepEqual(
    board.lists.map(l => l.title),
    ["To do", "Doing", "Done"]
  );
  assert.equal(board.cards.length, 4);
  assert.deepEqual(board.applied, []);
});

// One long-lived watcher per client, as two tabs would hold.
const stop = new AbortController();
const watch = client => {
  const seen = [];
  const done = (async () => {
    for await (const board of db.watchBoard(client, stop.signal)) seen.push(board);
  })();
  return { seen, done, last: () => seen.at(-1) };
};
const tabA = watch(A);
const tabB = watch(B);
const settle = () => new Promise(r => setTimeout(r, 5));
await settle();

await check("a create yields to every watcher, and its row is its acknowledgement", async () => {
  const before = tabA.seen.length;
  await db.createCard("cardnew1", "seeddoing", "  New card  ", between());
  await settle();
  assert.equal(tabA.seen.length, before + 1);
  for (const tab of [tabA, tabB]) {
    assert.equal(tab.last().cards.find(c => c.id === "cardnew1")?.title, "New card");
  }
  assert.deepEqual(tabA.last().applied, []);
});
await check("a retried create does nothing", async () => {
  const before = tabA.seen.length;
  await db.createCard("cardnew1", "seeddoing", "Again", between());
  await settle();
  assert.equal(tabA.seen.length, before);
});
await check(
  "a move lands with its id in the sender's applied, in the same value, and nobody else's",
  async () => {
    const m = mid();
    const before = tabA.seen.length;
    await db.moveCard(A, m, "seedtodocard0", "seeddone", between());
    await settle();
    assert.equal(tabA.seen.length, before + 1, "one yield carries both");
    const mine = tabA.last();
    assert.equal(mine.cards.find(c => c.id === "seedtodocard0").listId, "seeddone");
    assert.ok(mine.applied.includes(m));
    assert.equal(tabB.last().cards.find(c => c.id === "seedtodocard0").listId, "seeddone");
    assert.deepEqual(tabB.last().applied, []);
    assert.deepEqual((await now(null)).applied, []);
  }
);
await check("a retried mutation id does nothing", async () => {
  const m = mid();
  await db.renameCard(A, m, "cardnew1", "Renamed");
  await settle();
  const before = tabA.seen.length;
  await db.renameCard(A, m, "cardnew1", "Renamed twice");
  await settle();
  assert.equal(tabA.seen.length, before);
  assert.equal(tabA.last().cards.find(c => c.id === "cardnew1").title, "Renamed");
});
await check("ids applied out of order are each acknowledged", async () => {
  const first = mid();
  const second = mid();
  await db.renameList(A, second, "seeddone", "Finished");
  await settle();
  assert.ok(tabA.last().applied.includes(second) && !tabA.last().applied.includes(first));
  await db.renameList(A, first, "seedtodo", "Next");
  await settle();
  assert.ok(tabA.last().applied.includes(first) && tabA.last().applied.includes(second));
});
await check(
  "another tab overwriting the same card does not unacknowledge the first write",
  async () => {
    const mine = mid();
    await db.moveCard(A, mine, "cardnew1", "seedtodo", "z");
    await db.moveCard(B, mid(), "cardnew1", "seeddone", "z");
    await settle();
    assert.ok(tabA.last().applied.includes(mine));
    assert.equal(tabA.last().cards.find(c => c.id === "cardnew1").listId, "seeddone");
  }
);
await check(
  "a full list rejects a create and a move in, changes nothing, remembers nothing",
  async () => {
    await db.createList("listfull1", "Full", between("z"));
    let pos;
    for (let i = 0; i < db.LIST_LIMIT; i++) {
      await db.createCard(`fullcard${i}`, "listfull1", `Card ${i}`, (pos = between(pos)));
    }
    await settle();
    const before = tabA.seen.length;
    await rejects(db.createCard("fullcard9", "listfull1", "One too many", between(pos)), /is full/);
    const m = mid();
    await rejects(db.moveCard(A, m, "cardnew1", "listfull1", between(pos)), /is full/);
    await settle();
    assert.equal(tabA.seen.length, before, "no yield");
    assert.ok(!tabA.last().applied.includes(m));
    assert.equal(tabA.last().cards.filter(c => c.listId === "listfull1").length, db.LIST_LIMIT);
  }
);
await check("a reorder inside a full list is allowed", async () => {
  await db.moveCard(A, mid(), "fullcard0", "listfull1", "zz");
  await settle();
  assert.equal(
    tabA
      .last()
      .cards.filter(c => c.listId === "listfull1")
      .at(-1).id,
    "fullcard0"
  );
});
await check(
  "archiving a list takes its cards out of the value; moving into it is rejected",
  async () => {
    await db.archiveList(B, mid(), "listfull1");
    await settle();
    assert.ok(!tabA.last().lists.some(l => l.id === "listfull1"));
    assert.ok(!tabA.last().cards.some(c => c.listId === "listfull1"));
    await rejects(db.moveCard(A, mid(), "cardnew1", "listfull1", "V"), /archived/);
    await rejects(db.renameCard(A, mid(), "fullcard1", "Too late"), /archived/);
  }
);
await check("archiving what is already archived is acknowledged, not rejected", async () => {
  const m = mid();
  await db.archiveList(A, m, "listfull1");
  await settle();
  assert.ok(tabA.last().applied.includes(m));
});
await check("malformed input is rejected", async () => {
  await rejects(db.moveCard(A, mid(), "cardnew1", "seedtodo", "V0"), /position/);
  await rejects(db.renameCard(A, mid(), "cardnew1", "   "), /empty/);
  await rejects(db.renameCard("x", mid(), "cardnew1", "Hi"), /client id/);
  await rejects(db.createCard("BAD ID", "seedtodo", "Hi", "V"), /card id/);
});
await check(`applied keeps a client's last 32 ids`, async () => {
  const ids = [];
  for (let i = 0; i < 40; i++) {
    const m = mid();
    ids.push(m);
    await db.renameBoard(A, m, `Board ${i}`);
  }
  await settle();
  assert.deepEqual(tabA.last().applied, ids.slice(-32));
});

console.log("presence");
await check("join and leave yield; a late leave removes only what it joined", async () => {
  const seen = [];
  const end = new AbortController();
  const done = (async () => {
    for await (const members of presence.watchMembers(end.signal))
      seen.push(members.map(m => m.id));
  })();
  await settle();
  const leaveFirst = presence.join({ id: "tab1", name: "one" });
  await settle();
  const leaveSecond = presence.join({ id: "tab1", name: "one" }); // the reconnect
  await settle();
  leaveFirst(); // the dead connection's cleanup, arriving late
  await settle();
  assert.deepEqual(seen.at(-1), ["tab1"]);
  leaveSecond();
  await settle();
  assert.deepEqual(seen.at(-1), []);
  end.abort();
  await done;
});

console.log("teardown");
await check("aborting ends a parked watcher now", async () => {
  stop.abort();
  await Promise.race([
    Promise.all([tabA.done, tabB.done]),
    new Promise((_, reject) => setTimeout(() => reject(new Error("watcher still parked")), 200))
  ]);
});

console.log("restart (BOARD_STORAGE=fs)");
await check("a commit and its applied id survive a new process", () => {
  const dir = mkdtempSync(join(tmpdir(), "board-check-"));
  try {
    const run = CHECK_PHASE =>
      execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
        cwd: dir,
        env: { ...process.env, BOARD_STORAGE: "fs", CHECK_PHASE },
        stdio: "inherit"
      });
    run("write");
    assert.ok(existsSync(join(dir, ".data")), "wrote under .data/");
    run("read");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} checks passed`);
