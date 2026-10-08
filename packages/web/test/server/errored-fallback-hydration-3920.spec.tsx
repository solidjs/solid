/**
 * @jsxImportSource @solidjs/web
 */
/**
 * #3920 — an `<Errored>` fallback that shares a `{props.children}` slot with
 * an async sibling is rendered again when that slot is retried. The server
 * boundary resets the children owner but not the fallback's output owner, so
 * the fallback's hydration keys continue from the discarded render while the
 * client renders it once.
 */
import { describe, expect, test } from "vitest";
import { Errored, renderToStream } from "@solidjs/web";
import { createMemo, createUniqueId } from "solid-js";

const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function settle(code: () => any): Promise<string> {
  return Promise.race([
    new Promise<string>(resolve => renderToStream(code).then(resolve)),
    delay(1000).then(() => "TIMEOUT")
  ]);
}

function Layout(props: { children: any }) {
  return <main>{props.children}</main>;
}

function Throws() {
  throw new Error("boom");
}

function Fallback() {
  const id = createUniqueId();
  return (
    <section data-id={id}>
      <button type="button">clicked</button>
    </section>
  );
}

function AsyncSibling() {
  const value = createMemo(async () => {
    await delay(20);
    return "async content";
  });
  return <p>{value()}</p>;
}

function SyncSibling() {
  return <p>sync content</p>;
}

function fallbackId(html: string): string | undefined {
  const match = html.match(/data-id=(?:"([^"]+)"|([^\s>]+))/);
  return match?.[1] ?? match?.[2];
}

function errorWrites(html: string): number {
  return html.match(/new Error\("boom"\)/g)?.length ?? 0;
}

function sectionKey(html: string): string | undefined {
  return html.match(/<section\b[^>]*\s_hk=([^\s>]+)/)?.[1];
}

describe("#3920 Errored fallback hydration keys", () => {
  test("a retried children slot does not shift the fallback off the client's ids", async () => {
    const retried = await settle(() => (
      <Layout>
        <Errored fallback={() => <Fallback />}>
          <Throws />
        </Errored>
        <AsyncSibling />
      </Layout>
    ));
    const once = await settle(() => (
      <Layout>
        <Errored fallback={() => <Fallback />}>
          <Throws />
        </Errored>
        <SyncSibling />
      </Layout>
    ));

    expect(retried).not.toBe("TIMEOUT");
    expect(once).not.toBe("TIMEOUT");
    expect(retried).toContain("clicked");
    expect(retried).toContain("async content");
    expect(fallbackId(retried)).toBe(fallbackId(once));
    expect(sectionKey(retried)).toBe(sectionKey(once));
    expect(errorWrites(retried)).toBe(1);
    expect(errorWrites(once)).toBe(1);
  });

  test("async content inside the retained fallback still resolves", async () => {
    let runs = 0;
    function CountingFallback() {
      const id = createUniqueId();
      const value = createMemo(async () => {
        runs++;
        await delay(15);
        return "recovered";
      });
      return <section data-id={id}>{value()}</section>;
    }
    const html = await settle(() => (
      <Layout>
        <Errored fallback={() => <CountingFallback />}>
          <Throws />
        </Errored>
        <AsyncSibling />
      </Layout>
    ));

    expect(html).not.toBe("TIMEOUT");
    expect(html).toContain("recovered");
    expect(html).toContain("async content");
    expect(errorWrites(html)).toBe(1);
    // The fallback runs once. Re-pulling the slot must not start its async
    // work over (that also advances the ids the client will look up).
    expect(runs).toBe(1);
  });
});
