/**
 * ChunkReader growth (#3154). The reader used to reallocate-and-copy the
 * whole buffer on EVERY network read, making one frame O(reads²): a 1 MiB
 * argument payload delivered at the ~66 B reads a slow client actually
 * produces cost ~200× the CPU of the same payload at normal read sizes,
 * all of it blocking the event loop — bounded per request by bodySizeLimit
 * on the server, unbounded on the client leg where the same reader decodes
 * responses. The fix is amortized growth (append in tail room, compact the
 * consumed prefix, reallocate at ≥2× only when outgrown); nothing about the
 * framing, the bytes, or failure behavior changes.
 *
 * Timing assertions would be flaky, so the durable shape (suggested in the
 * report) counts ALLOCATIONS: length-constructed Uint8Arrays during a
 * drive must be O(log reads), which fails cleanly on the quadratic code
 * (one per read) and passes on the fix.
 */
import { describe, expect, it } from "vitest";
import { ChunkReader, createChunk } from "../../server-functions/src/shared.js";

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

/** Streams `bytes` in `readSize`-byte deliveries, like a slow socket. */
function streamOf(bytes: Uint8Array, readSize: number) {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      controller.enqueue(bytes.subarray(offset, Math.min(offset + readSize, bytes.length)));
      offset += readSize;
    }
  });
}

/**
 * Runs `drive` with the Uint8Array global replaced by a counting subclass:
 * only length constructions (`new Uint8Array(n)`) count — subarray views
 * construct from a buffer and stay free, matching what "an allocation"
 * means for the growth strategy under test.
 */
async function countingAllocations<T>(drive: () => Promise<T>) {
  const Native = globalThis.Uint8Array;
  let allocations = 0;
  let allocatedBytes = 0;
  const Counting = class extends Native {
    constructor(...args: any[]) {
      super(...(args as [any]));
      if (typeof args[0] === "number") {
        allocations++;
        allocatedBytes += args[0];
      }
    }
  };
  (globalThis as any).Uint8Array = Counting;
  try {
    const value = await drive();
    return { value, allocations, allocatedBytes };
  } finally {
    globalThis.Uint8Array = Native;
  }
}

async function drainAll(reader: InstanceType<typeof ChunkReader>) {
  const frames: string[] = [];
  await reader.drain((frame: string) => frames.push(frame));
  return frames;
}

describe("ChunkReader growth (#3154)", () => {
  it("delivers identical frames whatever the read granularity", async () => {
    const payloads = ["a".repeat(50_000), "", JSON.stringify({ nested: [1, 2, 3] })];
    const bytes = concat(payloads.map(createChunk));

    // 7 lands read boundaries INSIDE the 12-byte header; 66 is what a slow
    // client's coalesced deliveries actually measure; 16384 is a normal read
    for (const readSize of [7, 66, 16_384, bytes.length]) {
      const frames = await drainAll(new ChunkReader(streamOf(bytes, readSize)));
      expect(frames).toEqual(payloads);
    }
  });

  it("allocates O(log reads) for one large frame, not O(reads)", async () => {
    const payload = "x".repeat(64 * 1024);
    const bytes = concat([createChunk(payload)]);
    const reads = Math.ceil(bytes.length / 66); // ~994

    const { value, allocations, allocatedBytes } = await countingAllocations(() =>
      drainAll(new ChunkReader(streamOf(bytes, 66)))
    );

    expect(value).toEqual([payload]);
    // quadratic code: one allocation per read (~994) totalling ~32 MiB of
    // copies; amortized doubling: ~log2(64 KiB) growths plus constants
    expect(allocations).toBeLessThan(40);
    expect(allocations).toBeGreaterThan(0);
    expect(allocatedBytes).toBeLessThan(bytes.length * 8);
  });

  it("reaches a steady state across many small frames — drained frames recycle the store", async () => {
    // next() consumes a frame by advancing the view; the compaction tier
    // reclaims that prefix instead of growing, so a long multi-frame stream
    // settles into zero new allocations per frame.
    const payloads = Array.from({ length: 200 }, (_, i) => `frame-${i}-` + "y".repeat(300));
    const bytes = concat(payloads.map(createChunk));

    const { value, allocations } = await countingAllocations(() =>
      drainAll(new ChunkReader(streamOf(bytes, 66)))
    );

    expect(value).toEqual(payloads);
    expect(allocations).toBeLessThan(40);
  });

  it("still refuses a truncated stream loudly", async () => {
    const bytes = concat([createChunk("complete"), createChunk("cut short")]);
    const truncated = bytes.subarray(0, bytes.length - 5);

    const reader = new ChunkReader(streamOf(truncated, 66));
    expect((await reader.next()).value).toBe("complete");
    await expect(reader.next()).rejects.toThrow("Malformed server function stream.");
  });
});
