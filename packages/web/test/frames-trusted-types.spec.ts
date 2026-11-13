/**
 * @vitest-environment jsdom
 *
 * Server HTML under Trusted Types.
 *
 * The frames client parses the HTML a server component sends by assigning it
 * to `innerHTML`, which a page that enforces `require-trusted-types-for
 * 'script'` rejects for a plain string. The client entry installs the DOM
 * runtime's `trustedHTML` as the frame runtime's wrap, so that HTML goes
 * through the policy the app handed to `setTrustedTypesPolicy`.
 */
import { afterEach, describe, expect, test, vi } from "vitest";
import { setTrustedTypesPolicy } from "@solidjs/web";
import "../frames/src/client.js";
import { parseFragment } from "../frames/src/frame-client.js";

afterEach(() => setTrustedTypesPolicy(undefined));

describe("the frames client parses through setTrustedTypesPolicy", () => {
  test("parseFragment assigns the TrustedHTML the policy creates", () => {
    const assigned: unknown[] = [];
    const setter = vi
      .spyOn(Element.prototype, "innerHTML", "set")
      .mockImplementation(value => void assigned.push(value));
    const createHTML = vi.fn((html: string) => ({ html }));
    setTrustedTypesPolicy({ createHTML });

    parseFragment("<b>server</b><!--$-->");
    setter.mockRestore();

    expect(createHTML.mock.calls).toEqual([["<b>server</b><!--$-->"]]);
    expect(assigned).toEqual([createHTML.mock.results[0].value]);
  });

  test("parseFragment assigns the string without a policy", () => {
    const fragment = parseFragment("<b>server</b><!--$-->");

    expect(fragment.childNodes.length).toBe(2);
    expect((fragment.firstChild as Element).outerHTML).toBe("<b>server</b>");
  });
});
