/**
 * ChunkReader cancellation, header validation, and cleanup.
 *
 * - `cancel()` ends the read cleanly even partway through a frame. Frames
 *   relies on this to report a superseded response as superseded rather
 *   than as a malformed stream.
 * - A header must be exactly `;0x` plus 8 hex digits plus `;`.
 * - A failed read releases the body instead of leaving it locked.
 * - An oversized store is released once nothing in it is unread.
 */
import { describe, expect, it } from "vitest";
import {
  ChunkReader,
  createChunk,
  deserializeStream
} from "../../server-functions/src/shared.js";

const encoder = new TextEncoder();

function concat(chunks: Uint8Array[]) {
  const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

/**
 * Delivers `pieces` one per read. With `hold`, the stream then stays open
 * instead of closing, like a connection waiting on the server. Records
 * whether it was cancelled.
 */
function source(pieces: Uint8Array[], { hold = false } = {}) {
  let index = 0;
  let release: (() => void) | undefined;
  const state = { cancelled: false };
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (index < pieces.length) return controller.enqueue(pieces[index++]);
        if (hold) return new Promise<void>(resolve => (release = resolve));
        controller.close();
      },
      cancel() {
        state.cancelled = true;
        release?.();
      }
    },
    { highWaterMark: 0 }
  );
  return { stream, state };
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0));

/** The reader's backing allocation. Internal, so it is not on the declared type. */
const storeOf = (reader: InstanceType<typeof ChunkReader>): Uint8Array =>
  (reader as unknown as { store: Uint8Array }).store;

describe("ChunkReader cancel()", () => {
  const frame = createChunk("hello");

  for (const [label, buffered] of [
    ["nothing buffered", new Uint8Array(0)],
    ["partway through the header", frame.subarray(0, 5)],
    ["partway through the payload", frame.subarray(0, 14)]
  ] as const) {
    it(`resolves a pending next() as done with ${label}`, async () => {
      const { stream } = source(buffered.length ? [buffered] : [], { hold: true });
      const reader = new ChunkReader(stream);
      const pending = reader.next();
      await tick();
      await reader.cancel(new Error("superseded"));
      await expect(pending).resolves.toEqual({ done: true, value: undefined });
    });
  }

  it("does not deliver frames that were already buffered", async () => {
    const { stream } = source([concat([createChunk("a"), createChunk("b")])], { hold: true });
    const reader = new ChunkReader(stream);
    expect((await reader.next()).value).toBe("a");
    await reader.cancel(undefined);
    expect(await reader.next()).toEqual({ done: true, value: undefined });
  });

  it("still refuses a body that ends partway through a frame without a cancel", async () => {
    const { stream } = source([frame.subarray(0, 14)]);
    await expect(new ChunkReader(stream).next()).rejects.toThrow(
      "Malformed server function stream."
    );
  });
});

describe("ChunkReader header validation", () => {
  const payload = encoder.encode("hello");

  it("accepts the canonical header, in either hex case", async () => {
    for (const header of [";0x00000005;", ";0x0000000A;", ";0x0000000a;"]) {
      const body = header === ";0x00000005;" ? payload : encoder.encode("helloworld");
      const reader = new ChunkReader(source([concat([encoder.encode(header), body])]).stream);
      expect((await reader.next()).done).toBe(false);
    }
  });

  for (const header of [
    ";0x5zzzzzzz;", // trailing junk after a valid digit
    "X0x00000005X", // wrong delimiters
    ";0000000005;", // no 0x prefix
    ";0x0000005 ;", // whitespace inside the digits
    ";0X00000005;", // uppercase X
    ";-0x0000005;" // a sign
  ]) {
    it(`refuses ${JSON.stringify(header)}`, async () => {
      const reader = new ChunkReader(source([concat([encoder.encode(header), payload])]).stream);
      await expect(reader.next()).rejects.toThrow("Malformed server function stream.");
    });
  }

  it("refuses a payload that is not valid UTF-8", async () => {
    const invalid = Uint8Array.of(0x22, 0xff, 0xfe, 0x22);
    const header = encoder.encode(";0x00000004;");
    const reader = new ChunkReader(source([concat([header, invalid])]).stream);
    await expect(reader.next()).rejects.toThrow("Malformed server function stream.");
  });

  it("still decodes multi-byte characters split across reads", async () => {
    const value = '{"text":"héllo 😀 世界"}';
    const bytes = createChunk(value);
    for (let cut = 0; cut <= bytes.length; cut++) {
      const reader = new ChunkReader(source([bytes.subarray(0, cut), bytes.subarray(cut)]).stream);
      expect((await reader.next()).value).toBe(value);
    }
  });
});

describe("ChunkReader cleanup", () => {
  it("cancels the body when the drain fails", async () => {
    const bytes = concat([createChunk("1"), createChunk("not json"), createChunk("3")]);
    const { stream, state } = source([bytes], { hold: true });
    await expect(
      new ChunkReader(stream).drain((value: string) => JSON.parse(value))
    ).rejects.toThrow(SyntaxError);
    expect(state.cancelled).toBe(true);
  });

  it("cancels the body when deserializeStream's first frame is malformed", async () => {
    const { stream, state } = source([encoder.encode(";0x5zzzzzzz;hello")], { hold: true });
    await expect(deserializeStream(new Response(stream))).rejects.toThrow(
      "Malformed server function stream."
    );
    expect(state.cancelled).toBe(true);
  });

  it("cancels the body when deserializeStream's first value fails to decode", async () => {
    const { stream, state } = source([createChunk("not json")], { hold: true });
    await expect(deserializeStream(new Response(stream))).rejects.toThrow(SyntaxError);
    expect(state.cancelled).toBe(true);
  });

  it("releases an oversized store once nothing in it is unread", async () => {
    const large = createChunk("x".repeat(1 << 20));
    const pieces: Uint8Array[] = [];
    for (let offset = 0; offset < large.length; offset += 65_536) {
      pieces.push(large.subarray(offset, offset + 65_536));
    }
    pieces.push(createChunk("small"));
    const reader = new ChunkReader(source(pieces, { hold: true }).stream);
    await reader.next();
    await reader.next();
    expect(storeOf(reader).length).toBeLessThanOrEqual(64 * 1024);
    reader.cancel(undefined);
  });

  it("keeps the store while frames of the same size keep arriving", async () => {
    const frame = () => createChunk("y".repeat(200_000));
    const reader = new ChunkReader(source([frame(), frame(), frame()], { hold: true }).stream);
    await reader.next();
    const store = storeOf(reader);
    await reader.next();
    await reader.next();
    expect(storeOf(reader)).toBe(store);
    reader.cancel(undefined);
  });
});
