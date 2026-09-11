/**
 * @vitest-environment jsdom
 *
 * Document-shell templates and client creation (#3259).
 *
 * `<template>` contents parsing ignores `<html>`/`<head>`/`<body>` start
 * tags, so a document-shell template silently flattens when client-created
 * and the emitted walk binds the wrong nodes. The compile-time validator
 * deliberately accepts well-formed shells — they are legitimate under
 * hydration, and erroring there killed every import of a root-route module —
 * so the failure lives here instead, in dev, at the actual broken act.
 */
import { describe, expect, test } from "vitest";
import { template } from "../src/client.js";

describe("client-creating a document shell fails loudly in dev (#3259)", () => {
  test.each(["<html><head></head><body><div></div></body></html>", "<head></head>", "<body></body>"])(
    "%s throws at instantiation with a hydrate() pointer",
    html => {
      const create = template(html);
      // compile (registration) is fine — only instantiation is the broken act
      expect(create).toThrow(/cannot be client-created[\s\S]*hydrate\(\)/);
    }
  );

  test("an ordinary template still instantiates", () => {
    const create = template("<div><span></span></div>");
    expect((create() as Element).tagName).toBe("DIV");
  });

  test("an <hr> is not mistaken for a shell prefix", () => {
    // the guard matches tags, not prefixes: h-t-m-l, not anything with "h"
    const create = template("<header></header>");
    expect((create() as Element).tagName).toBe("HEADER");
  });
});
