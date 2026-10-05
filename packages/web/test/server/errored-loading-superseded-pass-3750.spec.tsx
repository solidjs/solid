/**
 * #3750 — an `<Errored>` retry re-renders its children, disposing the pass
 * that created a pending `<Loading>`. The abandoned boundary instance must
 * stop retrying, must not hold the response open, and must not settle the
 * fragment id a re-created boundary now owns.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { renderToStream } from "@solidjs/web";
import { createComponent as h, createContext, createMemo, Errored, Loading, Show } from "solid-js";

const delay = <T,>(ms: number, v?: T) => new Promise<T>(r => setTimeout(() => r(v as T), ms));

// The abandoned pass loops on after the response has ended (#3750 renders
// fine and fails in the background), so each render also waits out the
// discovery budget before its errors are read.
async function render(code: () => any, errors: string[]) {
  const html = await Promise.race([
    new Promise<string>(resolve => {
      let html = "";
      renderToStream(code, {
        onError: (e: any) => void errors.push(String(e?.message ?? e))
      }).pipe({
        write: (c: unknown) => void (html += String(c)),
        end: () => resolve(html)
      } as any);
    }),
    delay(2000, "TIMEOUT")
  ]);
  await delay(300);
  return html;
}

describe("#3750 Errored around a pending Loading", () => {
  let errors: string[];
  let spy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errors = [];
    spy = vi.spyOn(console, "error").mockImplementation((...args: any[]) => {
      errors.push(args.map(a => String(a?.message ?? a)).join(" "));
    });
  });
  afterEach(() => spy.mockRestore());

  // The issue's reproduction: a stable promise under Errored > Loading > Show,
  // next to an async sibling that re-renders the Errored's pass.
  function app(outer: boolean, page: () => any) {
    const Context = createContext<boolean>();
    const Page = () => page();
    const Shell = () =>
      h(Errored, {
        fallback: (e: any) => e().message,
        get children() {
          return h(Page, {});
        }
      });
    return () => {
      const later = createMemo(() => delay(10, "LATER"));
      return h(Context as any, {
        value: true,
        get children() {
          return [
            outer
              ? h(Loading, {
                  fallback: "outer",
                  get children() {
                    return h(Shell, {});
                  }
                })
              : h(Shell, {}),
            () => later()
          ];
        }
      });
    };
  }
  function sessionPage(session: Promise<string>) {
    return () => {
      const s = createMemo(() => session);
      return h(Loading, {
        fallback: "pending",
        get children() {
          return h(Show, {
            get when() {
              return s();
            },
            children: () => "SESSION_READY"
          } as any);
        }
      });
    };
  }

  test.each([false, true])(
    "settles without a convergence error (outer Loading: %s)",
    async outer => {
      const html = await render(app(outer, sessionPage(delay(30, "s"))), errors);
      expect(html).not.toBe("TIMEOUT");
      expect(errors.filter(e => e.includes("did not converge"))).toEqual([]);
      expect(html).toContain("SESSION_READY");
    }
  );

  test("a re-render that does not re-create the boundary does not hold the response", async () => {
    const session = delay(30, "s");
    let renders = 0;
    const page = sessionPage(session);
    const html = await render(
      app(false, () => (renders++ === 0 ? page() : "<gone>")),
      errors
    );
    expect(html).not.toBe("TIMEOUT");
    expect(errors.filter(e => e.includes("did not converge"))).toEqual([]);
    expect(renders).toBeGreaterThan(1);
    expect(html).not.toContain("SESSION_READY");
  });

  test("the re-created boundary's placeholder receives its own content, not blank markup", async () => {
    // The abandoned instance resumes after its successor registered the same
    // fragment id; settling it would swap blank markup into the successor's
    // placeholder and turn the successor's own settle into a no-op.
    let renders = 0;
    const page = sessionPage(delay(30, "s"));
    const html = await render(
      app(false, () => (renders++, page())),
      errors
    );
    expect(renders).toBeGreaterThan(1);
    const key = /<template id="pl-(\w+)">/.exec(html)?.[1];
    expect(key).toBeDefined();
    expect(html.split(`<template id="${key}">`).length - 1).toBe(1);
    expect(html).toContain(`<template id="${key}">SESSION_READY</template>`);
  });
});
