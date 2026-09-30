// Tier-1 SSR-lane bench: the slot-aware spread walk (principles §9.2.3),
// under `renderServerComponent` — the stream face, where `context.claims`
// is armed for the whole render and `ssrElement`'s walk probes every
// object value and every non-literal source for a stand-in. Two forms:
//
//   bound — `<li {...{ …statics, class: { done: row.done }, hidden:
//           row.removed, onClick: row.pick }}>`: one occurrence per row,
//           read at a class-name, an attribute and a handler position. The
//           walk mints three markers per element and the sink one record
//           per occurrence — the per-row cost of an attribute slot.
//   armed — the same spread with plain string values: the gate is up (the
//           `context.claims` read per element) but no value is an object,
//           so every slot probe short-circuits. The control — what a
//           server component's ordinary elements pay for being inside one.
//
// `spread-static-tail` is the plain-SSR side of the same walk (the gate
// down); the two lanes together cover both branches of `slots`.
//
// Vitest's reported mean is the full stream — render, records, html chunk.

/**
 * @jsxImportSource @solidjs/web
 */
import { bench } from "vitest";
import { renderServerComponent } from "../../frames/src/frame-sink.js";

const ROWS = 500;
const rows = Array.from({ length: ROWS }, (_, i) => ({
  id: i,
  title: `Row ${i}`,
  kind: i % 2 ? "odd" : "even"
}));

const Bound = (props: any) => (
  <ul>
    {rows.map(r => {
      const row = props.row({ id: r.id });
      return (
        <li
          {...{
            "data-kind": r.kind,
            title: r.title,
            class: { done: row.done },
            hidden: row.removed,
            onClick: row.pick
          }}
        >
          {r.title}
        </li>
      );
    })}
  </ul>
);

const Armed = () => (
  <ul>
    {rows.map(r => (
      <li {...{ "data-kind": r.kind, title: r.title, class: "row" }}>{r.title}</li>
    ))}
  </ul>
);

bench(`spread-slot-walk: ${ROWS} rows (renderServerComponent): bound`, async () => {
  await renderServerComponent(Bound, { frame: { id: "slot-walk-bound" } });
});

bench(`spread-slot-walk: ${ROWS} rows (renderServerComponent): armed`, async () => {
  await renderServerComponent(Armed, { frame: { id: "slot-walk-armed" } });
});
