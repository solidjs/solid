/**
 * @jsxImportSource @solidjs/web
 */
/**
 * #3815 — a retry pass re-creates a component under the same owner ids while
 * its async memo is still in flight. The re-created memo joins the pending
 * slot (`ctx[SLOTS]`, server signals.ts) and must take the slot's answer when
 * the earlier flight settles it, or a memo reading it retries on that settled
 * promise in microtasks forever and no timer ever fires again.
 */
import { describe, expect, test } from "vitest";
import { renderToStream } from "@solidjs/web";
import {
  createComponent as h,
  createContext,
  createMemo,
  Errored,
  lazy,
  Loading,
  Show
} from "solid-js";

const delay = <T,>(value: T, ms: number) => new Promise<T>(r => setTimeout(() => r(value), ms));

// Microtask starvation blocks every timer, so the guard lives in the memo.
const RUN_CAP = 10_000;

function render(code: () => any) {
  return new Promise<string>((resolve, reject) => {
    let html = "";
    renderToStream(code, { manifest: {}, onError: reject } as any).pipe({
      write: (c: unknown) => void (html += String(c)),
      end: () => resolve(html)
    } as any);
  }).then(
    html => ({ html, error: undefined }),
    error => ({ html: "", error: String(error) })
  );
}

describe("#3815 a re-created memo joining a pending slot", () => {
  test("the issue's shape: a hole returning a pending lazy view", async () => {
    const Profile = lazy(() => delay({ default: (props: any) => <h1>{props.user.name}</h1> }, 5));
    let runs = 0;
    function Page() {
      const user = createMemo(() => delay({ name: "Jon" }, 20));
      const info = createMemo(() => {
        if (++runs > RUN_CAP) throw new Error("info memo did not converge");
        user();
        return delay(["a", "b"], 20);
      });
      return <Profile user={user()} info={info()} />;
    }
    const out = await render(() => <main>{(() => <Page />) as any}</main>);
    expect(out.error).toBeUndefined();
    expect(runs).toBeLessThan(10);
    expect(out.html).toContain("Jon</h1>");
  });

  // An <Errored> retry re-creating a pending <Loading> (#3750's shape) with a
  // fresh promise per setup and a memo reading it.
  test.each([false, true])(
    "an Errored retry re-creating a pending Loading settles its reader (async reader: %s)",
    async asyncInfo => {
      let runs = 0;
      const Page = () => {
        const user = createMemo(() => delay({ name: "Jon" }, 30));
        const info = createMemo(() => {
          if (++runs > RUN_CAP) throw new Error("info memo did not converge");
          const name = user().name;
          return asyncInfo ? delay(name, 5) : name;
        });
        return h(Loading, {
          fallback: "pending",
          get children() {
            return h(Show, {
              get when() {
                return info();
              },
              children: (n: any) => n()
            } as any);
          }
        });
      };
      const Context = createContext<boolean>();
      const App = () => {
        const later = createMemo(() => delay("LATER", 10));
        return h(Context as any, {
          value: true,
          get children() {
            return [
              h(Errored, {
                fallback: (e: any) => e().message,
                get children() {
                  return h(Page, {});
                }
              }),
              () => later()
            ];
          }
        });
      };
      const out = await render(() => h(App, {}));
      expect(out.error).toBeUndefined();
      expect(runs).toBeLessThan(20);
      expect(out.html).toContain("Jon");
    }
  );
});
