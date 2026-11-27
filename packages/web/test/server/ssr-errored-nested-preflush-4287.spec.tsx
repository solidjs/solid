/**
 * @jsxImportSource @solidjs/web
 *
 * #4287 follow-up: an `<Errored>` whose content is more than the `<Loading>`
 * that fails, the failure landing before the shell is handed to the sink.
 * The Errored draws its fallback in the shell in place of its content, as
 * the client renders it, when that fallback is finished as it renders; the
 * shell never waits for it. The harness shapes (markup between, siblings)
 * are in hydration-harness.spec.tsx; these are the paths around them.
 */
import { describe, expect, test } from "vitest";
import { renderToStream, useHead } from "@solidjs/web";
import { createMemo, Errored, Loading } from "solid-js";
import { recordStream } from "./artifact-recorder.js";
import { hydrationRecordKeys } from "../harness/hydration-records.js";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const strip = (html: string) => html.replace(/<script[\s\S]*?<\/script>/g, "");

// The read fails at 5ms; `<b>{outer()}</b>` holds the shell to 15ms.
function useReads() {
  const outer = createMemo(async () => {
    await sleep(15);
    return "outer";
  });
  const user = createMemo(async (): Promise<string> => {
    await sleep(5);
    throw new Error("no user 7");
  });
  const failing = () => (
    <Loading fallback={<i>loading</i>}>
      <span>user:{user()}</span>
    </Loading>
  );
  return { outer, failing };
}

// What the server error hook heard: `<message> <handling>`.
function hookLog() {
  const heard: string[] = [];
  const onError = (e: unknown, site: { handling: string }) =>
    void heard.push(`${e instanceof Error ? e.message : String(e)} ${site.handling}`);
  return { heard, onError };
}

describe("#4287: a nested Loading failing before the shell", () => {
  test("awaited renderToStream: the Errored fallback replaces the element around the Loading", async () => {
    function App() {
      const { failing } = useReads();
      return (
        <main>
          <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
            <b>{failing()}</b>
          </Errored>
        </main>
      );
    }
    const html = await renderToStream(() => <App />);
    expect(strip(html)).toBe(`<main _hk=2><p _hk=40>failed: <!--$-->no user 7<!--/--></p></main>`);
    // The error at the Errored id ("3"), for the client to adopt the
    // fallback with; the failed fragment's channel rejects.
    expect(hydrationRecordKeys(html).sort()).toEqual(["0", "1", "3", "3010_fr"]);
  });

  test("inside a Loading that settled into the shell first", async () => {
    function App() {
      const { outer, failing } = useReads();
      const wrap = createMemo(async () => {
        await sleep(2);
        return "wrap";
      });
      return (
        <div>
          <Loading fallback={<i>outer loading</i>}>
            <em>{wrap()}</em>
            <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
              <section>{failing()}</section>
            </Errored>
          </Loading>
          <b>{outer()}</b>
        </div>
      );
    }
    const { shell, rest } = await recordStream(() => <App />);
    expect(strip(shell)).toContain(
      `<em _hk=4000>wrap</em><p _hk=40030>failed: <!--$-->no user 7<!--/--></p>`
    );
    expect(strip(shell)).not.toContain("<section");
    expect(strip(rest)).not.toContain("<template");
  });

  // A sibling `<Loading>` in the Errored settled while the Loading around
  // the Errored was still pending: its markup went into that Loading's,
  // which then went into the shell. The Errored's markup is found through
  // both.
  test("with a sibling Loading that settled inside a Loading still pending", async () => {
    function App() {
      const outer = createMemo(async () => {
        await sleep(30);
        return "outer";
      });
      const wrap = createMemo(async () => {
        await sleep(6);
        return "wrap";
      });
      const sib = createMemo(async () => {
        await sleep(2);
        return "sib";
      });
      const user = createMemo(async (): Promise<string> => {
        await sleep(12);
        throw new Error("no user 7");
      });
      return (
        <main>
          <Loading fallback={<i>outer loading</i>}>
            <em>{wrap()}</em>
            <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
              <section>
                <Loading fallback={<i>sib loading</i>}>
                  <u>{sib()}</u>
                </Loading>
                <Loading fallback={<i>loading</i>}>
                  <span>user:{user()}</span>
                </Loading>
              </section>
            </Errored>
          </Loading>
          <b>{outer()}</b>
        </main>
      );
    }
    const { heard, onError } = hookLog();
    const { shell, rest } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toBe(
      `<main _hk=4><!--$--><em _hk=5000>wrap</em><p _hk=50030>failed: <!--$-->no user 7<!--/--></p>` +
        `<!--/--><b>outer</b></main>`
    );
    expect(strip(rest)).toBe("");
    expect(hydrationRecordKeys(shell + rest)).toContain("5002");
    expect(heard).toEqual(["no user 7 fallback"]);
  });

  // The fallback's own failure is the next boundary up's (#4316): an outer
  // `<Errored>` whose markup is in the shell draws there, its fallback
  // replacing the inner one's whole region.
  test("a fallback that fails is met by the outer Errored", async () => {
    function App() {
      const { outer, failing } = useReads();
      const fail = (): string => {
        throw new Error("no hint");
      };
      return (
        <div>
          <Errored fallback={(e: any) => <h2>caught: {e().message}</h2>}>
            <article>
              <Errored
                fallback={(e: any) => (
                  <p>
                    failed: {e().message} {fail()}
                  </p>
                )}
              >
                <section>{failing()}</section>
              </Errored>
            </article>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell, rest } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toMatch(
      /^<div[^>]*><!--\$--><h2[^>]*>caught: <!--\$-->no hint<!--\/--><\/h2><!--\/--><b>outer<\/b><\/div>$/
    );
    expect(rest).not.toContain("<template");
    expect(heard.sort()).toEqual(["no hint fallback", "no user 7 fallback"]);
  });

  // With no `<Errored>` above to meet the fallback's failure, nothing is
  // drawn: the content stays, the failed Loading's position empty, and the
  // client renders the failure.
  test("a fallback that fails with no Errored above: nothing drawn, the client's", async () => {
    function App() {
      const { outer, failing } = useReads();
      const fail = (): string => {
        throw new Error("no hint");
      };
      return (
        <div>
          <Errored
            fallback={(e: any) => (
              <p>
                failed: {e().message} {fail()}
              </p>
            )}
          >
            <section>{failing()}</section>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell, rest } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toBe(
      `<div _hk=2><!--$--><section _hk=300></section><!--/--><b>outer</b></div>`
    );
    expect(hydrationRecordKeys(shell + rest)).not.toContain("3");
    expect(heard).toEqual(["no user 7 client"]);
  });

  // A hook mapping is the wire value: rendered into the fallback and
  // serialized, with the ids an unmapped render gives.
  test("a hook mapping reaches the drawn fallback", async () => {
    function App() {
      const { outer, failing } = useReads();
      return (
        <div>
          <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
            <section>
              <h1>title</h1>
              {failing()}
            </section>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const heard: string[] = [];
    const { shell } = await recordStream(() => <App />, {
      onError: (e: any, site: { handling: string }) => {
        heard.push(`${e.message} ${site.handling}`);
        return new Error("mapped");
      }
    });
    expect(strip(shell)).toBe(
      `<div _hk=2><!--$--><p _hk=40>failed: <!--$-->mapped<!--/--></p><!--/--><b>outer</b></div>`
    );
    expect(shell).toContain(`_$HY.r["3"]=$R[0]=new Error("mapped")`);
    expect(heard).toEqual(["no user 7 fallback"]);
  });
});

// The shell never waits for the fallback: drawn only when it is finished as
// it renders, otherwise the content stays as it was (the failed Loading's
// position empty), the client renders the failure, and the hook hears
// `client`.
describe("#4287: the shell never waits for the Errored fallback", () => {
  const content = (failing: () => any) => (
    <section>
      <h1>title</h1>
      {failing()}
    </section>
  );
  const blank =
    `<div _hk=2><!--$--><section _hk=300><h1>title</h1><!--$--><!--/--></section><!--/-->` +
    `<b>outer</b></div>`;

  test("a fallback finished as it renders is drawn", async () => {
    function App() {
      const { outer, failing } = useReads();
      const hint = createMemo(() => "HINT");
      return (
        <div>
          <Errored
            fallback={(e: any) => (
              <p>
                failed: {e().message} {hint()}
              </p>
            )}
          >
            {content(failing)}
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toBe(
      `<div _hk=3><!--$--><p _hk=50>failed: <!--$-->no user 7<!--/--> <!--$-->HINT<!--/--></p>` +
        `<!--/--><b>outer</b></div>`
    );
    expect(heard).toEqual(["no user 7 fallback"]);
  });

  test("an async fallback: the shell goes out when it is ready, without it", async () => {
    let landed = false;
    let landedAtShell: boolean | undefined;
    function App() {
      const user = createMemo(async (): Promise<string> => {
        throw new Error("no user 7");
      });
      const outer = createMemo(async () => {
        await sleep(15);
        return "outer";
      });
      const failing = () => (
        <Loading fallback={<i>loading</i>}>
          <span>user:{user()}</span>
        </Loading>
      );
      return (
        <div>
          <Errored
            fallback={(e: any) => {
              const hint = createMemo(async () => {
                await sleep(60);
                landed = true;
                return "HINT";
              });
              return (
                <p>
                  failed: {e().message} {hint()}
                </p>
              );
            }}
          >
            {content(failing)}
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell, rest } = await recordStream(() => <App />, {
      onError,
      onCompleteShell: () => void (landedAtShell = landed)
    });
    expect(landedAtShell).toBe(false);
    expect(strip(shell)).toBe(blank);
    expect(strip(rest)).toBe("");
    // Nothing of the fallback the server rendered and did not draw.
    expect(shell + rest).not.toContain("HINT");
    expect(hydrationRecordKeys(shell + rest).sort()).toEqual(["0", "1", "3010_fr"]);
    expect(heard).toEqual(["no user 7 client"]);
  });

  test("a fallback that never settles: the shell goes out and the response ends", async () => {
    function App() {
      const { outer, failing } = useReads();
      return (
        <div>
          <Errored
            fallback={(e: any) => {
              const hint = createMemo(() => new Promise<string>(() => {}));
              return (
                <p>
                  failed: {e().message} {hint()}
                </p>
              );
            }}
          >
            {content(failing)}
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell, rest } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toBe(blank);
    expect(strip(rest)).toBe("");
    expect(hydrationRecordKeys(shell + rest).sort()).toEqual(["0", "1", "3010_fr"]);
    expect(heard).toEqual(["no user 7 client"]);
  });

  // A fallback the server can never finish (a client-only hole in it).
  test("a fallback with a client-only hole: the content stays, the client's", async () => {
    function App() {
      const { outer, failing } = useReads();
      const client = createMemo(
        async () => {
          await sleep(1);
          return "client";
        },
        { ssrSource: "client" }
      );
      return (
        <div>
          <Errored fallback={(e: any) => <p>failed: {client()}</p>}>{content(failing)}</Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell } = await recordStream(() => <App />, { onError });
    // (`blank`, one id further on: the client memo takes one.)
    expect(strip(shell)).toBe(
      `<div _hk=3><!--$--><section _hk=400><h1>title</h1><!--$--><!--/--></section><!--/-->` +
        `<b>outer</b></div>`
    );
    expect(heard).toEqual(["no user 7 client"]);
  });
});

// Head registrations from the replaced content never commit: a client
// render that shows the fallback never ran that content. The fallback's
// own do.
describe("#4287: head tags of the replaced content", () => {
  function Title(props: { text: string }) {
    useHead({ tag: "title", props: { children: props.text } });
    return <em>{props.text}</em>;
  }
  function Meta() {
    useHead({ tag: "meta", props: { name: "content", content: "kept?" } });
    return null;
  }

  test("a settled sibling Loading's and the content's own are dropped", async () => {
    function App() {
      const { outer, failing } = useReads();
      const t = createMemo(async () => {
        await sleep(2);
        return "Sibling Title";
      });
      return (
        <html>
          <head></head>
          <body>
            <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
              <section>
                <Meta />
                <Loading fallback={<i>tl</i>}>
                  <Title text={t()} />
                </Loading>
                {failing()}
              </section>
            </Errored>
            <b>{outer()}</b>
          </body>
        </html>
      );
    }
    const { shell } = await recordStream(() => <App />);
    expect(strip(shell)).toContain("<head></head>");
    expect(strip(shell)).toContain(`failed: <!--$-->no user 7<!--/-->`);
  });

  test("the drawn fallback's are kept; an undrawn fallback's are dropped", async () => {
    function App(props: { async: boolean }) {
      const { outer, failing } = useReads();
      return (
        <html>
          <head></head>
          <body>
            <Errored
              fallback={(e: any) => {
                const hint = createMemo(async () => {
                  await sleep(60);
                  return "HINT";
                });
                return (
                  <>
                    <Title text="Failed" />
                    <p>
                      {e().message}
                      {props.async ? hint() : ""}
                    </p>
                  </>
                );
              }}
            >
              <section>{failing()}</section>
            </Errored>
            <b>{outer()}</b>
          </body>
        </html>
      );
    }
    const drawn = await recordStream(() => <App async={false} />);
    expect(strip(drawn.shell)).toContain(`<title data-dh="title">Failed</title>`);
    const undrawn = await recordStream(() => <App async />);
    expect(strip(undrawn.shell)).toContain("<head></head>");
    expect(strip(undrawn.shell)).not.toContain("Failed");
  });
});

// The Errored's markup is found in the held shell by its text. Markup with
// no place of its own there — nothing of it rendered into the page, text
// alone, or a boundary that was never inserted — is not replaced: the
// shell is as before and the failure is the client's. Never an outer
// boundary's either, which the client would not show for it.
describe("#4287: markup with no place of its own in the shell is not replaced", () => {
  // Renders its children (their boundaries are created and run) and inserts
  // none of them, as a tab set does for the tabs it does not show.
  function Hidden(props: { children: any }) {
    let c = props.children;
    while (typeof c === "function") c = c();
    return null;
  }

  test("an Errored that rendered nothing into the page", async () => {
    function App() {
      const { outer, failing } = useReads();
      return (
        <div>
          <h1>head</h1>
          <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
            <Hidden>{failing()}</Hidden>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell, rest } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toBe(`<div _hk=2><h1>head</h1><!--$--><!--/--><b>outer</b></div>`);
    expect(hydrationRecordKeys(shell + rest)).not.toContain("3");
    expect(heard).toEqual(["no user 7 client"]);
  });

  test("text alone, the same text earlier in the page", async () => {
    function App() {
      const { outer, failing } = useReads();
      return (
        <div>
          <h1>item list</h1>
          <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
            item<Hidden>{failing()}</Hidden>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell, rest } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toBe(
      `<div _hk=2><h1>item list</h1><!--$-->item<!--/--><b>outer</b></div>`
    );
    expect(hydrationRecordKeys(shell + rest)).not.toContain("3");
    expect(heard).toEqual(["no user 7 client"]);
  });

  test("an Errored that was not inserted: the Errored around it keeps its content", async () => {
    function App() {
      const { outer, failing } = useReads();
      return (
        <div>
          <Errored fallback={(e: any) => <h2>outer: {e().message}</h2>}>
            <article>
              <p>shown</p>
              <Hidden>
                <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
                  <section>{failing()}</section>
                </Errored>
              </Hidden>
            </article>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell, rest } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toBe(
      `<div _hk=2><!--$--><article _hk=300><p>shown</p><!--$--><!--/--></article><!--/-->` +
        `<b>outer</b></div>`
    );
    expect(hydrationRecordKeys(shell + rest)).not.toContain("3");
    expect(heard).toEqual(["no user 7 client"]);
  });

  // The Loading itself not inserted, the Errored's markup in the page: the
  // failure is the Errored's, as on the client.
  test("a Loading that was not inserted fails its Errored, whose markup is found", async () => {
    function App() {
      const { outer, failing } = useReads();
      return (
        <div>
          <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
            <article>
              <p>shown</p>
              <Hidden>{failing()}</Hidden>
            </article>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { shell } = await recordStream(() => <App />);
    expect(strip(shell)).toBe(
      `<div _hk=2><!--$--><p _hk=40>failed: <!--$-->no user 7<!--/--></p><!--/--><b>outer</b></div>`
    );
  });
});

// The fallback rendered again with the hook's mapping (it read the error):
// at the same ids, joining what the first render started.
describe("#4287: a fallback rendered again with the hook's mapping", () => {
  const mapped = () => {
    const heard: string[] = [];
    const onError = (e: any, site: { handling: string }) => {
      heard.push(`${e.message} ${site.handling}`);
      return site.handling === "fallback" ? new Error("mapped") : undefined;
    };
    return { heard, onError };
  };

  for (const ms of [2, 40])
    test(`a Loading in the fallback keeps its fragment and its serialized value (${ms}ms)`, async () => {
      function Help() {
        const help = createMemo(async () => {
          await sleep(ms);
          return "HELP";
        });
        return <em>{help()}</em>;
      }
      function App() {
        const { outer, failing } = useReads();
        return (
          <div>
            <Errored
              fallback={(e: any) => (
                <p>
                  failed: {e().message}
                  <Loading fallback={<i>help loading</i>}>
                    <Help />
                  </Loading>
                </p>
              )}
            >
              <section>{failing()}</section>
            </Errored>
            <b>{outer()}</b>
          </div>
        );
      }
      const { heard, onError } = mapped();
      const { shell, rest } = await recordStream(() => <App />, { onError });
      expect(strip(shell)).toContain(`failed: <!--$-->mapped<!--/-->`);
      // The memo under the fallback's Loading ("42"): its value is on the
      // wire, so the hydrating client does not ask again.
      expect(hydrationRecordKeys(shell + rest)).toEqual(
        expect.arrayContaining(["3", "42_fr", "42000"])
      );
      expect(shell + rest).toContain(`"HELP"`);
      expect(strip(shell + rest).match(/<em _hk=42001>HELP<\/em>/g)).toHaveLength(1);
      expect(heard).toEqual(["no user 7 fallback"]);
    });

  // Known limit: the hook has heard `fallback` when the second render turns
  // out not to be drawable. Nothing is drawn and no error is serialized at
  // the Errored, so the client renders the failure, as for `client`.
  test("the second render throws: nothing drawn, the hook has heard `fallback`", async () => {
    function App() {
      const { outer, failing } = useReads();
      return (
        <div>
          <Errored
            fallback={(e: any) => {
              if (e().message === "mapped") throw new Error("no fallback for mapped");
              return <p>failed: {e().message}</p>;
            }}
          >
            <section>{failing()}</section>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = mapped();
    const { shell, rest } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toBe(
      `<div _hk=2><!--$--><section _hk=300></section><!--/--><b>outer</b></div>`
    );
    expect(hydrationRecordKeys(shell + rest)).not.toContain("3");
    expect(heard).toEqual(["no user 7 fallback"]);
  });
});

// A failure nothing draws for is reported as before: the hook hears
// `client` for each.
describe("#4287: failures no Errored draws for are still reported", () => {
  const fail = (message: string, ms: number) =>
    createMemo(async (): Promise<string> => {
      await sleep(ms);
      throw new Error(message);
    });

  test("a Loading failing inside a Loading that already failed", async () => {
    function App() {
      const { outer } = useReads();
      const a = fail("A", 4);
      const b = fail("B", 8);
      return (
        <div>
          <Loading fallback={<i>la</i>}>
            <section>
              {a()}
              <Loading fallback={<i>lb</i>}>
                <span>{b()}</span>
              </Loading>
            </section>
          </Loading>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    await recordStream(() => <App />, { onError });
    expect(heard).toEqual(["A client", "B client"]);
  });

  // A thrown value that is not an object has no verdict to dedupe on: the
  // boundary that draws for it is the only one to report it.
  test("a thrown string the Errored draws for is heard once, as `fallback`", async () => {
    function App() {
      const { outer } = useReads();
      const user = createMemo(async (): Promise<string> => {
        await sleep(5);
        throw "no user";
      });
      return (
        <div>
          <Errored fallback={(e: any) => <p>failed: {String(e())}</p>}>
            <section>
              <Loading fallback={<i>loading</i>}>
                <span>{user()}</span>
              </Loading>
            </section>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toContain(`failed: <!--$-->no user<!--/-->`);
    expect(heard).toEqual(["no user fallback"]);
  });

  test("a second Loading failing in content the Errored already replaced", async () => {
    function App() {
      const { outer, failing } = useReads();
      const second = fail("second", 8);
      return (
        <div>
          <Errored fallback={(e: any) => <p>failed: {e().message}</p>}>
            <section>
              {failing()}
              <Loading fallback={<i>l2</i>}>
                <em>{second()}</em>
              </Loading>
            </section>
          </Errored>
          <b>{outer()}</b>
        </div>
      );
    }
    const { heard, onError } = hookLog();
    const { shell } = await recordStream(() => <App />, { onError });
    expect(strip(shell)).toContain(`failed: <!--$-->no user 7<!--/-->`);
    expect(heard).toEqual(["no user 7 fallback", "second client"]);
  });
});
