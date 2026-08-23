import vm from "node:vm";

/**
 * Executes a rendered payload's <script> blocks the way a browser would and
 * returns the record ids filed under `_$HY.r` — asserting the serialized
 * record SET by protocol outcome rather than by scraping assignment text.
 * The wire format is not one-record-one-assignment: pre-shell pending
 * promises batch into a single seroval write (keyed "$B") that a spreader
 * task files under the real ids, so `_$HY.r["<id>"]=` only appears for
 * post-shell writes.
 *
 * `document.getElementById` returns null so `$df` reveal calls take their
 * graceful "template not present" early-return instead of touching a DOM.
 */
export function hydrationRecordKeys(html: string): string[] {
  const sandbox: any = {
    document: { getElementById: () => null },
    _$HY: { r: {}, fe() {} }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const [, src] of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
    vm.runInContext(src, sandbox);
  }
  const keys = Object.keys(sandbox._$HY.r);
  // Error-path payloads legitimately REJECT their record promises (`_fr`
  // rejection is the protocol for streamed errors); without a consumer that
  // leaks an unhandledRejection into the test process.
  for (const k of keys) {
    const p = sandbox._$HY.r[k];
    if (p && typeof p.then === "function") p.catch(() => {});
  }
  return keys;
}
