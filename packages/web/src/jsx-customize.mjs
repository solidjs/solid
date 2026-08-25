#!/usr/bin/env node

import fs from "fs";

const args = process.argv.slice(2);

function readOption(name) {
  const index = args.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`Missing value for --${name}`);
  return value;
}

const input = readOption("input");
const output = readOption("output") ?? input;
const element = readOption("element");
const imports = args
  .flatMap((arg, index) => (arg === "--import" ? [args[index + 1]] : []))
  .filter(Boolean);

if (!input || !element) {
  throw new Error(
    [
      "Usage: jsx-customize --input <jsx.d.ts> --element <type> [--output <jsx.d.ts>] [--import <statement>...]",
      "",
      "Example:",
      '  jsx-customize --input ./src/jsx.d.ts --element "SolidElement | Node | ArrayElement" --import "import type { Element as SolidElement } from \\"solid-js\\";"'
    ].join("\n")
  );
}

let source = fs.readFileSync(input, "utf8");

for (const statement of imports) {
  source = source.replace(new RegExp(`^${escapeRegExp(statement)}\\n`, "gm"), "");
}

const importAnchor = 'import type { PropKey, WidenPropValue } from "./jsx-properties.js";';
if (!source.includes(importAnchor)) {
  throw new Error(`Unable to find JSX properties import in ${input}`);
}
source = source.replace(importAnchor, [importAnchor, ...imports].join("\n"));

const nextSource = source.replace(
  /type Element =[\s\S]*?\n  \/\/ END - difference between `jsx\.d\.ts` and `jsx-h\.d\.ts`/,
  `type Element = ${element};\n  // END - difference between \`jsx.d.ts\` and \`jsx-h.d.ts\``
);
if (nextSource === source) {
  throw new Error(`Unable to find JSX.Element declaration block in ${input}`);
}
source = nextSource;

fs.writeFileSync(output, source);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
