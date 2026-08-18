/**
 * @jsxImportSource @solidjs/web
 * @vitest-environment jsdom
 */
import { describe, expect, test, vi } from "vitest";
import { createSignal, flush, Show, DEV } from "solid-js";
import { render, Portal } from "@solidjs/web";

describe("Testing a simple Portal", () => {
  let div = document.createElement("div"),
    disposer: () => void;
  const testMount = document.createElement("div");
  const Component = () => <Portal mount={testMount}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(testMount.innerHTML).toBe("Hi");
    expect((testMount.firstChild as Text & { _$host: HTMLElement })._$host).toBe(div);
  });

  test("dispose", () => {
    disposer();
    expect(div.innerHTML).toBe("");
  });
});

describe("Testing an SVG Portal", () => {
  let div = document.createElement("div"),
    disposer: () => void;
  const testMount = document.createElement("svg");
  const Component = () => <Portal mount={testMount}>Hi</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(testMount.innerHTML).toBe("Hi");
    expect((testMount.firstChild as Text & { _$host: HTMLElement })._$host).toBe(div);
  });

  test("dispose", () => disposer());
});

describe("Testing Portal delegated event containers", () => {
  test("default body portal from an app root bubbles through the logical tree", () => {
    const root = document.createElement("div");
    const calls: string[] = [];
    let portalButton!: HTMLButtonElement;

    document.body.appendChild(root);
    const dispose = render(
      () => (
        <section onClick={() => calls.push("logical")}>
          <Portal>
            <button ref={portalButton} onClick={() => calls.push("portal")} />
          </Portal>
        </section>
      ),
      root
    );

    portalButton.click();

    expect(calls).toEqual(["portal", "logical"]);
    dispose();
    root.remove();
  });

  test("outside-root portal delegated events bubble through the logical tree", () => {
    const root = document.createElement("div");
    const mount = document.createElement("div");
    const calls: string[] = [];
    let portalButton!: HTMLButtonElement;

    document.body.append(root, mount);
    const dispose = render(
      () => (
        <section onClick={() => calls.push("logical")}>
          <Portal mount={mount}>
            <button ref={portalButton} onClick={() => calls.push("portal")} />
          </Portal>
        </section>
      ),
      root
    );

    portalButton.click();

    expect(calls).toEqual(["portal", "logical"]);
    dispose();
    root.remove();
    mount.remove();
  });

  test("delegated event targeting the render root itself does not crash with a body portal (#3008)", () => {
    const root = document.createElement("div");
    const calls: string[] = [];
    let portalButton!: HTMLButtonElement;
    const errors: unknown[] = [];
    const onError = (e: ErrorEvent) => {
      errors.push(e.error);
      e.preventDefault();
    };

    document.body.appendChild(root);
    window.addEventListener("error", onError);
    const dispose = render(
      () => (
        <section onClick={() => calls.push("logical")}>
          <Portal>
            <button ref={portalButton} onClick={() => calls.push("portal")} />
          </Portal>
        </section>
      ),
      root
    );

    try {
      // Both delegated containers exist now: root (from render) and body (from
      // the Portal). An event whose target is the render root itself — pointer
      // events over the app background in a real app — used to make body's
      // resume path climb past #document and throw in walkUpTree.
      root.click();

      expect(errors).toEqual([]);
      expect(calls).toEqual([]);

      // The portal segment still works after the root-targeted event.
      portalButton.click();
      expect(calls).toEqual(["portal", "logical"]);
    } finally {
      window.removeEventListener("error", onError);
      dispose();
      root.remove();
    }
  });

  test("inside-root portal mounts do not install extra delegated listeners", () => {
    const root = document.createElement("div");
    const mount = document.createElement("div");
    const add = vi.spyOn(mount, "addEventListener");
    let portalButton!: HTMLButtonElement;
    let calls = 0;

    root.appendChild(mount);
    document.body.appendChild(root);
    const dispose = render(
      () => (
        <Portal mount={mount}>
          <button ref={portalButton} onClick={() => calls++} />
        </Portal>
      ),
      root
    );

    portalButton.click();

    expect(calls).toBe(1);
    expect(add).not.toHaveBeenCalledWith("click", expect.any(Function));
    dispose();
    add.mockRestore();
    root.remove();
  });
});

describe("Testing Portal mount ref timing", () => {
  test("mounts into an earlier sibling ref", () => {
    const root = document.createElement("div");
    let mount!: HTMLDivElement;
    let portalButton!: HTMLButtonElement;

    document.body.appendChild(root);
    const dispose = render(
      () => (
        <>
          <div ref={mount} />
          <Portal mount={mount}>
            <button ref={portalButton}>Portal button</button>
          </Portal>
        </>
      ),
      root
    );

    expect(root.innerHTML).toBe("<div><button>Portal button</button></div>");
    expect(portalButton.parentNode).toBe(mount);
    expect(portalButton.textContent).toBe("Portal button");
    dispose();
    root.remove();
  });

  test("preserves child ref timing for default body portals", () => {
    const root = document.createElement("div");
    let portalButton!: HTMLButtonElement;

    document.body.appendChild(root);
    const dispose = render(
      () => (
        <Portal>
          <button ref={portalButton}>Ready</button>
        </Portal>
      ),
      root
    );

    expect(portalButton).toBeInstanceOf(HTMLButtonElement);
    expect(portalButton.parentNode).toBe(document.body);
    dispose();
    root.remove();
  });

  test("delegated events bubble through logical tree with an earlier sibling mount ref", () => {
    const root = document.createElement("div");
    const calls: string[] = [];
    let mount!: HTMLDivElement;
    let portalButton!: HTMLButtonElement;

    document.body.appendChild(root);
    const dispose = render(
      () => (
        <section onClick={() => calls.push("logical")}>
          <div ref={mount} />
          <Portal mount={mount}>
            <button ref={portalButton} onClick={() => calls.push("portal")} />
          </Portal>
        </section>
      ),
      root
    );

    portalButton.click();

    expect(calls).toEqual(["portal", "logical"]);
    dispose();
    root.remove();
  });
});

describe("Testing a Portal to the head", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    [s, set] = createSignal("A Meaningful Page Title"),
    [visible, setVisible] = createSignal(true);
  const Component = () => (
    <Show when={visible()}>
      <Portal mount={document.head}>
        <title>{s()}</title>
      </Portal>
    </Show>
  );

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(document.head.innerHTML).toBe("<title>A Meaningful Page Title</title>");
  });

  test("Update title text", () => {
    set("A New Better Page Title");
    flush();
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
  });

  test("Hide Portal", () => {
    setVisible(false);
    flush();
    expect(document.head.innerHTML).toBe("");
    setVisible(true);
    flush();
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
  });

  test("dispose", async () => {
    expect(document.head.innerHTML).toBe("<title>A New Better Page Title</title>");
    disposer();
    expect(document.head.innerHTML).toBe("");
  });
});

describe("Testing a Portal with Synthetic Events", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    testElem!: HTMLDivElement,
    clicked = false;
  const Component = () => (
    <Portal>
      <div ref={testElem} onClick={e => (clicked = true)} />
    </Portal>
  );

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
  });

  test("Test portal element clicked", () => {
    expect(clicked).toBe(false);
    testElem.click();
    expect(clicked).toBe(true);
  });

  test("dispose", () => disposer());
});

describe("Testing Portal content swapping (#2757)", () => {
  test("keyed Show swaps replace content instead of accumulating", () => {
    const div = document.createElement("div");
    const mount = document.createElement("div");
    const [key, setKey] = createSignal(1);

    const disposer = render(
      () => (
        <Portal mount={mount}>
          <Show keyed when={key()}>
            {k => <span>content for key {k}</span>}
          </Show>
        </Portal>
      ),
      div
    );

    expect(mount.querySelectorAll("span").length).toBe(1);
    expect(mount.querySelector("span")!.textContent).toBe("content for key 1");

    for (let i = 2; i <= 4; i++) {
      setKey(i);
      flush();
      expect(mount.querySelectorAll("span").length).toBe(1);
      expect(mount.querySelector("span")!.textContent).toBe(`content for key ${i}`);
    }

    disposer();
    expect(mount.innerHTML).toBe("");
  });

  test("two portals sharing a mount stay isolated", () => {
    const div = document.createElement("div");
    const mount = document.createElement("div");
    const [key, setKey] = createSignal(1);

    const disposer = render(
      () => (
        <>
          <Portal mount={mount}>
            <Show keyed when={key()}>
              {k => <span>swapping {k}</span>}
            </Show>
          </Portal>
          <Portal mount={mount}>
            <b>stable</b>
          </Portal>
        </>
      ),
      div
    );

    expect(mount.querySelectorAll("span").length).toBe(1);
    expect(mount.querySelectorAll("b").length).toBe(1);

    setKey(2);
    flush();
    expect(mount.querySelectorAll("span").length).toBe(1);
    expect(mount.querySelector("span")!.textContent).toBe("swapping 2");
    expect(mount.querySelectorAll("b").length).toBe(1);
    expect(mount.querySelector("b")!.textContent).toBe("stable");

    disposer();
    expect(mount.innerHTML).toBe("");
  });

  test("delegated events retarget through nodes inserted by swaps", () => {
    const root = document.createElement("div");
    const mount = document.createElement("div");
    const calls: string[] = [];
    const [key, setKey] = createSignal(1);
    let portalButton!: HTMLButtonElement;

    document.body.append(root, mount);
    const disposer = render(
      () => (
        <section onClick={() => calls.push("logical")}>
          <Portal mount={mount}>
            <Show keyed when={key()}>
              {k => <button ref={portalButton} onClick={() => calls.push(`portal ${k}`)} />}
            </Show>
          </Portal>
        </section>
      ),
      root
    );

    portalButton.click();
    expect(calls).toEqual(["portal 1", "logical"]);

    // the swapped-in button arrives via the runtime's replace path — it must
    // still carry the host tag for logical-tree bubbling
    calls.length = 0;
    setKey(2);
    flush();
    portalButton.click();
    expect(calls).toEqual(["portal 2", "logical"]);

    disposer();
    root.remove();
    mount.remove();
  });
});

describe("Testing Portal insert effect ownership (#2758)", () => {
  test("reactive portal children create no ownerless effects", () => {
    const div = document.createElement("div");
    const mount = document.createElement("div");
    const [key, setKey] = createSignal(1);

    const capture = DEV!.diagnostics.capture();
    const disposer = render(
      () => (
        <Portal mount={mount}>
          <Show keyed when={key()}>
            {k => <span>{k}</span>}
          </Show>
        </Portal>
      ),
      div
    );
    setKey(2);
    flush();
    disposer();
    const events = capture.stop();

    expect(events.filter(e => e.code === "NO_OWNER_EFFECT")).toEqual([]);
  });

  test("insert effect is disposed with the Portal", () => {
    const div = document.createElement("div");
    const mount = document.createElement("div");
    const [key, setKey] = createSignal(1);

    const disposer = render(
      () => (
        <Portal mount={mount}>
          <Show keyed when={key()}>
            {k => <span>{k}</span>}
          </Show>
        </Portal>
      ),
      div
    );
    expect(mount.textContent).toBe("1");

    disposer();
    expect(mount.innerHTML).toBe("");

    // a leaked insert effect would still react to this and try to write
    // into the unmounted markers
    expect(() => {
      setKey(2);
      flush();
    }).not.toThrow();
    expect(mount.innerHTML).toBe("");
  });

  test("changing mount disposes the previous insert effect", () => {
    const div = document.createElement("div");
    const mountA = document.createElement("div");
    const mountB = document.createElement("div");
    const [mount, setMount] = createSignal(mountA);
    const [key, setKey] = createSignal(1);

    const capture = DEV!.diagnostics.capture();
    const disposer = render(
      () => (
        <Portal mount={mount()}>
          <Show keyed when={key()}>
            {k => <span>content {k}</span>}
          </Show>
        </Portal>
      ),
      div
    );
    expect(mountA.querySelectorAll("span").length).toBe(1);

    setMount(mountB);
    flush();
    expect(mountA.innerHTML).toBe("");
    expect(mountB.querySelectorAll("span").length).toBe(1);

    // only the live insert effect may respond — a survivor from mountA
    // would produce duplicates in mountB
    setKey(2);
    flush();
    expect(mountA.innerHTML).toBe("");
    expect(mountB.querySelectorAll("span").length).toBe(1);
    expect(mountB.querySelector("span")!.textContent).toBe("content 2");

    disposer();
    expect(mountB.innerHTML).toBe("");
    const events = capture.stop();
    expect(events.filter(e => e.code === "NO_OWNER_EFFECT")).toEqual([]);
  });
});

describe("Testing Portal marker cleanup", () => {
  // empty text markers don't serialize, so these assert on childNodes.length —
  // innerHTML checks stay green even when markers are stranded
  test("disposing a Portal removes its markers from the mount", () => {
    const div = document.createElement("div");
    const mount = document.createElement("div");

    const disposer = render(
      () => (
        <Portal mount={mount}>
          <span>content</span>
        </Portal>
      ),
      div
    );
    expect(mount.querySelector("span")).toBeTruthy();

    disposer();
    expect(mount.childNodes.length).toBe(0);
  });

  test("toggling a Portal does not accumulate markers in the mount", () => {
    const div = document.createElement("div");
    const mount = document.createElement("div");
    const [open, setOpen] = createSignal(false);

    const disposer = render(
      () => (
        <Show when={open()}>
          <Portal mount={mount}>
            <span>modal</span>
          </Portal>
        </Show>
      ),
      div
    );

    for (let i = 0; i < 5; i++) {
      setOpen(true);
      flush();
      expect(mount.querySelector("span")).toBeTruthy();
      setOpen(false);
      flush();
      expect(mount.childNodes.length).toBe(0);
    }
    disposer();
  });

  test("switching mounts leaves no markers behind in either mount", () => {
    const div = document.createElement("div");
    const mountA = document.createElement("div");
    const mountB = document.createElement("div");
    const [mount, setMount] = createSignal(mountA);

    const disposer = render(
      () => (
        <Portal mount={mount()}>
          <span>content</span>
        </Portal>
      ),
      div
    );
    expect(mountA.querySelector("span")).toBeTruthy();

    setMount(mountB);
    flush();
    expect(mountA.childNodes.length).toBe(0);
    expect(mountB.querySelector("span")).toBeTruthy();

    disposer();
    expect(mountB.childNodes.length).toBe(0);
  });
});

describe("Testing a Portal with direct reactive children", () => {
  let div = document.createElement("div"),
    disposer: () => void,
    [count, setCount] = createSignal(1);
  const Component = () => <Portal>{count()}</Portal>;

  test("Create portal control flow", () => {
    disposer = render(Component, div);
    expect(div.innerHTML).toBe("");
    expect(document.body.innerHTML).toBe("1");
  });

  test("Click to trigger reactive update", () => {
    expect(document.body.innerHTML).toBe("1");
    setCount(count() + 1);
    flush();
    expect(document.body.innerHTML).toBe("2");
    setCount(count() + 1);
    flush();
    expect(document.body.innerHTML).toBe("3");
  });

  test("dispose", () => disposer());
});
