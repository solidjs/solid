import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const cwd = fileURLToPath(new URL("../..", import.meta.url));
const probe = `
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { createComponent, createMemo, Errored, Loading } from 'solid-js';
import { configureServerErrors, createRequestEvent, renderToStream, ssr, isDev, RequestContext } from '@solidjs/web';
import { createServerReference, registerServerReference } from '@solidjs/web/server-functions/server';
const storage = new AsyncLocalStorage();
globalThis[RequestContext] = storage;
console.error = () => {};
const calls = [];
configureServerErrors({onError(error, context) {
  calls.push(context.kind);
  return new Error('public failure');
}});
function page(run) {
  return ssr(['<main>', '</main>'], createComponent(Loading, {
    fallback: 'pending',
    get children() {
      const value = createMemo(run);
      return ssr(['<p>', '</p>'], createMemo(() => value()));
    }
  }));
}
async function render(run) {
  const event = createRequestEvent(new Request('https://example.test'));
  const stream = storage.run(event, () => renderToStream(() => page(run)));
  const html = await stream;
  return { html, hasErrors: stream.hasErrors };
}
const error = new Error('PRIVATE');
const first = await render(() => Promise.reject(error));
const second = await render(() => Promise.reject(error));
assert.equal(first.hasErrors, true);
assert.equal(second.hasErrors, true);
assert.equal(calls.length, 1);
if (!isDev) assert.ok(!first.html.includes('PRIVATE'));
assert.ok(!second.html.includes('PRIVATE'));
const load = createServerReference(registerServerReference('artifact/state', () => Promise.reject(new Error('PRIVATE_function'))));
const escaped = await render(() => load());
assert.equal(escaped.hasErrors, true);
assert.ok(!isDev ? !escaped.html.includes('PRIVATE_function') : true);
const recovered = await render(() => load().catch(() => 'recovered'));
assert.equal(recovered.hasErrors, false);
assert.ok(recovered.html.includes('recovered'));
for (const failure of [undefined, null, false, 0, '']) {
  const stream = renderToStream(() => createComponent(Errored, {
    fallback: 'fallback', get children() { throw failure; }
  }));
  await stream;
  assert.equal(stream.hasErrors, true);
}
process.stdout.write(JSON.stringify({isDev, passed: true}));
`;

describe("render error state in published artifacts", () => {
  test.each(["production", "development", "observe"])("%s", condition => {
    const args = condition === "production" ? [] : [`--conditions=${condition}`];
    const output = execFileSync(process.execPath, [...args, "--input-type=module", "-e", probe], {
      cwd,
      encoding: "utf8",
      timeout: 10_000
    });
    expect(JSON.parse(output)).toEqual({ isDev: condition === "development", passed: true });
  });
});
