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
let kind;
let logs = 0;
console.error = () => logs++;
class Value {}
function parse() {
  if (kind === 'parse') throw failure;
  return {};
}
const plugin = createPlugin({
  tag: 'test/render-error-state',
  test: value => value instanceof Value,
  parse: { sync: parse, stream: parse },
  serialize() { throw failure; },
  deserialize: () => new Value()
});
for (kind of ['parse', 'serialize', 'unsupported']) {
 for (const mode of ['async', 'sync', 'defer']) {
  for (const hook of ['none', 'local', 'global', 'both']) {
    logs = 0;
    failure = new Error('plugin serialization failure');
    const calls = [];
    const onError = (error, context) => { calls.push(['local', error, context.handling]); return new Error('public failure'); };
    const globalError = (error, context) => { calls.push(['global', error, context.handling]); return new Error('public failure'); };
    configureServerErrors(hook === 'global' || hook === 'both' ? { onError: globalError } : {});
    const abort = new AbortController();
    let completed = false;
    const value = kind === 'unsupported' ? new WeakMap() : new Value();
    const stream = renderToStream(() => {
      sharedConfig.context.serialize('value', mode === 'sync' ? value : Promise.resolve(value), mode === 'defer');
      return '<p>shell</p>';
    }, { plugins: [plugin], signal: abort.signal, onCompleteAll() { completed = true; }, ...(hook === 'local' || hook === 'both' ? { onError } : {}) });
    let timer;
    try {
      const html = await Promise.race([
        Promise.resolve(stream),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('render did not complete')), 1000); })
      ]);
      assert.equal(typeof html, 'string');
      assert.ok(!html.includes(failure.message));
      assert.ok(!html.includes('Seroval Error'));
      assert.equal(stream.hasErrors, true);
      assert.equal(completed, false);
      assert.equal(calls.length, hook === 'none' ? 0 : 1);
      assert.equal(logs, hook === 'none' ? 1 : 0);
      if (calls.length) {
        assert.equal(calls[0][0], hook === 'global' ? 'global' : 'local');
        assert.equal(calls[0][2], 'serialize');
        if (kind !== 'unsupported') assert.equal(calls[0][1], failure);
      }
    } finally {
      clearTimeout(timer);
      abort.abort();
    }
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
    "terminates default serializer failures in %s",
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
