/**
 * @jsxImportSource @solidjs/web
 *
 * A seroval stream written through the render's `serialize` funnel crosses
 * the channel guard as the codec's own value. Since seroval 1.6.8,
 * `createStream()` mints an untagged class instance (no
 * `__SEROVAL_STREAM__`); the guard must still hand it to seroval as-is.
 */
import { describe, expect, test } from "vitest";
import { createStream } from "seroval";
import { renderToStream } from "@solidjs/web";
import { sharedConfig } from "solid-js/internal";

describe("renderToStream: a seroval stream on a channel", () => {
  test("an untagged stream reaches the wire whole", async () => {
    const stream = createStream<string>();
    stream.next("chunk-early");
    const html = await new Promise<string>(resolve => {
      renderToStream(() => {
        (sharedConfig.context as any).serialize("s", stream);
        return <div>body</div>;
      }).then(resolve);
      setTimeout(() => {
        stream.next("chunk-late");
        stream.return("chunk-end");
      }, 10);
    });
    expect(html).toContain("chunk-early");
    expect(html).toContain("chunk-late");
    expect(html).toContain("chunk-end");
  });
});
