import { createVitest } from "vitest/node";

const vitest = await createVitest("test", {
  include: [`tests/gc.test.ts`],
  globals: true,
  watch: process.argv.includes("--watch"),
});

await vitest.start();
