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

/** What the client's ledger holds after applying a full render's chunks. */
function haveFrom(chunks: any[]) {
  const have: Record<string, string> = {};
  for (const c of chunks) {
    if (c.type === "html" && c.id === "f") {
      have[""] = c.digest;
      Object.assign(have, c.holes);
    } else if (c.type === "fragment") {
      have[c.key] = c.digest;
      Object.assign(have, c.holes);
    } else if (c.type === "hole") {
      have[c.key] = c.digest;
      Object.assign(have, c.holes);
    }
  }
  return have;
}

const types = (chunks: any[]) => chunks.map(c => c.type);

describe("conditional reconnect: digests on every emission", () => {
  it("root, fragment and hole chunks carry digests and the holes inside them", async () => {
    const chunks = await renderOnce("T1", "B1");
    const html = chunks.find(c => c.type === "html");
    expect(html.digest).toBe(textDigest(frameSkeleton(html.html)));
    // The root's hole map names the title hole with the digest of its
    // marker-free html; the body hole is inside the pending fragment, so
    // it is not the root's to name. (Ids follow mint order: the boundary's
    // children evaluate — and escalate — before the article's own holes
    // resolve, so the body is `lh:0` and the title `lh:1`.)
    expect(html.holes).toEqual({ "lh:1": textDigest("T1") });
    const fragment = chunks.find(c => c.type === "fragment");
    expect(fragment.digest).toBe(textDigest(fragment.html));
    expect(fragment.html).toMatch(/<!--lh:0-->B1<!--lh:\/0-->/);
    expect(fragment.holes).toEqual({ "lh:0": textDigest("B1") });
    expect(types(chunks)).toEqual(["start", "html", "fragment", "reveal", "complete"]);
  });

  it("a live re-emission mid-response carries its digest", async () => {
    const ch = channel<string>();
    const { chunks, until, done } = consume(
      renderServerComponent(makeComponent("T1", ch.iterable), { frame: { id: "f" } })
    );
    await tick();
    ch.push("B1");
    await until(c => c.type === "fragment");
    ch.push("B2");
    await until(c => c.type === "hole");
    ch.end();
    await done;
    const hole = chunks.find(c => c.type === "hole");
    expect(hole.key).toBe("lh:0");
    expect(hole.html).toBe("B2");
    expect(hole.digest).toBe(textDigest("B2"));
  });
});

describe("conditional reconnect: the resume render", () => {
  it("a no-op reconnect transfers nothing", async () => {
    const have = haveFrom(await renderOnce("T1", "B1"));
    const chunks = await renderOnce("T1", "B1", { resume: { have } });
    expect(types(chunks)).toEqual(["start", "complete"]);
  });

  it("a changed root hole transfers exactly that hole, no root", async () => {
    const have = haveFrom(await renderOnce("T1", "B1"));
    const chunks = await renderOnce("T2", "B1", { resume: { have } });
    expect(types(chunks)).toEqual(["start", "hole", "complete"]);
    const hole = chunks[1];
    expect(hole.key).toBe("lh:1");
    expect(hole.html).toBe("T2");
    expect(hole.digest).toBe(textDigest("T2"));
  });

  it("a changed hole inside a revealed fragment transfers the hole, not the fragment", async () => {
    const have = haveFrom(await renderOnce("T1", "B1"));
    const chunks = await renderOnce("T1", "B2", { resume: { have } });
    expect(types(chunks)).toEqual(["start", "hole", "complete"]);
    expect(chunks[1].key).toBe("lh:0");
    expect(chunks[1].html).toBe("B2");
    // The ledger the client keeps from this stream names the new value.
    expect(haveFrom(chunks)["lh:0"]).toBe(textDigest("B2"));
  });

  it("a fragment the client shows as a fallback streams when it settles", async () => {
    const full = await renderOnce("T1", "B1");
    const have = haveFrom(full);
    const fragmentKey = full.find(c => c.type === "fragment").key;
    // The client's ledger without the fragment: it holds the root (the
    // fallback is part of the skeleton) and the root's holes, nothing for
    // the boundary's content.
    delete have[fragmentKey];
    delete have["lh:0"];
    const chunks = await renderOnce("T1", "B1", { resume: { have } });
    expect(types(chunks)).toEqual(["start", "fragment", "reveal", "complete"]);
    expect(chunks[1].key).toBe(fragmentKey);
    expect(chunks[1].digest).toBe(textDigest(chunks[1].html));
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
    await until(c => c.type === "hole");
    await tick(20);
    // ...while the body never yields, so nothing for the boundary crosses
    // — no fragment, no reveal, no fallback over the content the client
    // shows — for as long as the connection lives.
    expect(types(chunks)).toEqual(["start", "hole"]);
    // The request's abort tears the render down: nothing further is
    // emitted (the transport closes the body; `renderServerComponent`'s
    // own pipe has no end to report for a torn-down render).
    controller.abort();
    await tick(20);
    expect(types(chunks)).toEqual(["start", "hole"]);
  });

  it("a skeleton that differs re-ships the root and streams as a full render", async () => {
    const have = haveFrom(await renderOnce("T1", "B1"));
    const chunks = await renderOnce("T1", "B1", { resume: { have } }, /* wide */ true);
    expect(types(chunks)).toEqual(["start", "html", "fragment", "reveal", "complete"]);
    const html = chunks[1];
    expect(html.html).toContain('class="wide"');
    expect(html.digest).toBe(textDigest(frameSkeleton(html.html)));
    expect(html.digest).not.toBe(have[""]);
  });

  it("without a have-list the render is the progressive stream it always was", async () => {
    const chunks = await renderOnce("T1", "B1", { resume: undefined });
    expect(types(chunks)).toEqual(["start", "html", "fragment", "reveal", "complete"]);
  });
});
