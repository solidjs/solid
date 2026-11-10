/**
 * @jsxImportSource @solidjs/web
 *
 * A failure an `<Errored>` already contained, whose error the default
 * serializer cannot encode (#4709 review). Since #4709 a value that fails to
 * serialize before the first flush fails the render. An error an `<Errored>`
 * contained is not such a value: the render keeps the fallback and
 * completes, the boundary's record and the rejection of the source it came
 * from (deferStream or streamed) go out as a plain `Error` with the message,
 * and the hook hears the serializer's failure once, however many records
 * carry the same error. A rejection nothing contained fails the render, and
 * so does a value that fails to serialize, inside a boundary too.
 *
 * The source runs as the dev tier (fidelity: the original is the wire). The
 * production tier is the built artifacts' (stream-contained-error-serialize-
 * 4709.fixture.mjs, in a child Node): its default record is the generic
 * Error, which encodes; an error branded with `markSafeError`, or a hook's
 * mapping, keeps its fields in every tier. Requires a prior `pnpm build`.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import vm from "node:vm";
import { beforeAll, describe, expect, test } from "vitest";
import {
  createRequestEvent,
  createSSRResponse,
  Errored,
  getHydrationWriter,
  Loading,
  renderToStream,
  type ServerErrorContext
} from "@solidjs/web";
import { provideRequestEvent } from "../../storage/src/index.js";
import { createMemo } from "solid-js";
import { settle, watchEscapes } from "./stream-settle-harness.js";

const unserializable = (message = "x") => Object.assign(new Error(message), { fn() {} });
/** A rejection that lands after the render pass, as a fetch's does. */
const later = () =>
  new Promise<never>((_, reject) => setTimeout(() => reject(unserializable()), 10));

/** The hydration registry the page's scripts build, run as a browser would. */
function registry(html: string) {
  const sandbox: any = {
    document: { getElementById: () => null, addEventListener() {} },
    _$HY: { r: {}, fe() {} }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const [, src] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(src, sandbox);
  }
  const records = sandbox._$HY.r as Record<string, any>;
  // A rejected record is read off its mark; nothing here awaits it.
  for (const record of Object.values(records))
    if (tag(record) === "Promise") record.catch(() => {});
  return records;
}
const tag = (v: unknown) => Object.prototype.toString.call(v).slice(8, -1);
const shape = (e: any) => ({ message: e.message, keys: Object.keys(e) });
/** Each Error record as the client reads it: its message and own keys. */
const errorRecords = (html: string) =>
  Object.values(registry(html))
    .filter(v => tag(v) === "Error")
    .map(shape);
/** Each promise the page rejected, read off seroval's mark as the hydrating client reads it. */
const rejections = (html: string) =>
  Object.values(registry(html))
    .filter(v => tag(v) === "Promise" && v.s === 2)
    .map(v => shape(v.v));
const main = (html: string) =>
  /<main[\s\S]*?<\/main>/.exec(html.replace(/ _hk=[^\s>]*/g, ""))?.[0] ?? "";

interface Rendered {
  html: string;
  completed: boolean;
  heard: string[];
  /** The response's, when `createSSRResponse` consumed the stream. */
  status?: number;
}
const consumers = ["await", "pipe", "pipeTo", "response"] as const;
type Consume = (typeof consumers)[number];
type ErrorMap = (error: unknown, context: ServerErrorContext) => unknown;
async function stream(
  code: () => any,
  consume: Consume = "await",
  map?: ErrorMap
): Promise<Rendered> {
  const heard: string[] = [];
  let completed = false;
  let status: number | undefined;
  let result: { state: string; html: string } | undefined;
  const render = () =>
    renderToStream(code, {
      onError(error: unknown, c: ServerErrorContext) {
        heard.push(`${c.kind}/${c.handling}`);
        return map?.(error, c);
      },
      onCompleteAll() {
        completed = true;
      }
    });
  const consumed = (): PromiseLike<string> => {
    if (consume === "await") return render();
    const chunks: string[] = [];
    if (consume === "pipe")
      return new Promise(resolve =>
        render().pipe({
          write: (chunk: string) => void chunks.push(String(chunk)),
          end: () => resolve(chunks.join(""))
        })
      );
    if (consume === "pipeTo")
      return render()
        .pipeTo(
          new WritableStream({
            write: chunk => void chunks.push(new TextDecoder().decode(chunk))
          })
        )
        .then(() => chunks.join(""));
    const event = createRequestEvent(new Request("https://example.com/"));
    return provideRequestEvent(event, async () => {
      const response = await createSSRResponse(render(), event);
      status = response.status;
      return response.text();
    });
  };
  const escaped = await watchEscapes(async () => {
    result = await settle(consumed());
  });
  expect(escaped).toEqual([]);
  expect(result!.state).toBe("settled");
  return { html: result!.html, completed, heard, status };
}

const plain = (message: string) => ({ message, keys: [] });
interface Contained {
  code: () => any;
  main: string | RegExp;
  records: unknown[];
  /** The promises the page rejected, when the source is streamed. */
  rejected?: unknown[];
  heard: string[];
  map?: ErrorMap;
}
const mapFallback: ErrorMap = (_, context) =>
  context.handling === "fallback" ? new Error("mapped") : undefined;
const contained: [string, Contained][] = [
  [
    "a deferStream rejection (the review's repro)",
    {
      code: () => {
        const data = createMemo(() => Promise.reject(unserializable()), { deferStream: true });
        return (
          <main>
            <Errored fallback={<p>fallback</p>}>{data()}</Errored>
          </main>
        );
      },
      main: "<main><p>fallback</p></main>",
      // The boundary's record; the source's promise rejects with the same
      // replacement, as a streamed source's does (#4747).
      records: [plain("x")],
      rejected: [plain("x")],
      heard: ["render/fallback", "render/serialize"]
    }
  ],
  [
    "a synchronous throw",
    {
      code: () => {
        const Thrower = () => {
          throw unserializable();
        };
        return (
          <main>
            <Errored fallback={<p>fallback</p>}>
              <Thrower />
            </Errored>
          </main>
        );
      },
      main: "<main><p>fallback</p></main>",
      records: [plain("x")],
      heard: ["render/fallback", "render/serialize"]
    }
  ],
  [
    "a streamed rejection (no deferStream)",
    {
      code: () => {
        const data = createMemo(() => Promise.reject(unserializable()));
        return (
          <main>
            <Errored fallback={<p>fallback</p>}>{data()}</Errored>
          </main>
        );
      },
      main: "<main><p>fallback</p></main>",
      // The boundary's record; the source's promise rejects with the same replacement.
      records: [plain("x")],
      rejected: [plain("x")],
      heard: ["render/fallback", "render/serialize"]
    }
  ],
  [
    "a deferStream rejection that lands after the render pass",
    {
      code: () => {
        const data = createMemo(later, { deferStream: true });
        return (
          <main>
            <Errored fallback={<p>fallback</p>}>{data()}</Errored>
          </main>
        );
      },
      main: "<main><p>fallback</p></main>",
      records: [plain("x")],
      rejected: [plain("x")],
      heard: ["render/fallback", "render/serialize"]
    }
  ],
  [
    "a streamed rejection that lands after the render pass",
    {
      code: () => {
        const data = createMemo(later);
        return (
          <main>
            <Errored fallback={<p>fallback</p>}>{data()}</Errored>
          </main>
        );
      },
      main: "<main><p>fallback</p></main>",
      records: [plain("x")],
      rejected: [plain("x")],
      heard: ["render/fallback", "render/serialize"]
    }
  ],
  [
    "a streamed rejection two boundaries read",
    {
      code: () => {
        const data = createMemo(() => Promise.reject(unserializable()));
        return (
          <main>
            <Errored fallback={<p>one</p>}>{data()}</Errored>
            <Errored fallback={<p>two</p>}>{data()}</Errored>
          </main>
        );
      },
      main: /^<main>(<!--\$-->)?<p>one<\/p>(<!--\/-->)?(<!--\$-->)?<p>two<\/p>(<!--\/-->)?<\/main>$/,
      records: [plain("x"), plain("x")],
      rejected: [plain("x")],
      heard: ["render/fallback", "render/serialize"]
    }
  ],
  [
    "a hook's mapping: the deferStream source keeps its own error",
    {
      code: () => {
        const data = createMemo(() => Promise.reject(unserializable()), { deferStream: true });
        return (
          <main>
            <Errored fallback={(err: any) => <p>{err().message}</p>}>{data()}</Errored>
          </main>
        );
      },
      map: mapFallback,
      main: /^<main><p>(<!--\$-->)?mapped(<!--\/-->)?<\/p><\/main>$/,
      // The source's promise rejects with what its channel rejected with; the record is the mapping.
      records: [plain("mapped")],
      rejected: [plain("x")],
      heard: ["render/fallback", "render/serialize"]
    }
  ],
  [
    "a hook's mapping: the streamed source keeps its own error",
    {
      code: () => {
        const data = createMemo(() => Promise.reject(unserializable()));
        return (
          <main>
            <Errored fallback={(err: any) => <p>{err().message}</p>}>{data()}</Errored>
          </main>
        );
      },
      map: mapFallback,
      main: /^<main><p>(<!--\$-->)?mapped(<!--\/-->)?<\/p><\/main>$/,
      records: [plain("mapped")],
      rejected: [plain("x")],
      heard: ["render/fallback", "render/serialize"]
    }
  ],
  [
    "nested: the inner boundary contains it",
    {
      code: () => {
        const data = createMemo(() => Promise.reject(unserializable()), { deferStream: true });
        return (
          <main>
            <Errored fallback={<p>outer</p>}>
              <Errored fallback={<p>inner</p>}>{data()}</Errored>
            </Errored>
          </main>
        );
      },
      main: "<main><p>inner</p></main>",
      records: [plain("x")],
      rejected: [plain("x")],
      heard: ["render/fallback", "render/serialize"]
    }
  ],
  [
    "nested: an inner fallback that throws is the outer boundary's",
    {
      code: () => {
        const data = createMemo(() => Promise.reject(unserializable("inner")), {
          deferStream: true
        });
        return (
          <main>
            <Errored fallback={(err: any) => <p>{err().message}</p>}>
              <Errored
                fallback={() => {
                  throw unserializable("outer");
                }}
              >
                {data()}
              </Errored>
            </Errored>
          </main>
        );
      },
      main: /^<main><p>(<!--\$-->)?outer(<!--\/-->)?<\/p><\/main>$/,
      records: [plain("outer"), plain("inner")],
      rejected: [plain("inner")],
      heard: ["render/fallback", "render/fallback", "render/serialize", "render/serialize"]
    }
  ]
];

// The thenable hands every write over at the end, in key order, after the
// boundaries ran. A streamed render meets the source's rejection first and
// its boundary on the shell's pull, so the hook hears the same failures in
// the other order.
describe.each(consumers)("dev tier, %s", consume => {
  const order = (heard: string[]) => (consume === "await" ? heard : [...heard].sort());

  describe.each(contained)("%s", (_, scenario) => {
    let rendered: Rendered;
    beforeAll(async () => {
      rendered = await stream(scenario.code, consume, scenario.map);
    });

    test("keeps the fallback and completes", () => {
      expect(main(rendered.html)).toMatch(scenario.main);
      expect(rendered.completed).toBe(true);
      if (consume === "response") expect(rendered.status).toBe(200);
    });

    test("sends the record as a plain Error and hears each error once", () => {
      expect(errorRecords(rendered.html)).toEqual(scenario.records);
      expect(rejections(rendered.html)).toEqual(scenario.rejected ?? []);
      expect(order(rendered.heard)).toEqual(order(scenario.heard));
    });
  });
});

// After the first flush a failed record used to be omitted (#4227); the
// boundary's markup is the fallback either way, and now its record is too.
test("dev tier: a record written after the first flush is sent plain as well", async () => {
  let release!: () => void;
  const gate = new Promise<void>(r => (release = r));
  const heard: string[] = [];
  let completed = false;
  let result: { state: string; html: string } | undefined;
  const escaped = await watchEscapes(async () => {
    result = await settle(
      new Promise<string>(done => {
        const chunks: string[] = [];
        renderToStream(
          () => {
            const Thrower = () => {
              const ready = createMemo(() => gate.then(() => "ready"));
              ready();
              throw unserializable();
            };
            return (
              <main>
                <Loading fallback="pending">
                  <Errored fallback={<p>fallback</p>}>
                    <Thrower />
                  </Errored>
                </Loading>
              </main>
            );
          },
          {
            onError: (_: unknown, c: ServerErrorContext) =>
              void heard.push(`${c.kind}/${c.handling}`),
            onCompleteAll() {
              completed = true;
            }
          }
        ).pipe({
          write(chunk: string) {
            chunks.push(String(chunk));
            if (chunks.length === 1) {
              expect(chunks[0]).toContain("pending");
              release();
            }
          },
          end() {
            done(chunks.join(""));
          }
        });
      })
    );
  });
  expect(escaped).toEqual([]);
  expect(result!.state).toBe("settled");
  expect(completed).toBe(true);
  expect(result!.html).toContain("<p");
  expect(result!.html).toContain(">fallback</p>");
  expect(errorRecords(result!.html)).toEqual([plain("x")]);
  expect(heard).toEqual(["render/fallback", "render/serialize"]);
});

describe("unchanged", () => {
  test("a serializable error keeps its record and the hook hears only the fallback", async () => {
    const { html, completed, heard } = await stream(() => {
      const data = createMemo(() => Promise.reject(Object.assign(new Error("x"), { code: 42 })), {
        deferStream: true
      });
      return (
        <main>
          <Errored fallback={<p>fallback</p>}>{data()}</Errored>
        </main>
      );
    });
    expect(main(html)).toBe("<main><p>fallback</p></main>");
    expect(completed).toBe(true);
    expect(heard).toEqual(["render/fallback"]);
    // The boundary's record, and the source's rejection (#4747).
    expect(errorRecords(html)).toEqual([{ message: "x", keys: ["code"] }]);
    expect(rejections(html)).toEqual([{ message: "x", keys: ["code"] }]);
  });

  test("a value that fails to serialize fails the render inside a boundary too (#4709)", async () => {
    const { html, completed, heard } = await stream(() => {
      const data = createMemo(() => Promise.resolve(() => "fn"), { deferStream: true });
      return (
        <main>
          <Errored fallback={<p>fallback</p>}>{typeof data()}</Errored>
        </main>
      );
    });
    expect(html).toBe("");
    expect(completed).toBe(false);
    expect(heard).toEqual(["render/serialize"]);
  });

  test("an uncaught rejection fails the render", async () => {
    const { html, completed, heard } = await stream(() => {
      const data = createMemo(() => Promise.reject(unserializable()), { deferStream: true });
      return <main>{data()}</main>;
    });
    expect(html).toBe("");
    expect(completed).toBe(false);
    expect(heard).toEqual(["render/failed"]);
  });

  // What a component hands the writer no boundary reads, so nothing contains
  // its rejection: an `<Errored>` around the component caught nothing.
  describe.each(consumers)("a rejection nothing contains, %s", consume => {
    const fails = ({ html, completed, heard, status }: Rendered) => {
      expect(html).toBe("");
      expect(completed).toBe(false);
      expect(heard).toEqual(["render/serialize"]);
      if (consume === "response") expect(status).toBe(500);
    };

    test.each([
      ["a deferStream write", { deferStream: true }],
      ["a streamed write", undefined]
    ] as const)("%s fails the render", async (_, options) => {
      fails(
        await stream(() => {
          getHydrationWriter()!.write("lib:rejected", Promise.reject(unserializable()), options);
          return <main>page</main>;
        }, consume)
      );
    });

    test("a deferStream write under an <Errored> that does not read it fails the render", async () => {
      const rendered = await stream(() => {
        const Writes = () => {
          getHydrationWriter()!.write("lib:rejected", Promise.reject(unserializable()), {
            deferStream: true
          });
          return <i>written</i>;
        };
        return (
          <main>
            <Errored fallback={<p>fallback</p>}>
              <Writes />
            </Errored>
          </main>
        );
      }, consume);
      fails(rendered);
    });
  });
});

// A piped render meets the rejection before the shell pulls the root holes
// again, which is where a boundary at the root contains it. The failure waits
// for that pull and no longer than that.
describe("dev tier, a rejection met ahead of its boundary", () => {
  test.each([true, false])(
    "contained (deferStream=%s): a slow sibling at the root does not fail it",
    async deferStream => {
      const { html, completed, heard } = await stream(() => {
        const slow = createMemo(() => new Promise<string>(r => setTimeout(() => r("slow"), 30)));
        const data = createMemo(() => Promise.reject(unserializable()), { deferStream });
        return (
          <main>
            <h1>{slow()}</h1>
            <Errored fallback={<p>fallback</p>}>{data()}</Errored>
          </main>
        );
      }, "pipe");
      expect(main(html)).toContain("slow");
      expect(main(html)).toContain("<p>fallback</p>");
      expect(completed).toBe(true);
      expect([...heard].sort()).toEqual(["render/fallback", "render/serialize"]);
    }
  );

  test("nothing contains it: a sibling that never settles does not hold the render open", async () => {
    const { html, completed, heard } = await stream(() => {
      const writer = getHydrationWriter()!;
      writer.write("lib:rejected", Promise.reject(unserializable()), { deferStream: true });
      writer.write("lib:pending", new Promise(() => {}), { deferStream: true });
      return <main>page</main>;
    }, "pipe");
    expect(html).toBe("");
    expect(completed).toBe(false);
    expect(heard).toEqual(["render/serialize"]);
  });
});

const FIXTURE = resolve(import.meta.dirname, "stream-contained-error-serialize-4709.fixture.mjs");
type Artifacts = { isDev: boolean } & Record<
  "plain" | "safe" | "mapped" | "streamed" | "uncaught",
  Rendered
>;
function artifacts(conditions: string[]): Artifacts {
  return JSON.parse(
    execFileSync(process.execPath, [...conditions.map(c => `--conditions=${c}`), FIXTURE], {
      cwd: process.cwd(),
      encoding: "utf8",
      // A handle left open must not hang collection, and a failed import keeps its stderr.
      timeout: 10_000,
      stdio: ["ignore", "pipe", "pipe"]
    })
  );
}
const fallback = (scenario: Rendered) =>
  /<p class="fallback">([^<]*)<\/p>/.exec(scenario.html)?.[1];

describe.each([
  ["production", [], false, "Internal Server Error"],
  ["development", ["development"], true, "x"]
] as const)("the %s artifacts", (_, conditions, dev, plainWire) => {
  const results = artifacts([...conditions]);

  test("resolve the tier under test", () => {
    expect(results.isDev).toBe(dev);
  });

  describe.each([
    // The default policy. Production's generic Error encodes; dev's original does not.
    ["the default policy", "plain", plainWire, dev ? 1 : 0],
    // Branded safe: the original reaches the wire in every tier.
    ["markSafeError", "safe", "visible", 1],
    // The hook's mapping is the boundary's record in every tier.
    ["a hook's mapping", "mapped", "mapped", 1],
    // A streamed source: its promise rejects with the record's replacement.
    ["markSafeError, streamed", "streamed", "visible", 1]
  ] as const)("%s", (_, key, wire, failures) => {
    test("keeps the fallback and completes", () => {
      expect(results[key].completed).toBe(true);
      expect(fallback(results[key])).toBe(wire);
    });

    test("every record the client reads is a plain Error, the failure heard once", () => {
      const records = [...errorRecords(results[key].html), ...rejections(results[key].html)];
      expect(records.map(r => r.message)).toContain(wire);
      expect(records.every(r => r.keys.length === 0)).toBe(true);
      // Every source rejects as a rejection (#4747), with what its channel
      // rejected with: a hook's mapping is the boundary's record only.
      expect(rejections(results[key].html)).toEqual([plain(key === "mapped" ? plainWire : wire)]);
      expect(results[key].heard).toEqual([
        "render/fallback",
        ...Array(failures).fill("render/serialize")
      ]);
    });
  });

  test("a rejection nothing contains fails the render", () => {
    expect(results.uncaught.html).toBe("");
    expect(results.uncaught.completed).toBe(false);
    expect(results.uncaught.heard).toEqual(["render/serialize"]);
  });
});
