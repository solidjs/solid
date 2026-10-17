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

const serializationProbe = `
import assert from 'node:assert/strict';
import { configureServerErrors, renderToStream } from '@solidjs/web';
import { createPlugin } from '@solidjs/web/serialization';
import { sharedConfig } from 'solid-js/internal';
let failure;
class Value {}
const plugin = createPlugin({
  tag: 'test/render-error-state',
  test: value => value instanceof Value,
  parse: { sync: () => ({}), stream: () => ({}) },
  serialize() { throw failure; },
  deserialize: () => new Value()
});
for (const mode of ['async', 'sync', 'defer']) {
  for (const hook of ['none', 'local', 'global']) {
    failure = new Error('plugin serialization failure');
    const calls = [];
    const onError = error => { calls.push(error); };
    configureServerErrors(hook === 'global' ? { onError } : {});
    const abort = new AbortController();
    const stream = renderToStream(() => {
      sharedConfig.context.serialize('value', mode === 'sync' ? new Value() : Promise.resolve(new Value()), mode === 'defer');
      return '<p>shell</p>';
    }, { plugins: [plugin], signal: abort.signal, ...(hook === 'local' ? { onError } : {}) });
    let timer;
    try {
      const html = await Promise.race([
        Promise.resolve(stream),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('render did not complete')), 1000); })
      ]);
      assert.ok(html.includes('shell'));
      assert.ok(!html.includes(failure.message));
      assert.equal(stream.hasErrors, hook === 'local');
      assert.deepEqual(calls, hook === 'local' ? [failure] : []);
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
  }
}
process.stdout.write('passed');
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

  test.each(["production", "development", "observe"])(
    "preserves serializer error handling in %s",
    condition => {
      const args = condition === "production" ? [] : [`--conditions=${condition}`];
      const output = execFileSync(
        process.execPath,
        [...args, "--input-type=module", "-e", serializationProbe],
        { cwd, encoding: "utf8", timeout: 10_000 }
      );
      expect(output).toBe("passed");
    }
  );
});
