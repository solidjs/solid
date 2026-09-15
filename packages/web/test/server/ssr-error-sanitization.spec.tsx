/**
 * @jsxImportSource @solidjs/web
 *
 * The wire policy on SSR render failures (#3468). A plain error caught by
 * `<Errored>` during SSR was serialized to the client verbatim — `message`,
 * `cause`, own properties; only `.stack` stripped — while the same error over
 * the server-function wire has been sanitized to `"Internal Server Error"`
 * since #3113/#3116. A `"use server"` function called in-process during SSR
 * never touches dispatch, so a production page load leaked exactly what its
 * RPC wire withholds. Same hole for a rejected async source serialized into
 * the stream, a `<Loading>` fragment's `_fr` rejection, a frame stream's
 * error chunks (the fragment's, a live hole's, the root's).
 *
 * One policy, `ssrSanitizeError` in `solid-js`'s server entry, applied where
 * a value is about to be rendered or serialized FOR the client:
 *
 *  - the boundary sanitizes BEFORE rendering its fallback, and serializes the
 *    same replacement — the fallback hydrates against the record, so the two
 *    must agree;
 *  - the hydration funnel guards every channel it serializes (a promise's
 *    rejection, an iterable's thrown step); a value passes as-is — an Error
 *    reached as a value was never thrown, it is data and the author's
 *    (#3113's ruling);
 *  - a fragment's terminal error reaches the `_fr` rejection and a transport
 *    sink's error chunk sanitized; the abandonment ledger keeps the original;
 *  - `markSafeError` passes through everywhere, own properties included;
 *  - the observe tier records the replacement once per original as
 *    `SSR_ERROR_SANITIZED` (advisory — the failure is the
 *    `SSR_RENDER_ERROR_CONTAINED` finding's), the original in `data.error`.
 *
 * The dev/prod line is the build variant (`IS_DEV`): `server.dev.js` keeps
 * fidelity, the prod and observe artifacts sanitize. That is a property of
 * the ARTIFACTS, so every scenario runs in a child Node against the built
 * ones — the workspace `solid-js`, the self-linked `@solidjs/web` (the `link`
 * build step) — under Node's real resolver: default conditions, `observe`,
 * `development`. The scenarios themselves are in
 * ssr-error-sanitization.fixture.mjs. Requires a prior `pnpm build`.
 */
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const FIXTURE = resolve(import.meta.dirname, "ssr-error-sanitization.fixture.mjs");
const GENERIC = "Internal Server Error";
const SECRETS = ["hunter2", "10.0.0.5", "SELECT * FROM users", "abc123", "ECONNREFUSED"];

interface Finding {
  code: string;
  severity: string;
  ownerPath?: string[];
  message: string;
  error?: string;
}
interface Scenario<V = string> {
  value: V;
  findings: Finding[];
}
interface Results {
  isDev: boolean;
  observe: boolean;
  errored: Scenario;
  safe: Scenario;
  channel: Scenario;
  fragment: Scenario;
  value: Scenario;
  frameRoot: Scenario<any[]>;
  frameFragment: Scenario<any[]>;
}

const runs = new Map<string, Results>();
function run(conditions: string[]): Results {
  const key = conditions.join(",");
  const cached = runs.get(key);
  if (cached) return cached;
  const stdout = execFileSync(
    process.execPath,
    [...conditions.map(c => `--conditions=${c}`), FIXTURE],
    { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }
  );
  const results: Results = JSON.parse(stdout);
  runs.set(key, results);
  return results;
}

function expectNoSecrets(text: string) {
  for (const secret of SECRETS) expect(text, `leaked "${secret}"`).not.toContain(secret);
}
/** Every serialized Error constructor in a document. */
const serializedErrors = (html: string) => html.match(/new Error\("([^"]*)"\)/g) ?? [];
const byCode = (findings: Finding[], code: string) => findings.filter(f => f.code === code);

/** The policy, as the production and observe artifacts apply it. */
function describeSanitizing(name: string, conditions: string[], observe: boolean) {
  describe(name, () => {
    test("resolves the tier under test", () => {
      const results = run(conditions);
      expect(results.isDev).toBe(false);
      expect(results.observe).toBe(observe);
    });

    test("<Errored>: the fallback and the serialized record are the same generic Error; no secret in the document", () => {
      const { value: html } = run(conditions).errored;
      expectNoSecrets(html);
      // The fallback rendered with the replacement — message generic, the own
      // property gone — and the record the client hydrates against is that
      // replacement, so the two agree.
      expect(html).toContain(`<p class="fallback">${GENERIC}|undefined</p>`);
      expect(serializedErrors(html)).toEqual([`new Error("${GENERIC}")`]);
    });

    test("markSafeError passes through: message and own properties reach the fallback and the record", () => {
      const { value: html, findings } = run(conditions).safe;
      expect(html).toContain(`<p class="fallback">Item not found|item:42</p>`);
      expect(html).toContain('new Error("Item not found")');
      expect(html).toContain('query:"item:42"');
      expect(byCode(findings, "SSR_ERROR_SANITIZED")).toHaveLength(0);
    });

    test("a rejected async source serialized into the stream rejects the client with the replacement", () => {
      const { value: html } = run(conditions).channel;
      expectNoSecrets(html);
      const records = serializedErrors(html);
      expect(records.length).toBeGreaterThanOrEqual(1);
      for (const record of records) expect(record).toBe(`new Error("${GENERIC}")`);
    });

    test("a <Loading> fragment that rejects hands the client the replacement", () => {
      const { value: html } = run(conditions).fragment;
      expectNoSecrets(html);
      const records = serializedErrors(html);
      expect(records.length).toBeGreaterThanOrEqual(1);
      for (const record of records) expect(record).toBe(`new Error("${GENERIC}")`);
    });

    test("an Error reached as a VALUE is data, and passes as the author wrote it", () => {
      const { value: html, findings } = run(conditions).value;
      expect(html).toContain("field: name is required");
      expect(byCode(findings, "SSR_ERROR_SANITIZED")).toHaveLength(0);
    });

    test("frame streams: the root error chunk and every keyed error chunk carry the replacement", () => {
      const { frameRoot, frameFragment } = run(conditions);
      expect(frameRoot.value.map(c => c.type)).toEqual(["start", "error", "complete"]);
      expect(frameRoot.value[1].error).toBe(GENERIC);
      expectNoSecrets(JSON.stringify(frameRoot.value));

      const errors = frameFragment.value.filter(c => c.type === "error");
      // The fragment's error rides `{ message }`; a live hole's terminal
      // failure rides its message bare (`lh:*`) — both the replacement's.
      expect(errors.some(c => c.key === "00")).toBe(true);
      expect(errors.some(c => String(c.key).startsWith("lh:"))).toBe(true);
      for (const chunk of errors) {
        expect(typeof chunk.error === "string" ? chunk.error : chunk.error.message).toBe(GENERIC);
      }
      expectNoSecrets(JSON.stringify(frameFragment.value));
    });
  });
}

describeSanitizing("the production artifacts", [], false);
describeSanitizing("the observe artifacts", ["observe"], true);

describe("the observe artifacts' record of it", () => {
  test("the failure is the contained-render finding's, with the original; the replacement is one advisory record beside it", () => {
    const { findings } = run(["observe"]).errored;
    const [contained] = byCode(findings, "SSR_RENDER_ERROR_CONTAINED");
    expect(contained.error).toContain("ECONNREFUSED");
    const sanitized = byCode(findings, "SSR_ERROR_SANITIZED");
    expect(sanitized).toHaveLength(1);
    expect(sanitized[0].severity).toBe("info");
    expect(sanitized[0].error).toContain("ECONNREFUSED");
    expect(sanitized[0].message).toContain("replaced with a generic Error");
    expect(sanitized[0].ownerPath).toEqual(["<Errored>"]);
  });

  test("one original, however many roads it took, is one record", () => {
    const results = run(["observe"]);
    // The async source's rejection, the fragment's, the boundary's: one.
    expect(byCode(results.channel.findings, "SSR_ERROR_SANITIZED")).toHaveLength(1);
    // The fragment's `_fr` rejection and its abandonment ledger: one, and
    // the ledger's own finding kept the original.
    expect(byCode(results.fragment.findings, "SSR_ERROR_SANITIZED")).toHaveLength(1);
    const [abandoned] = byCode(results.fragment.findings, "SSR_SUBTREE_ABANDONED");
    expect(abandoned.error).toContain("ECONNREFUSED");
    // The frame's fragment chunk and its live hole's: one.
    expect(byCode(results.frameFragment.findings, "SSR_ERROR_SANITIZED")).toHaveLength(1);
    expect(byCode(results.frameRoot.findings, "SSR_ERROR_SANITIZED")).toHaveLength(1);
  });

  test("the production artifacts record nothing — there is no channel", () => {
    const results = run([]);
    for (const scenario of [
      results.errored,
      results.channel,
      results.fragment,
      results.frameRoot
    ]) {
      expect(scenario.findings).toEqual([]);
    }
  });
});

describe("the development artifacts", () => {
  test("keep full fidelity: the fallback and the record carry the error as thrown", () => {
    const results = run(["development"]);
    expect(results.isDev).toBe(true);
    const { value: html, findings } = results.errored;
    expect(html).toContain(
      `<p class="fallback">connect ECONNREFUSED postgres://app:hunter2@10.0.0.5:5432|SELECT * FROM users WHERE token = 'abc123'</p>`
    );
    expect(html).toContain(
      'new Error("connect ECONNREFUSED postgres://app:hunter2@10.0.0.5:5432")'
    );
    expect(byCode(findings, "SSR_ERROR_SANITIZED")).toHaveLength(0);
    expect(byCode(findings, "SSR_RENDER_ERROR_CONTAINED")).toHaveLength(1);
  });

  test("a rejected async source's reason and a frame's error chunks are the originals", () => {
    const results = run(["development"]);
    expect(results.channel.value).toContain("hunter2");
    expect(results.frameRoot.value[1].error).toContain("hunter2");
  });
});
