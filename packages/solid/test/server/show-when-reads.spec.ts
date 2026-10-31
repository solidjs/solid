import { describe, expect, test } from "vitest";
import { createComponent, Show } from "../../src/server/index.js";

function renderShow(keyed: boolean) {
  let reads = 0;
  const html = createComponent(Show, {
    keyed,
    get when() {
      reads++;
      return { name: "a" };
    },
    children: (item: any) => (keyed ? item.name : item().name)
  } as any);
  return { html, reads };
}

describe("Show on the server", () => {
  test("reads when once with an accessor child", () => {
    expect(renderShow(false)).toEqual({ html: "a", reads: 1 });
  });

  test("reads when once with a keyed child", () => {
    expect(renderShow(true)).toEqual({ html: "a", reads: 1 });
  });
});
