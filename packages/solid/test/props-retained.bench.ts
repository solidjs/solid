import { bench, describe } from "vitest";
import { mergeProps, splitProps } from "../src/index.js";
import { createStore } from "../store/src/index.js";

// Each operation represents a batch of mounted component instances, not one call.
// Keep results reachable between iterations; replace the previous batch to bound memory.
const instanceCount = 10_000;
type Props = { id: number; value: number; disabled: boolean; title: string };
type Retained = { read: Pick<Props, "id" | "value" | "disabled">; text: { title: string } };
const defaults = { disabled: true, title: "Default" };
const selectedKeys = ["id", "value", "disabled"] as const;

const scenarios = [
  {
    name: "mergeProps",
    create: (source: Props): Retained => {
      const merged = mergeProps(defaults, source);
      return { read: merged, text: merged };
    },
    proxiesPerInstance: 1
  },
  {
    name: "splitProps",
    create: (source: Props): Retained => {
      const [selected, rest] = splitProps(source, selectedKeys);
      return { read: selected, text: rest };
    },
    proxiesPerInstance: 2
  },
  {
    name: "mergeProps+splitProps",
    create: (source: Props): Retained => {
      const [selected, rest] = splitProps(mergeProps(defaults, source), selectedKeys);
      return { read: selected, text: rest };
    },
    proxiesPerInstance: 3
  }
];

for (const scenario of scenarios) {
  for (const operation of ["create", "read"] as const) {
    describe(`${scenario.name}-retained(${instanceCount})-${operation}`, () => {
      let sources: Props[] = [];
      let retained: Retained[] = [];
      let checksum = 0;

      const setup = () => {
        // Real store proxies, one distinct source per instance; setup is untimed.
        sources = Array.from(
          { length: instanceCount },
          (_, id) => createStore({ id, value: id, disabled: false, title: "Title" })[0]
        );
        if (operation === "read") retained = sources.map(scenario.create);
      };

      const teardown = () => {
        // Consume observable results outside the timed callback and check the batch.
        if (
          retained.length !== instanceCount ||
          retained[instanceCount - 1].read.id !== instanceCount - 1
        )
          throw new Error("Incomplete retained props batch");
        if (
          operation === "read" &&
          checksum !== instanceCount * (instanceCount - 1) + instanceCount * 5
        )
          throw new Error("Unexpected retained props checksum");
        sources = [];
        retained = [];
      };

      bench(
        `${operation}: ${instanceCount * scenario.proxiesPerInstance} utility proxies`,
        () => {
          if (operation === "create") {
            retained = sources.map(scenario.create);
          } else {
            let sum = 0;
            for (const entry of retained) {
              sum += entry.read.id + entry.read.value + Number(entry.read.disabled);
              sum += entry.text.title.length;
            }
            checksum = sum;
          }
        },
        { time: 1000, warmupTime: 250, iterations: 20, setup, teardown }
      );
    });
  }
}
