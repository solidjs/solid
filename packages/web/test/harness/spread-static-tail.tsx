/**
 * @jsxImportSource @solidjs/web
 *
 * Spread element with static attributes — shared fixture.
 *
 * The everyday wrapper-component element: author props spread onto the tag
 * with a few attributes the component itself decides. Where the statics sit
 * relative to the spread decides what the SSR compiler can do with them:
 *
 *   tail   — `<li {...attrs} class="row" data-kind="item">`. Nothing after
 *            the statics can override them, so they are a fixed attribute
 *            string; the spread's own copies of those keys are skipped. One
 *            source, no trailing object, no precedence walk.
 *   head   — `<li class="row" data-kind="item" {...attrs}>`. The spread may
 *            override either key, so the statics must stay a source that the
 *            spread's keys are checked against. The control.
 *   mixed  — `<li {...attrs} class="row" data-id={id}>`. A static and a
 *            dynamic attribute after the spread: the static is fixed markup,
 *            the dynamic stays in a trailing getter source.
 *   dynhead — `<li data-id={id} class="row" {...attrs}>`. A dynamic and a
 *            static before the spread: both must stay a source (a getter
 *            source), which is what the hoisted-shape pass can still speed up.
 *
 * tail and head serialize the same attribute SET, as do mixed and dynhead,
 * for rows whose spread carries none of the static keys (`makeRows`); `collidingRows` gives the spread a
 * `class` of its own, which the tail and mixed forms must drop unread and the
 * head form must let win. Imported by:
 *   - test/server/spread-static-tail.bench.tsx   (ssr lane)
 *   - test/server/spread-static-tail.spec.tsx    (output invariants)
 */
import type { JSX } from "@solidjs/web";

export interface Row {
  id: string;
  label: string;
  attrs: Record<string, any>;
}

export function makeRows(count: number): Row[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `r${i}`,
    label: `Row ${i}`,
    attrs: { id: `row-${i}`, title: `Row ${i}`, "aria-posinset": i + 1 }
  }));
}

/** Rows whose spread carries `class` — the statics must win over it. */
export function collidingRows(count: number): Row[] {
  return makeRows(count).map(row => ({
    ...row,
    attrs: {
      ...row.attrs,
      get class() {
        collidingReads++;
        return "from-spread";
      }
    }
  }));
}
export let collidingReads = 0;
export function resetCollidingReads() {
  collidingReads = 0;
}

export const forms = {
  tail: (row: Row): JSX.Element => (
    <li {...row.attrs} class="row" data-kind="item">
      {row.label}
    </li>
  ),
  head: (row: Row): JSX.Element => (
    <li class="row" data-kind="item" {...row.attrs}>
      {row.label}
    </li>
  ),
  mixed: (row: Row): JSX.Element => (
    <li {...row.attrs} class="row" data-id={row.id}>
      {row.label}
    </li>
  ),
  dynhead: (row: Row): JSX.Element => (
    <li data-id={row.id} class="row" {...row.attrs}>
      {row.label}
    </li>
  )
};

export function List(props: { rows: Row[]; render: (row: Row) => JSX.Element }): JSX.Element {
  return <ul>{props.rows.map(props.render)}</ul>;
}
