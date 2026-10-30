// One non-ASCII character in static template text against an ASCII-only twin (#4328).

/**
 * @jsxImportSource @solidjs/web
 */
import { bench, describe } from "vitest";
import { renderToString } from "@solidjs/web";
import { For } from "solid-js";

interface Row {
  id: string;
  name: string;
}

const ROWS: Row[] = Array.from({ length: 1000 }, (_, i) => ({
  id: `row-${i.toString(36).padStart(6, "0")}`,
  name: `Item ${i} with a reasonably long name`
}));

const encoder = new TextEncoder();

function ArrowTable() {
  return (
    <table>
      <tbody>
        <For each={ROWS}>
          {row => (
            <tr>
              <td>{row.id}</td>
              <td>{row.name}</td>
              <td>
                <a href={`/items/${row.id}`}>View →</a>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

function AsciiTable() {
  return (
    <table>
      <tbody>
        <For each={ROWS}>
          {row => (
            <tr>
              <td>{row.id}</td>
              <td>{row.name}</td>
              <td>
                <a href={`/items/${row.id}`}>View -&gt;</a>
              </td>
            </tr>
          )}
        </For>
      </tbody>
    </table>
  );
}

describe("non-ascii-template: 1000 rows (renderToString + UTF-8 encode)", () => {
  bench("arrow in template", () => {
    encoder.encode(renderToString(() => <ArrowTable />));
  });
  bench("ascii only", () => {
    encoder.encode(renderToString(() => <AsciiTable />));
  });
});
