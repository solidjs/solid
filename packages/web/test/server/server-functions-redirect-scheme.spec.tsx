/**
 * The navigation-target scheme floor (#3175) must judge the target the way
 * a URL parser will read it, not the way the bytes are spelled (#3201).
 *
 * `refusedTargetScheme` matched `/^[a-zA-Z][a-zA-Z0-9+.-]*:/` against the
 * RAW header value. Every URL parser removes ASCII tab, LF and CR from a
 * URL before it begins (WHATWG URL, "basic URL parser", step 2), so a TAB
 * anywhere inside the scheme token made the regex see no scheme at all
 * while the consumer sees `javascript:` — the floor was one character wide.
 *
 * Two of the roads were never fooled, because they resolve through
 * `new URL()` first: the scripted mask (`maskRedirect`) and the no-JS
 * handler, plus the client-side `decodeRedirectHeaderValue`. The roads that
 * read a header RAW — an author's `Location` on a forwarded 3xx, and an
 * author's or hook's `X-Server-Function-Redirect` — were not, which is
 * exactly the road the floor was documented to backstop.
 *
 * The table is the point: every refused scheme, every whitespace character
 * a URL parser strips, in every position it can sit, on every road. And
 * the allowances the floor deliberately keeps — relative, same-origin
 * absolute, CROSS-ORIGIN absolute (OAuth hand-offs), protocol-relative —
 * are asserted alongside, because a fix that resolves through `new URL()`
 * without a base refuses all of them.
 *
 * Like the other server-function specs, these run against the built bundles
 * (server-functions/dist/*, wired up in vite.config.server.mjs).
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  REDIRECT_HEADER,
  decodeRedirectHeaderValue,
  handleServerFunctionRequest,
  registerServerFunction
} from "@solidjs/web/server-functions/server";

const RequestContext = Symbol.for("solid.RequestContext");

beforeAll(() => {
  (globalThis as any)[RequestContext] = new AsyncLocalStorage();
});

afterAll(() => {
  delete (globalThis as any)[RequestContext];
});

const provideEvent = <T,>(_event: unknown, run: () => T): T => run();

/** The four roads a navigation target can leave the transport on. */
type Road = "location" | "redirect-header" | "masked" | "nojs";

let seq = 0;

async function ship(road: Road, target: string) {
  const id = `scheme-${seq++}`;
  let ran = 0;
  registerServerFunction(id, async () => {
    ran++;
    // `Headers` refuses CR/LF in a value outright, so those variants never
    // reach the floor — that protection comes from the platform, not from the
    // code under test, so it is reported as its own outcome rather than
    // counted as a refusal the floor made.
    const headers = new Headers();
    try {
      if (road === "redirect-header") {
        headers.set(REDIRECT_HEADER, `302 ${target}`);
        return new Response(null, { status: 200, headers });
      }
      headers.set("Location", target);
      return new Response(null, { status: 302, headers });
    } catch {
      return new Response("HEADERS-REFUSED", { status: 200 });
    }
  });
  const scripted = road === "masked";
  const form = road === "nojs";
  let response: Response;
  try {
    response = await handleServerFunctionRequest(
      new Request(`https://app.example${scripted ? "/_server/data/" : "/_server/"}${id}`, {
        method: "POST",
        headers: {
          "Sec-Fetch-Site": "same-origin",
          ...(form
            ? {
                "Content-Type": "application/x-www-form-urlencoded",
                "Sec-Fetch-Mode": "navigate",
                Referer: "https://app.example/page"
              }
            : {})
        },
        ...(form ? { body: "a=1" } : {})
      }),
      { provideEvent }
    );
  } catch {
    return { ran, shipped: null as string | null, refused: true, protocol: "n/a" };
  }
  if (response.status === 500) return { ran, shipped: null, refused: true, protocol: "n/a" };
  const carried = response.headers.get(REDIRECT_HEADER);
  const shipped = carried
    ? carried.slice(carried.indexOf(" ") + 1)
    : response.headers.get("Location");
  if (shipped === null) return { ran, shipped: null, refused: true, protocol: "n/a" };
  let protocol: string;
  try {
    protocol = new URL(shipped, "https://app.example/here").protocol;
  } catch {
    protocol = "unparseable";
  }
  return { ran, shipped, refused: false, protocol };
}

/** Every scheme the floor refuses. */
const REFUSED_SCHEMES = ["javascript", "data", "vbscript", "file", "intent", "mailto", "myapp"];

/**
 * Every spelling that reads back as that scheme: the URL parser strips
 * ASCII TAB/LF/CR from anywhere, and leading C0-control-or-space before
 * parsing, so all of these are the same target to a consumer.
 */
function spellings(scheme: string): [string, string][] {
  const mid = Math.max(1, scheme.length >> 1);
  const split = (c: string) => `${scheme.slice(0, mid)}${c}${scheme.slice(mid)}:x`;
  return [
    ["plain", `${scheme}:x`],
    ["TAB interior", split("\t")],
    ["LF interior", split("\n")],
    ["CR interior", split("\r")],
    ["TAB before colon", `${scheme}\t:x`],
    ["leading SP", ` ${scheme}:x`],
    ["leading TAB", `\t${scheme}:x`],
    ["leading LF", `\n${scheme}:x`]
  ];
}

describe("non-http(s) navigation targets are refused however they are spelled (#3201)", () => {
  it("every refused scheme, every stripped whitespace, every position, every road", async () => {
    // The contract is not "the request fails" — the no-JS road legitimately
    // answers a rejected target by redirecting BACK to the referer. It is
    // that nothing carrying a non-http(s) scheme ever leaves the transport.
    const rows: string[] = [];
    for (const scheme of REFUSED_SCHEMES) {
      for (const [name, target] of spellings(scheme)) {
        for (const road of ["location", "redirect-header", "masked", "nojs"] as const) {
          const r = await ship(road, target);
          const safe = r.refused || r.protocol === "http:" || r.protocol === "https:";
          rows.push(
            `${scheme}/${name}/${road}: ran=${r.ran} ${
              safe
                ? "http(s)-or-refused"
                : `SHIPPED ${JSON.stringify(r.shipped)} reads as ${r.protocol}`
            }`
          );
        }
        // the client-side decoder enforces the same floor independently
        rows.push(
          `${scheme}/${name}/decoder: ran=1 ${
            decodeRedirectHeaderValue(`302 ${target}`) === undefined
              ? "http(s)-or-refused"
              : "DECODED a non-http(s) target"
          }`
        );
      }
    }
    // `ran=1` is part of the contract: a handler that dispatches nothing
    // renders every row as "refused" and would otherwise pass.
    expect(rows).toEqual(
      rows.map(r => `${r.slice(0, r.indexOf(":") + 1)} ran=1 http(s)-or-refused`)
    );
  });

  it("keeps every allowance the floor deliberately grants", async () => {
    const allowed: [string, string][] = [
      ["relative path", "/dashboard"],
      ["relative path with query and hash", "/dashboard?next=1#top"],
      ["schemeless relative segment", "dashboard"],
      ["relative segment containing a colon", "./dashboard:tab"],
      ["query only", "?only=query"],
      ["hash only", "#only-hash"],
      ["empty target", ""],
      ["absolute same-origin https", "https://app.example/next"],
      ["absolute same-origin http", "http://app.example/next"],
      // cross-origin http(s) is DELIBERATE: the floor is a scheme floor, not
      // an origin policy — OAuth hand-offs flow through it (#3175)
      ["absolute cross-origin", "https://accounts.example.com/oauth"],
      ["protocol-relative", "//accounts.example.com/oauth"]
    ];
    const rows: string[] = [];
    for (const [name, target] of allowed) {
      for (const road of ["location", "masked"] as const) {
        const r = await ship(road, target);
        rows.push(`${name}/${road}: ${r.refused ? "REFUSED" : `shipped, reads as ${r.protocol}`}`);
      }
    }
    expect(rows).toEqual([
      "relative path/location: shipped, reads as https:",
      "relative path/masked: shipped, reads as https:",
      "relative path with query and hash/location: shipped, reads as https:",
      "relative path with query and hash/masked: shipped, reads as https:",
      "schemeless relative segment/location: shipped, reads as https:",
      "schemeless relative segment/masked: shipped, reads as https:",
      "relative segment containing a colon/location: shipped, reads as https:",
      "relative segment containing a colon/masked: shipped, reads as https:",
      "query only/location: shipped, reads as https:",
      "query only/masked: shipped, reads as https:",
      "hash only/location: shipped, reads as https:",
      "hash only/masked: shipped, reads as https:",
      "empty target/location: shipped, reads as https:",
      // an empty Location carries no navigation for a scripted caller to act
      // on, so the mask emits no header at all
      "empty target/masked: REFUSED",
      "absolute same-origin https/location: shipped, reads as https:",
      "absolute same-origin https/masked: shipped, reads as https:",
      "absolute same-origin http/location: shipped, reads as http:",
      "absolute same-origin http/masked: shipped, reads as http:",
      "absolute cross-origin/location: shipped, reads as https:",
      "absolute cross-origin/masked: shipped, reads as https:",
      "protocol-relative/location: shipped, reads as https:",
      "protocol-relative/masked: shipped, reads as https:"
    ]);
  });
});
