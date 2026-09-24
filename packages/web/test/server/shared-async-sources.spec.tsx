/**
 * @jsxImportSource @solidjs/web
 */
// One generator, every reader — the border half. A generator yields to one
// reader; under a render the serializer pumping a memo's answer and a memo
// reading a source nested in it would split its yields. The runtime shares
// every source it reads (`shareAsyncIterable`, solid-js/server), and the
// serializer takes its seat through the border walk (`toBorderForm`) at
// `context.serialize` — for a memo's resolved value on the document face,
// and for slot args on the frame sink. These tests render for real and
// count what the source saw.
import { describe, expect, test } from "vitest";
import { renderToStream, Loading } from "@solidjs/web";
import { createMemo } from "solid-js";
import { frameTransformDirectResult } from "../../frames/src/frame-sink.js";

function collect(code: () => any): Promise<string> {
  return new Promise(resolve => {
    const chunks: string[] = [];
    renderToStream(code).pipe({
      write: (c: string) => chunks.push(c),
      end: () => resolve(chunks.join(""))
    });
  });
}

function visible(html: string): string {
  return html.replace(/<script[^]*?<\/script>/g, "").replace(/<!--[^]*?-->/g, "");
}

/** A bounded source that counts its readers: yields the steps, then ends. */
function countedSource(steps: string[]) {
  let opens = 0;
  let returns = 0;
  const iterable: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      opens++;
      let i = 0;
      return {
        next: () =>
          new Promise<IteratorResult<string>>(r =>
            setTimeout(
              () =>
                r(
                  i < steps.length
                    ? { done: false, value: steps[i++] }
                    : { done: true, value: undefined }
                ),
              1
            )
          ),
        return: () => {
          returns++;
          return Promise.resolve({ done: true as const, value: undefined });
        }
      };
    }
  };
  return {
    iterable,
    get opens() {
      return opens;
    },
    get returns() {
      return returns;
    }
  };
}

describe("shared async sources at the border", () => {
  test("a memo reading a source nested in another memo's answer shares it with the serializer", async () => {
    const source = countedSource(["step-a", "step-b"]);
    const html = await collect(() => {
      const answer = createMemo(() => Promise.resolve({ meta: "job", progress: source.iterable }));
      const step = createMemo(() => answer().progress);
      return (
        <Loading fallback={<span>FB</span>}>
          <p>{step()}</p>
        </Loading>
      );
    });
    // the reading memo settled on the first value...
    expect(visible(html)).toMatch(/<p[^>]*>step-a<\/p>/);
    // ...and the serialized answer's `progress` carried the WHOLE sequence
    // to the client (a split would have left it one of the two steps)
    expect(html.match(/step-a/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("step-b");
    // one pump for both readers; the source ran to its end (bounded), so
    // nobody had to close it
    expect(source.opens).toBe(1);
    expect(source.returns).toBe(0);
  });

  test("a slot arg the server component also reads is shared with its record", async () => {
    const source = countedSource(["step-a", "step-b"]);
    const ServerComp = (props: any) => {
      // the component's own read of the source it also hands across
      const step = createMemo(() => source.iterable);
      return (
        <Loading fallback={<span>GENFB</span>}>
          <section>
            <i>{step()}</i>
            <props.status progress={source.iterable} />
          </section>
        </Loading>
      );
    };
    const Inline = frameTransformDirectResult(ServerComp, { id: "shared-arg" }) as any;
    const html = await collect(() =>
      Inline({
        status: (p: any) => <b>{p.progress}</b>
      })
    );
    // the component's read and the fill's inline read both settled on V1...
    expect(visible(html)).toMatch(/<i[^>]*>step-a<\/i>/);
    expect(visible(html)).toMatch(/<b[^>]*>step-a<\/b>/);
    // ...the record carried the whole sequence, off one pump
    expect(html).toContain("step-b");
    expect(source.opens).toBe(1);
  });
});
