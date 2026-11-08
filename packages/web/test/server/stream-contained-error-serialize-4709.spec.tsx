/**
 * @jsxImportSource @solidjs/web
 *
 * A failure an `<Errored>` already contained, whose error the default
 * serializer cannot encode (#4709 review). Since #4709 a value that fails to
 * serialize before the first flush fails the render. An error record is not
 * such a value: the boundary's record and a deferStream source's rejection
 * belong to a failure that was contained, or that fails the render on its
 * own. So the render keeps the fallback and completes, the record goes out
 * as a plain `Error` with the message, and the hook hears the serializer's
 * failure once, however many records carry the same error. A value that
 * fails to serialize still fails the render, inside a boundary too.
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
  return sandbox._$HY.r as Record<string, unknown>;
}
/** Each Error record as the client reads it: its message and own keys. */
const errorRecords = (html: string) =>
  Object.values(registry(html))
    .filter(v => Object.prototype.toString.call(v) === "[object Error]")
    .map((e: any) => ({ message: e.message, keys: Object.keys(e) }));
const main = (html: string) =>
  /<main[\s\S]*?<\/main>/.exec(html.replace(/ _hk=[^\s>]*/g, ""))?.[0] ?? "";

interface Rendered {
  html: string;
  completed: boolean;
  heard: string[];
}
async function stream(code: () => any): Promise<Rendered> {
  const heard: string[] = [];
  let completed = false;
  let result: { state: string; html: string } | undefined;
  const escaped = await watchEscapes(async () => {
    result = await settle(
      renderToStream(code, {
        onError: (_: unknown, c: ServerErrorContext) => void heard.push(`${c.kind}/${c.handling}`),
        onCompleteAll() {
          completed = true;
        }
      })
    );
  });
  expect(escaped).toEqual([]);
  expect(result!.state).toBe("settled");
  return { html: result!.html, completed, heard };
}

const plain = (message: string) => ({ message, keys: [] });
const contained: [
  string,
  { code: () => any; main: string | RegExp; records: unknown[]; heard: string[] }
][] = [
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
      // The source's key and the boundary's record carry the one replacement.
      records: [plain("x"), plain("x")],
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
    "getHydrationWriter().write of a rejected deferStream promise",
    {
      code: () => {
        getHydrationWriter()!.write("lib:rejected", Promise.reject(unserializable()), {
          deferStream: true
        });
        return <main>page</main>;
      },
      main: "<main>page</main>",
      records: [plain("x")],
      heard: ["render/serialize"]
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
      records: [plain("x"), plain("x")],
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
      records: [plain("inner"), plain("outer"), plain("inner")],
      heard: ["render/fallback", "render/fallback", "render/serialize", "render/serialize"]
    }
  ]
];

describe.each(contained)("dev tier, %s", (_, scenario) => {
  let rendered: Rendered;
  beforeAll(async () => {
    rendered = await stream(scenario.code);
  });

  test("keeps the fallback and completes", () => {
    expect(main(rendered.html)).toMatch(scenario.main);
    expect(rendered.completed).toBe(true);
  });

  test("sends the record as a plain Error and hears each error once", () => {
    expect(errorRecords(rendered.html)).toEqual(scenario.records);
    expect(rendered.heard).toEqual(scenario.heard);
  });
});

test("dev tier: createSSRResponse answers 200 with the fallback", async () => {
  const event = createRequestEvent(new Request("https://example.com/"));
  let status: number | undefined;
  let result: { state: string; html: string } | undefined;
  const escaped = await watchEscapes(async () => {
    result = await settle(
      provideRequestEvent(event, async () => {
        const response = await createSSRResponse(
          renderToStream(
            () => {
              const data = createMemo(() => Promise.reject(unserializable()), {
                deferStream: true
              });
              return (
                <main>
                  <Errored fallback={<p>fallback</p>}>{data()}</Errored>
                </main>
              );
            },
            { onError: () => {} }
          ),
          event
        );
        status = response.status;
        return response.text();
      })
    );
  });
  expect(escaped).toEqual([]);
  expect(status).toBe(200);
  expect(main(result!.html)).toBe("<main><p>fallback</p></main>");
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
    expect(errorRecords(html)).toEqual([
      { message: "x", keys: ["code"] },
      { message: "x", keys: ["code"] }
    ]);
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

  // The async road (#4659): seroval meets the rejection after the write
  // returned, and a pre-flush failure there fails the render, contained or
  // not. Only the hand-over of a record changes here.
  test("a streamed rejection with an unserializable reason fails before the first flush", async () => {
    const { html, completed, heard } = await stream(() => {
      const data = createMemo(() => Promise.reject(unserializable()));
      return (
        <main>
          <Errored fallback={<p>fallback</p>}>{data()}</Errored>
        </main>
      );
    });
    expect(html).toBe("");
    expect(completed).toBe(false);
    expect(heard[0]).toBe("render/fallback");
    expect(heard).toContain("render/serialize");
  });
});

const FIXTURE = resolve(import.meta.dirname, "stream-contained-error-serialize-4709.fixture.mjs");
type Artifacts = { isDev: boolean } & Record<"plain" | "safe" | "mapped", Rendered>;
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
    ["a hook's mapping", "mapped", "mapped", 1]
  ] as const)("%s", (_, key, wire, failures) => {
    test("keeps the fallback and completes", () => {
      expect(results[key].completed).toBe(true);
      expect(fallback(results[key])).toBe(wire);
    });

    test("every record the client reads is a plain Error, the failure heard once", () => {
      const records = errorRecords(results[key].html);
      expect(records.map(r => r.message)).toContain(wire);
      expect(records.every(r => r.keys.length === 0)).toBe(true);
      expect(results[key].heard).toEqual([
        "render/fallback",
        ...Array(failures).fill("render/serialize")
      ]);
    });
  });
});
