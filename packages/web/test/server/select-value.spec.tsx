/**
 * @jsxImportSource @solidjs/web
 *
 * SSR <select value> resolution (#3013). HTML has no `value` attribute on
 * <select>; the compilers emit the bound value as an attribute marker and the
 * server runtime resolves it into `selected` on the matching option at flush,
 * stripping the marker — so the pre-hydration markup shows the right option.
 */
import { describe, expect, test } from "vitest";
import { renderToString, renderToStream, Loading } from "@solidjs/web";
import { createMemo, createSignal } from "solid-js";

function asyncValue<T>(value: T, ms = 10): Promise<T> {
  return new Promise(r => setTimeout(() => r(value), ms));
}

function renderComplete(code: () => any, options: any = {}): Promise<string> {
  return new Promise(resolve => {
    renderToStream(code, options).then(resolve);
  });
}

describe("SSR <select value> (#3013)", () => {
  test("renderToString marks the matching option selected and strips the attribute", () => {
    const [lang] = createSignal("fr");
    const html = renderToString(() => (
      <select value={lang()}>
        <option value="en">English</option>
        <option value="fr">French</option>
        <option value="de">German</option>
      </select>
    ));
    expect(html).toMatch(/<option value="fr" selected>French<\/option>/);
    expect(html).not.toMatch(/<select[^>]*value=/);
    expect(html).not.toMatch(/value="en"[^>]*selected/);
  });

  test("streamed shell resolves the selection", async () => {
    const [lang] = createSignal("de");
    const html = await renderComplete(() => (
      <select value={lang()}>
        <option value="en">English</option>
        <option value="de">German</option>
      </select>
    ));
    expect(html).toMatch(/<option value="de" selected>German<\/option>/);
    expect(html).not.toMatch(/<select[^>]*value=/);
  });

  test("an empty-string bound value marks the value='' placeholder option (#3013 follow-up)", () => {
    // Empty attribute values serialize as BARE attributes (`<select value`),
    // which the resolve pass must read as the empty string — a `value=""`
    // option is a matching option (React SSR parity; the single-select
    // placeholder pattern has no other no-JS representation).
    const [lang] = createSignal("");
    const html = renderToString(() => (
      <select id="empty" value={lang()}>
        <option value="" disabled>
          Choose a language
        </option>
        <option value="en">English</option>
        <option value="fr">French</option>
      </select>
    ));
    expect(html).toMatch(/<option value(="")? disabled selected>Choose a language<\/option>/);
    expect(html).not.toMatch(/value="en"[^>]*selected/);
    expect(html).not.toMatch(/<select[^>]*\svalue(=|[\s>])(?![^>]*<)/);
  });

  test("an empty-string value in a streamed shell resolves too", async () => {
    const [lang] = createSignal("");
    const html = await renderComplete(() => (
      <select value={lang()}>
        <option value="">none</option>
        <option value="en">English</option>
      </select>
    ));
    expect(html).toMatch(
      /<option value(="")?\s+selected>none<\/option>|<option value(="")? selected>none<\/option>/
    );
    expect(html).not.toMatch(/value="en"[^>]*selected/);
  });

  test("a select streamed as a late fragment is resolved in its template", async () => {
    const data = asyncValue("fr", 5);
    const Picker = () => {
      const lang = createMemo(() => data);
      return (
        <select value={lang()}>
          <option value="en">English</option>
          <option value="fr">French</option>
        </select>
      );
    };
    const html = await renderComplete(() => (
      <Loading fallback={<p>loading</p>}>
        <Picker />
      </Loading>
    ));
    expect(html).toMatch(/<option value="fr" selected>French<\/option>/);
    expect(html).not.toMatch(/<select[^>]*value=/);
  });
});
