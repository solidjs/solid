/**
 * @jsxImportSource @solidjs/web
 */
import { describe, expect, test } from "vitest";
import { createComponent, Errored, Loading } from "solid-js";
import { renderToString } from "@solidjs/web";

// A boundary's content never passes a compiled `escape` hole: the boundary
// resolves it itself. <Loading> escaped it; <Errored> wrote a string child as
// raw HTML, so user text inside an error boundary became live markup (#4116).

const evil = "<script>alert(1)</script>";
const escaped = "&lt;script>alert(1)&lt;/script>";
const stripKeys = (html: string) => html.replace(/ _hk=[^\s>]+/g, "");
const render = (code: () => any) => stripKeys(renderToString(code as never));
const errored = (children: () => any) =>
  createComponent(Errored, {
    fallback: "",
    get children() {
      return children();
    }
  });

describe("<Errored> escapes its children on the server (#4116)", () => {
  test("a string child", () => {
    expect(render(() => errored(() => evil))).toBe(escaped);
  });

  test("matches a plain child and a <Loading> child", () => {
    const loading = render(() =>
      createComponent(Loading, {
        fallback: "",
        get children() {
          return evil;
        }
      })
    );
    expect(render(() => evil)).toBe(escaped);
    expect(loading).toBe(escaped);
  });

  test("an array of strings", () => {
    const html = render(() => errored(() => [evil, evil]));
    expect(html).not.toContain("<script>");
    expect(html.split(escaped).length).toBe(3);
  });

  test("a function returning a string", () => {
    expect(render(() => errored(() => () => evil))).toBe(escaped);
  });

  test("inside a compiled template", () => {
    const html = render(() => <div>{errored(() => evil)}</div>);
    expect(html).toBe(`<div>${escaped}</div>`);
  });

  test("compiled markup in the boundary is not escaped twice", () => {
    const html = render(() => (
      <Errored fallback="">
        <b>{evil}</b>
      </Errored>
    ));
    expect(html).toBe(`<b>${escaped}</b>`);
  });
});
