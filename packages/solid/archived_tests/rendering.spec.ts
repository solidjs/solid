import { describe, expect, test } from "vitest";
import { createResource } from "../src/index.js";
import { resolveSSRNode } from "dom-expressions/src/server.js";

describe("resolveSSRNode", () => {
  test("should resolve a string node", () => {
    expect(resolveSSRNode("Hello World")).toBe("Hello World");
  });

  test("should resolve a null or boolean node", () => {
    expect(resolveSSRNode(null)).toBe("");
    expect(resolveSSRNode(false)).toBe("");
  });

  test("should resolve an array of nodes", () => {
    const nodes = ["<div>", "<span>", "</span>", "</div>"];
    expect(resolveSSRNode(nodes)).toBe("<div><!--!$--><span><!--!$--></span><!--!$--></div>");
  });

  test("should resolve an object with 't' property", () => {
    const node = { t: "<div>Text</div>" };
    expect(resolveSSRNode(node)).toBe("<div>Text</div>");
  });

  test("should resolve a function node", () => {
    const fn = () => "dynamic content";
    expect(resolveSSRNode(fn)).toBe("dynamic content");
  });
});

describe("createResource", () => {
  test("should return initial value immediately if provided", () => {
    const [data] = createResource(() => Promise.resolve("test"), { initialValue: "loading" });
    expect(data()).toBe("loading");
  });

  test("should handle a promise and update the value", async () => {
    const [data, { refetch }] = createResource(
      () => new Promise(resolve => setTimeout(() => resolve("Success!"), 10))
    );

    // Initially, data should be undefined, and loading should be true
    expect(data()).toBeUndefined();
    expect(data.loading).toBe(true);

    await new Promise(r => setTimeout(r, 20)); // Wait for the promise to resolve

    // After resolution, data should have the new value, and loading should be false
    expect(data()).toBe("Success!");
    expect(data.loading).toBe(false);
  });
});
