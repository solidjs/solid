// The server side with no UI: the store, the job runner and the simulated
// model. Runs the source directly (Node strips the types), standing in for
// the two things the build provides: the `server-only` marker and the `~`
// alias.
//
//   pnpm check:server
//
// The last section runs this file twice more as child processes with
// CHAT_STORAGE=fs in a temp directory, to see what a restart does to a reply
// that was being written.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

process.env.CHAT_PACE ??= "5";

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

const db = await import("../src/server/db.ts");
const generations = await import("../src/server/generations.ts");
const { FAILURE_WORD } = await import("../src/server/model.ts");

const tick = ms => new Promise(resolve => setTimeout(resolve, ms));
const read = async iterable => (await iterable[Symbol.asyncIterator]().next()).value;
const message = id => read(db.watchMessage(id));
const until = async (test, what, ms = 4000) => {
  const deadline = Date.now() + ms;
  while (!(await test())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${what}`);
    await tick(10);
  }
};

const phase = process.env.CHECK_PHASE;
if (phase === "write") {
  // Start a slow reply and exit while it is being written.
  process.env.CHAT_PACE = "200";
  const { threadId, replyId } = await db.send(null, "restart001", "Tell me about signals");
  generations.start(threadId, replyId);
  await until(async () => (await message(replyId)).reasoning.length > 0, "the first words");
  await db.flushed();
  console.log(JSON.stringify({ threadId, replyId }));
  process.exit(0);
}
if (phase === "read") {
  const { threadId, replyId } = JSON.parse(process.env.CHECK_IDS);
  const reply = await message(replyId);
  assert.equal(reply.status, "failed", "the orphaned reply is failed, not generating");
  assert.match(reply.error, /restart/);
  assert.ok(reply.reasoning.length > 0, "what had arrived is kept");
  const [summary] = await read(db.watchThreads());
  assert.equal(summary.id, threadId);
  assert.equal(summary.generating, false);
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

// A watcher that counts, as an open render would hold.
const stop = new AbortController();
const counting = iterable => {
  const seen = [];
  (async () => {
    for await (const value of iterable) seen.push(value);
  })();
  return seen;
};

console.log("sending");
let threadId, replyId;
await check("the first prompt makes a thread, titled by its first line", async () => {
  ({ threadId, replyId } = await db.send(
    null,
    "prompt0001",
    "  What is a server component?\nmore  "
  ));
  const [summary] = await read(db.watchThreads());
  assert.equal(summary.title, "What is a server component?");
  assert.equal(summary.generating, true);
  const shape = await read(db.watchThread(threadId));
  assert.deepEqual(
    shape.messages.map(m => `${m.role}:${m.status}`),
    ["user:complete", "assistant:generating"]
  );
});
await check("a retried prompt id changes nothing and answers the same reply", async () => {
  const again = await db.send(threadId, "prompt0001", "What is a server component?");
  assert.deepEqual(again, { threadId, replyId, fresh: false });
  assert.equal((await read(db.watchThread(threadId))).messages.length, 2);
});
await check("a second prompt while a reply is being written is refused", async () => {
  await rejects(db.send(threadId, "prompt0002", "And another thing"), /Wait for the reply/);
});
await check("bad input is refused", async () => {
  await rejects(db.send(threadId, "prompt0003", "   "), /Nothing to send/);
  await rejects(db.send(threadId, "BAD ID", "hi"), /message id/);
  await rejects(db.send("nosuchthread", "prompt0004", "hi"), /no longer exists/);
});

console.log("generating");
await check(
  "a job writes the reply; tokens wake the message's watcher and not the thread's",
  async () => {
    const shapes = counting(db.watchThread(threadId, stop.signal));
    const writes = counting(db.watchMessage(replyId, stop.signal));
    const lists = counting(db.watchThreads(stop.signal));
    await tick(20);
    generations.start(threadId, replyId);
    await until(async () => (await message(replyId)).status === "complete", "the reply");
    await tick(20);
    const reply = await message(replyId);
    assert.match(reply.text, /server component/);
    assert.ok(reply.usage.tokens > 10 && reply.usage.seconds >= 0);
    assert.ok(writes.length > 5, `the message was written many times (${writes.length})`);
    for (let i = 1; i < writes.length; i++) {
      assert.ok(writes[i].text.startsWith(writes[i - 1].text), "each write extends the last");
    }
    assert.equal(shapes.length, 2, "the thread's shape changed once: generating to complete");
    assert.equal(lists.length, 2, "and so did the list of threads");
    assert.equal(generations.isRunning(replyId), false);
  }
);
await check("the model is given the conversation so far", async () => {
  assert.deepEqual(
    (await db.historyOf(threadId)).map(m => m.role),
    ["user", "assistant"]
  );
});
await check("reasoning is kept apart from the reply", async () => {
  const sent = await db.send(threadId, "prompt0005", "How do signals work?");
  generations.start(threadId, sent.replyId);
  await until(async () => (await message(sent.replyId)).status === "complete", "the reply");
  const reply = await message(sent.replyId);
  assert.match(reply.reasoning, /reactivity/);
  assert.match(reply.text, /createSignal/);
  assert.ok(!reply.text.includes(reply.reasoning.slice(0, 20)));
});

console.log("stopping and failing");
await check("stop keeps what had arrived and says so", async () => {
  process.env.CHAT_PACE = "40";
  const sent = await db.send(threadId, "prompt0006", "Tell me about closing the tab");
  generations.start(threadId, sent.replyId);
  await until(async () => (await message(sent.replyId)).text.length > 20, "some of the reply");
  generations.stop(sent.replyId);
  await until(async () => (await message(sent.replyId)).status !== "generating", "the stop");
  const reply = await message(sent.replyId);
  assert.equal(reply.status, "stopped");
  assert.ok(reply.text.length > 20 && reply.text.length < 400, "a partial reply");
  assert.equal(reply.error, undefined);
  process.env.CHAT_PACE = "5";
});
await check("a model failure keeps the partial reply and the reason", async () => {
  const sent = await db.send(threadId, "prompt0007", `Please ${FAILURE_WORD} now`);
  const quiet = console.error;
  console.error = () => {};
  generations.start(threadId, sent.replyId);
  await until(async () => (await message(sent.replyId)).status !== "generating", "the failure");
  console.error = quiet;
  const reply = await message(sent.replyId);
  assert.equal(reply.status, "failed");
  assert.match(reply.error, /crashed/);
  assert.ok(reply.text.length > 0);
});
await check("a failed reply is left out of what the model is given next", async () => {
  const history = await db.historyOf(threadId);
  assert.ok(!history.some(m => m.text.includes("simulated model") && m.role === "assistant"));
  assert.equal(history.at(-1).role, "user");
});
await check("the thread can be continued after a stop and a failure", async () => {
  const sent = await db.send(threadId, "prompt0008", "Carry on");
  assert.equal(sent.fresh, true);
  generations.start(threadId, sent.replyId);
  await until(async () => (await message(sent.replyId)).status === "complete", "the reply");
});

console.log("threads");
await check("a second thread sorts first once it is the latest", async () => {
  await tick(5);
  const other = await db.send(null, "prompt0009", "A different conversation");
  generations.start(other.threadId, other.replyId);
  const list = await read(db.watchThreads());
  assert.deepEqual(
    list.map(t => t.title),
    ["A different conversation", "What is a server component?"]
  );
  assert.equal(list[0].generating, true);
  await until(async () => (await message(other.replyId)).status === "complete", "the reply");
});

console.log("teardown");
await check("aborting ends parked watchers now", async () => {
  let ended = false;
  const done = (async () => {
    for await (const _ of db.watchThread(threadId, stop.signal));
    ended = true;
  })();
  await tick(20);
  stop.abort();
  await Promise.race([done, tick(200)]);
  assert.ok(ended);
});

console.log("restart (CHAT_STORAGE=fs)");
await check("a reply being written when the server stops is failed after it starts again", () => {
  const dir = mkdtempSync(join(tmpdir(), "chat-check-"));
  try {
    const run = (CHECK_PHASE, extra = {}) =>
      execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
        cwd: dir,
        env: { ...process.env, CHAT_STORAGE: "fs", CHECK_PHASE, ...extra },
        stdio: ["ignore", "pipe", "inherit"]
      }).toString();
    const ids = run("write").trim().split("\n").at(-1);
    assert.ok(existsSync(join(dir, ".data")), "wrote under .data/");
    run("read", { CHECK_IDS: ids });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`\n${passed} checks passed`);
process.exit(0);
