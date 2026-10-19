/**
 * @jsxImportSource @solidjs/web
 *
 * Conditional reconnect (Stage 8 B4, RFC 11 §9.5 Server face 2): a frame
 * render given the client's have-list emits only what the client lacks or
 * holds differently — the root is skipped when its skeleton digest matches,
 * a fragment the list names is skipped in favor of the holes inside it that
 * moved, a fragment the list lacks (the client shows its fallback) streams
 * as it settles, and a hole still pending is never emitted. Every content
 * chunk carries the digest the client ledgers it under.
 */
import { describe, expect, it } from "vitest";
import { createMemo } from "solid-js";
import { Loading } from "@solidjs/web";
import { renderServerComponent, frameSkeleton } from "../../frames/src/frame-sink.js";
import { textDigest } from "../../server-functions/src/shared.js";
import { record, records, writes, writesSegment } from "./wire.js";

const tick = (ms = 5) => new Promise(r => setTimeout(r, ms));

function consume(stream: any) {
  const chunks: any[] = [];
  const waiters: { test: (c: any) => boolean; resolve: () => void }[] = [];
  const done = new Promise<void>(res =>
    stream.pipe({
      write: (c: any) => {
        chunks.push(c);
        for (let i = waiters.length - 1; i >= 0; i--) {
          if (waiters[i].test(c)) waiters.splice(i, 1)[0].resolve();
        }
      },
      end: res
    })
  );
  const until = (test: (c: any) => boolean) => {
    if (chunks.some(test)) return Promise.resolve();
    return new Promise<void>(resolve => waiters.push({ test, resolve }));
  };
  return { chunks, until, done };
}

function channel<T>() {
  const queue: T[] = [];
  let notify: (() => void) | null = null;
  let done = false;
  const wake = () => {
    notify?.();
    notify = null;
  };
  return {
    push(v: T) {
      queue.push(v);
      wake();
    },
    end() {
      done = true;
      wake();
    },
    iterable: {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<T>> {
            while (queue.length === 0) {
              if (done) return { value: undefined as any, done: true };
              await new Promise<void>(r => (notify = r));
            }
            return { value: queue.shift()!, done: false };
          }
        };
      }
    } as AsyncIterable<T>
  };
}

/**
 * The component under test: one live hole in the root (`title`), one
 * inside a `Loading` boundary fed by an async iterable (`body`), a static
 * class that flips the skeleton when `wide` is set.
 */
function makeComponent(title: string, body: AsyncIterable<string>, wide = false) {
  return () => {
    const t = createMemo(() => title);
    const b = createMemo(() => body);
    return (
      <article class={wide ? "wide" : "narrow"}>
        <h1>{t()}</h1>
        <Loading fallback={<p class="fb">loading</p>}>
          <p class="body">{b()}</p>
        </Loading>
      </article>
    );
  };
}

/** Render to completion after one body yield; returns the chunks. */
async function renderOnce(title: string, bodyText: string, options: any = {}, wide = false) {
  const ch = channel<string>();
  const { chunks, until, done } = consume(
    renderServerComponent(makeComponent(title, ch.iterable, wide), {
      frame: { id: "f" },
      ...options
    })
  );
  await tick();
  ch.push(bodyText);
  // A conditional render may emit nothing for the yield, so there is no
  // chunk to sequence on: let the settle land, then end the source.
  await tick(20);
  ch.end();
  await done;
  return chunks;
}

/** What the client's ledger holds after applying a full render's records. */
function haveFrom(chunks: any[]) {
  const have: Record<string, string> = {};
  for (const c of chunks) {
    if (!c.r || c.id !== "f") continue;
    for (const key in c.r) {
      const r = c.r[key];
      // The ledger keys a segment by its fragment key, a hole by its own.
      const ledger =
        key === ""
          ? ""
          : /^seg:[^:]+$/.test(key)
            ? key.slice(4)
            : /^hole:lh:\d+$/.test(key)
              ? key.slice(5)
              : undefined;
      if (ledger === undefined || !r || r.kind !== "html") continue;
      have[ledger] = r.digest;
      Object.assign(have, r.holes);
    }
  }
  return have;
}

const types = (chunks: any[]) => chunks.map(writes);
/** The `[key, record]` of the message's one content record (root, segment or hole). */
const only = (c: any) => {
  const keys = Object.keys(c.r).filter(
    k => k === "" || /^seg:[^:]+$/.test(k) || /^hole:lh:\d+$/.test(k)
  );
  expect(keys).toHaveLength(1);
  return [keys[0], c.r[keys[0]]] as [string, any];
};
/** The boundary's fragment key, from the message writing its content. */
const segmentKey = (chunks: any[]) => only(chunks.find(writesSegment))[0].slice(4);
/** A full render: the shell's root, the boundary's segment with its
 *  (eager) reveal in one batch, the end. */
const fullRender = (chunks: any[]) => {
  const k = segmentKey(chunks);
  return ["start", "", `seg:${k} seg:${k}:reveal`, ":complete"];
};

describe("conditional reconnect: digests on every emission", () => {
  it("root, segment and hole records carry digests and the holes inside them", async () => {
    const chunks = await renderOnce("T1", "B1");
    const html = record(chunks, "");
    expect(html.digest).toBe(textDigest(frameSkeleton(html.value)));
    // The root's hole map names the title hole with the digest of its
    // marker-free html; the body hole is inside the pending fragment, so
    // it is not the root's to name. (Ids follow mint order: the boundary's
    // children evaluate — and escalate — before the article's own holes
    // resolve, so the body is `lh:0` and the title `lh:1`.)
    expect(html.holes).toEqual({ "lh:1": textDigest("T1") });
    const [, fragment] = only(chunks.find(writesSegment));
    expect(fragment.digest).toBe(textDigest(fragment.value));
    expect(fragment.value).toMatch(/<!--lh:0-->B1<!--lh:\/0-->/);
    expect(fragment.holes).toEqual({ "lh:0": textDigest("B1") });
    expect(types(chunks)).toEqual(fullRender(chunks));
  });

  it("a live re-emission mid-response carries its digest", async () => {
    const ch = channel<string>();
    const { chunks, until, done } = consume(
      renderServerComponent(makeComponent("T1", ch.iterable), { frame: { id: "f" } })
    );
    await tick();
    ch.push("B1");
    await until(writesSegment);
    ch.push("B2");
    await until(c => records([c], "hole:").length > 0);
    ch.end();
    await done;
    const [[key, hole]] = records(chunks, "hole:");
    expect(key).toBe("hole:lh:0");
    expect(hole.value).toBe("B2");
    expect(hole.digest).toBe(textDigest("B2"));
  });
});

describe("conditional reconnect: the resume render", () => {
  it("a no-op reconnect transfers nothing", async () => {
    const have = haveFrom(await renderOnce("T1", "B1"));
    const chunks = await renderOnce("T1", "B1", { resume: { have } });
    expect(types(chunks)).toEqual(["start", ":complete"]);
  });

  it("a changed root hole transfers exactly that hole, no root", async () => {
    const have = haveFrom(await renderOnce("T1", "B1"));
    const chunks = await renderOnce("T2", "B1", { resume: { have } });
    expect(types(chunks)).toEqual(["start", "hole:lh:1", ":complete"]);
    const hole = chunks[1].r["hole:lh:1"];
    expect(hole.value).toBe("T2");
    expect(hole.digest).toBe(textDigest("T2"));
  });

  it("a changed hole inside a revealed fragment transfers the hole, not the fragment", async () => {
    const have = haveFrom(await renderOnce("T1", "B1"));
    const chunks = await renderOnce("T1", "B2", { resume: { have } });
    expect(types(chunks)).toEqual(["start", "hole:lh:0", ":complete"]);
    expect(record(chunks, "hole:lh:0").value).toBe("B2");
    // The ledger the client keeps from this stream names the new value.
    expect(haveFrom(chunks)["lh:0"]).toBe(textDigest("B2"));
  });

  it("a fragment the client shows as a fallback streams when it settles", async () => {
    const full = await renderOnce("T1", "B1");
    const have = haveFrom(full);
    const fragmentKey = segmentKey(full);
    // The client's ledger without the fragment: it holds the root (the
    // fallback is part of the skeleton) and the root's holes, nothing for
    // the boundary's content.
    delete have[fragmentKey];
    delete have["lh:0"];
    const chunks = await renderOnce("T1", "B1", { resume: { have } });
    expect(types(chunks)).toEqual([
      "start",
      `seg:${fragmentKey} seg:${fragmentKey}:reveal`,
      ":complete"
    ]);
    const fragment = record(chunks, `seg:${fragmentKey}`);
    expect(fragment.digest).toBe(textDigest(fragment.value));
  });

  it("a hole still pending is never emitted; a settled sibling is", async () => {
    const have = haveFrom(await renderOnce("T1", "B1"));
    const ch = channel<string>();
    const controller = new AbortController();
    const { chunks, until } = consume(
      renderServerComponent(makeComponent("T2", ch.iterable), {
        frame: { id: "f" },
        resume: { have },
        signal: controller.signal
      })
    );
    // The root hole settled (sync) and differs: it ships at the shell...
    await until(c => records([c], "hole:").length > 0);
    await tick(20);
    // ...while the body never yields, so nothing for the boundary crosses
    // — no fragment, no reveal, no fallback over the content the client
    // shows — for as long as the connection lives.
    expect(types(chunks)).toEqual(["start", "hole:lh:1"]);
    // The request's abort tears the render down: nothing further is
    // emitted (the transport closes the body; `renderServerComponent`'s
    // own pipe has no end to report for a torn-down render).
    controller.abort();
    await tick(20);
    expect(types(chunks)).toEqual(["start", "hole:lh:1"]);
  });

  it("a skeleton that differs re-ships the root and streams as a full render", async () => {
    const have = haveFrom(await renderOnce("T1", "B1"));
    const chunks = await renderOnce("T1", "B1", { resume: { have } }, /* wide */ true);
    expect(types(chunks)).toEqual(fullRender(chunks));
    const html = record(chunks, "");
    expect(html.value).toContain('class="wide"');
    expect(html.digest).toBe(textDigest(frameSkeleton(html.value)));
    expect(html.digest).not.toBe(have[""]);
  });

  it("without a have-list the render is the progressive stream it always was", async () => {
    const chunks = await renderOnce("T1", "B1", { resume: undefined });
    expect(types(chunks)).toEqual(fullRender(chunks));
  });
});
