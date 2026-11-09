/**
 * @jsxImportSource @solidjs/web
 */
// An in-tag hole whose value is still pending at the top of a live frame
// render (no <Loading> around it) escalates to a retry fn, which resolves
// later through the tree resolver. That resolver treats function nodes as
// content, so the retry used to be routed through the live-hole engine and
// minted comment markers inside the tag (`<i<!--lh:1--> data-x="0"<!--lh:/1-->>`)
// or inside a style value (`style="<!--lh:1-->top:0px<!--lh:/1-->"`): the
// browser's parser reads either as a broken tag. The tag's capture now stays
// open, pending: the element keeps its address, and the attribute binding
// registers when the tag's retries resolve, so later values ride `attr` ops.
import { describe, expect, test } from "vitest";
import { createMemo } from "solid-js";
import { Loading } from "@solidjs/web";
import { renderServerComponent } from "../../frames/src/frame-sink.js";

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));

async function render(S: () => any) {
  const chunks: any[] = [];
  await new Promise<void>(res =>
    renderServerComponent(S, { frame: { id: "f" }, live: true } as any).pipe({
      write: (c: any) => chunks.push(c),
      end: res
    })
  );
  const root = chunks.find(c => c.r && c.r[""])!.r[""].value as string;
  const ops = Object.assign({}, ...chunks.filter(c => c.r && !c.r[""]).map(c => c.r));
  return { root, ops };
}

// Any comment between a tag's `<` and its `>`.
const markerInTag = /<[a-z]+\b[^>]*<!--/;
const addressesPerTag = (html: string) =>
  [...html.matchAll(/<[a-z]+\b[^>]*>/g)]
    .map(m => (m[0].match(/data-lha=/g) || []).length)
    .filter(n => n > 0);

const ticking = () =>
  createMemo(async function* () {
    yield 0;
    await wait(20);
    yield 1;
  });

describe("an escalated in-tag hole at the top of a live render", () => {
  test("grouped attributes: a style object, a style string, a data attribute, a class", async () => {
    const { root, ops } = await render(() => {
      const tick = ticking();
      const h = createMemo(() => tick() * 10 + 100);
      return (
        <section>
          <div id="a" style={{ position: "relative", height: `${h()}px` }} />
          <div id="b" style={`top:${h()}px`} />
          <div id="c" data-x={tick()} />
          <div id="d" class={"c" + h()} />
          <p>{tick()}</p>
        </section>
      );
    });
    expect(root).not.toMatch(markerInTag);
    expect(addressesPerTag(root)).toEqual([1, 1, 1, 1]);
    expect(root).toMatch(/<div data-lha="(\d+)" id="a" style="position:relative;height:100px">/);
    expect(root).toMatch(/<div data-lha="\d+" id="b" style="top:100px">/);
    expect(root).toMatch(/<div data-lha="\d+" id="c" data-x="0">/);
    expect(root).toMatch(/<div data-lha="\d+" id="d" class="c100">/);
    const attrs = Object.entries(ops)
      .filter(([k]) => k.startsWith("attr:"))
      .map(([, v]: any) => v.value);
    expect(attrs).toEqual([
      ' id="a" style="position:relative;height:110px"',
      ' id="b" style="top:110px"',
      ' id="c" data-x="1"',
      ' id="d" class="c110"'
    ]);
    // No hole op is keyed at an attribute; the content hole stays live.
    const holes = Object.entries(ops).filter(([k]) => k.startsWith("hole:"));
    expect(holes.map(([, v]: any) => v.value)).toEqual(["1"]);
  });

  test("a lone attribute (no group)", async () => {
    const { root, ops } = await render(() => {
      const tick = ticking();
      const h = createMemo(() => tick() + 7);
      return <i data-x={h()} />;
    });
    expect(root).toMatch(/^<i data-lha="(\d+)" data-x="7"><\/i>$/);
    const id = root.match(/data-lha="(\d+)"/)![1];
    expect(ops["attr:" + id].value).toBe(' data-x="8"');
  });

  test("a lone attribute after an escalated content hole", async () => {
    const { root, ops } = await render(() => {
      const tick = ticking();
      const h = createMemo(() => tick() + 7);
      return (
        <section>
          <p>{h()}</p>
          <i data-x={h()} />
        </section>
      );
    });
    expect(root).not.toMatch(markerInTag);
    const id = root.match(/<i data-lha="(\d+)" data-x="7">/)![1];
    expect(ops["attr:" + id].value).toBe(' data-x="8"');
  });

  test("inside <Loading> the tag re-renders whole: one address, still live", async () => {
    const { root, ops } = await render(() => {
      const tick = ticking();
      const h = createMemo(() => tick() * 10 + 100);
      return (
        <Loading fallback={<span>FB</span>}>
          <div id="a" style={{ height: `${h()}px` }} />
        </Loading>
      );
    });
    expect(root).not.toMatch(markerInTag);
    expect(JSON.stringify(ops)).toContain("height:110px");
    for (const html of [root, ...Object.values(ops).map((v: any) => v?.value ?? "")])
      expect(addressesPerTag(String(html)).every(n => n === 1)).toBe(true);
  });
});
