/**
 * @jsxImportSource @solidjs/web
 */
// `RenderEvent.route`: the route a server render resolved to, as the router
// declared it. A router calls `OBSERVE.attribution.withOrigin` with an
// `initial` ref while building its context — the same call that opens the
// client's first `"navigation"` record — and on the server, where there is
// no attribution engine, the server entry's `withOrigin` files the ref on the
// render context (`_declareRoute`, installed by the renderer under the
// `"render"` record's gate) so the request's `"render"` record names the
// route. The consumer's `http.route`: without it the URL is the only name a
// request has, and one page scatters across as many names as it has params.
//
// Pinned here, against the real renderers:
//
//  - the declaration lands on the record for `renderToString` and
//    `renderToStream`, from the same call a client router makes;
//  - the ref is read at settle, so a match refined during the render (a lazy
//    subtree) is what lands, and a later declaration replaces an earlier one;
//  - a non-initial ref (nothing writes a location on the server) declares
//    nothing, and `withOrigin` still runs its function and returns its value;
//  - a render with no router has no `route`;
//  - with no `"render"` listener the seam is not installed: the call is
//    `fn()` and nothing is kept.
import { afterEach, describe, expect, test } from "vitest";
import { renderToStream, renderToString } from "@solidjs/web";
import { OBSERVE, type NavigationRef } from "solid-js";
import type { RenderEvent, RenderLive } from "@solidjs/web";

type Record = { event: RenderEvent; live: RenderLive };

const unsubscribes: Array<() => void> = [];
afterEach(() => {
  for (const off of unsubscribes.splice(0)) off();
});

function renders(): Record[] {
  const seen: Record[] = [];
  unsubscribes.push(
    OBSERVE!.records.subscribe("render", (event, live) => {
      seen.push({ event, live });
    })
  );
  return seen;
}

function stream(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write(chunk: string) {
        chunks.push(chunk);
      },
      end() {
        resolve(chunks.join(""));
      }
    });
  });
}

/** What a router does while building its context: match, declare, build. */
function Router(props: { nav: NavigationRef; children?: any }) {
  return OBSERVE!.attribution.withOrigin(props.nav, () => <main>{props.children}</main>);
}

const USER: NavigationRef = {
  kind: "navigation",
  initial: true,
  name: "/users/:id",
  to: "/users/42",
  params: { id: "42" }
};

describe("RenderEvent.route", () => {
  test("renderToString: the router's initial declaration names the render", () => {
    const seen = renders();
    const html = renderToString(() => <Router nav={USER}>hi</Router>);
    expect(html).toContain(">hi</main>");
    expect(seen).toHaveLength(1);
    expect(seen[0].event.route).toEqual({
      name: "/users/:id",
      to: "/users/42",
      params: { id: "42" }
    });
    expect(seen[0].event.outcome).toBe("complete");
  });

  test("renderToStream: the same, delivered when the stream completes", async () => {
    const seen = renders();
    await stream(() => <Router nav={USER}>hi</Router>);
    expect(seen).toHaveLength(1);
    expect(seen[0].event.route).toEqual({
      name: "/users/:id",
      to: "/users/42",
      params: { id: "42" }
    });
  });

  test("the ref is read at settle: a match refined during the render is what lands", () => {
    const seen = renders();
    const ref: NavigationRef = {
      kind: "navigation",
      initial: true,
      name: "/admin/*",
      to: "/admin/users"
    };
    renderToString(() =>
      OBSERVE!.attribution.withOrigin(ref, () => {
        // A lazy subtree resolved inside the render refines the match.
        ref.name = "/admin/users";
        ref.params = {};
        return <main />;
      })
    );
    expect(seen[0].event.route).toEqual({ name: "/admin/users", to: "/admin/users", params: {} });
  });

  test("a later declaration replaces an earlier one", () => {
    const seen = renders();
    renderToString(() => (
      <Router nav={{ kind: "navigation", initial: true, name: "/a", to: "/a" }}>
        <Router nav={{ kind: "navigation", initial: true, name: "/b", to: "/b" }}>x</Router>
      </Router>
    ));
    expect(seen[0].event.route).toEqual({ name: "/b", to: "/b" });
  });

  test("only fields the router gave are present", () => {
    const seen = renders();
    renderToString(() => <Router nav={{ kind: "navigation", initial: true, name: "/" }} />);
    expect(seen[0].event.route).toEqual({ name: "/" });
  });

  test("a non-initial ref declares nothing, and withOrigin is still the call it was", () => {
    const seen = renders();
    let ran = 0;
    const html = renderToString(() =>
      OBSERVE!.attribution.withOrigin({ kind: "navigation", name: "/x", to: "/x" }, () => {
        ran++;
        return <main>x</main>;
      })
    );
    expect(ran).toBe(1);
    expect(html).toContain(">x</main>");
    expect(seen[0].event.route).toBeUndefined();
  });

  test("a render with no router has no route", () => {
    const seen = renders();
    renderToString(() => <main>plain</main>);
    expect(seen).toHaveLength(1);
    expect("route" in seen[0].event).toBe(false);
  });

  test("with no render listener the declaration is a plain call", () => {
    let ran = 0;
    const html = renderToString(() =>
      OBSERVE!.attribution.withOrigin(USER, () => {
        ran++;
        return <main>x</main>;
      })
    );
    expect(ran).toBe(1);
    expect(html).toContain(">x</main>");
  });

  test("the server entry's withOrigin keeps the slot's other members", () => {
    const slot = OBSERVE!.attribution;
    expect(typeof slot.withInteraction).toBe("function");
    expect(typeof slot.currentOrigin).toBe("function");
    expect(slot.installed).toBeNull();
    expect(slot.withInteraction({ type: "click", target: "x" }, () => 3)).toBe(3);
    expect(slot.currentOrigin()).toBeUndefined();
  });
});
