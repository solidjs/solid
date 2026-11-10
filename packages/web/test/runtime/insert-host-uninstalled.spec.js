import * as r from "../../src/client.js";
import { createRoot, createSignal, flush } from "solid-js";

describe("r.insert with host option before installHostTagging", () => {
  it("inserts without tagging on the static and reactive paths", () => {
    const host = () => document.body;

    const staticMount = document.createElement("div");
    const staticNode = document.createElement("span");
    createRoot(() => r.insert(staticMount, staticNode, undefined, undefined, { host }));

    const mount = document.createElement("div");
    const marker = mount.appendChild(document.createTextNode(""));
    const a = document.createElement("span");
    const b = document.createElement("b");
    const [val, setVal] = createSignal(a);
    createRoot(() => r.insert(mount, val, marker, undefined, { host }));
    flush();
    setVal(b);
    flush();

    expect(staticMount.firstChild).toBe(staticNode);
    expect(mount.firstChild).toBe(b);
    expect("_$host" in staticNode).toBe(false);
    expect("_$host" in a).toBe(false);
    expect("_$host" in b).toBe(false);
  });
});
