/**
 * @jsxImportSource @solidjs/web
 *
 * Kobalte-shaped polymorphic component chain — shared fixture.
 *
 * Headless UI libraries build every element the same way: a public component
 * merges defaults into its props, consumes a few keys, and forwards the rest
 * into a polymorphic renderer that resolves an `as` prop. Composed components
 * (`Dialog.Trigger` renders `Button.Root` renders `Polymorphic`) stack that
 * pattern, so one `<a>` in the DOM is reached through several `merge()` /
 * `omit()` layers plus the compiler's own call-site `mergeProps` at each
 * `<Comp static={…} {...rest} />`. The props plumbing IS the cost of these
 * libraries; nothing about the element itself is expensive.
 *
 * This file is the one source for that shape. It is imported by:
 *   - test/polymorphic-chain.bench.tsx           (dom lane, jsdom)
 *   - test/server/polymorphic-chain.bench.tsx    (ssr lane)
 *   - test/harness/scenarios.tsx                 (hydration parity)
 * so the DOM bench, the SSR bench, and the hydration invariants all measure
 * the identical tree, compiled by the respective generate.
 *
 * Fidelity notes (vs kobalte `solid2` branch):
 *   - `Polymorphic` uses `dynamic()` rather than the deprecated `<Dynamic>`.
 *   - `Button.Root`'s native-tag detection reads the resolved `as` instead of
 *     the mounted element's tagName (that path needs a DOM ref and would make
 *     the SSR and DOM trees diverge). Same attribute set results.
 *   - `Dialog.Trigger` reads open state from context, as Kobalte does; one
 *     `Dialog` provider wraps a list so the per-row cost is the trigger chain.
 *
 * `CompiledRow` is the floor: the same final element written directly, so a
 * bench delta between it and `TriggerRow` is attributable to the chain alone.
 */
import { createContext, createSignal, merge, omit, useContext, For, type Accessor } from "solid-js";
import { dynamic, type JSX } from "@solidjs/web";

// --- Layer 3: Polymorphic ------------------------------------------------

export type PolymorphicProps = { as: any } & Record<string, any>;

/** Renders its `as` prop with everything else forwarded (kobalte polymorphic.tsx). */
export function Polymorphic(props: PolymorphicProps): JSX.Element {
  const others = omit(props, "as");
  const Tag = dynamic(() => props.as);
  return <Tag {...others} />;
}

// --- Layer 2: Button.Root -----------------------------------------------

/**
 * Defaults merged in, a few keys consumed, aria derived from what the
 * element will be, rest forwarded (kobalte button-root.tsx).
 */
export function ButtonRoot(props: Record<string, any>): JSX.Element {
  const mergedProps = merge({ type: "button" }, props);
  const others = omit(mergedProps, "type", "disabled");
  const isNativeButton = () => (mergedProps.as ?? "button") === "button";
  return (
    <Polymorphic
      as="button"
      type={isNativeButton() ? mergedProps.type : undefined}
      role={isNativeButton() ? undefined : "button"}
      tabindex={isNativeButton() || mergedProps.disabled ? undefined : 0}
      disabled={isNativeButton() ? mergedProps.disabled : undefined}
      aria-disabled={!isNativeButton() && mergedProps.disabled ? "true" : undefined}
      data-disabled={mergedProps.disabled ? "" : undefined}
      {...others}
    />
  );
}

// --- Layer 1: Dialog + Dialog.Trigger --------------------------------------

interface DialogContextValue {
  isOpen: Accessor<boolean>;
  toggle: () => void;
}

const DialogContext = createContext<DialogContextValue>();

export function Dialog(props: { open?: boolean; children: JSX.Element }): JSX.Element {
  const [isOpen, setIsOpen] = createSignal(props.open ?? false);
  return (
    <DialogContext value={{ isOpen, toggle: () => setIsOpen(o => !o) }}>
      {props.children}
    </DialogContext>
  );
}

/** Context-driven aria, consumes `onClick`, forwards the rest (kobalte dialog-trigger.tsx). */
export function DialogTrigger(props: Record<string, any>): JSX.Element {
  const context = useContext(DialogContext)!;
  const others = omit(props, "onClick");
  return (
    <ButtonRoot
      aria-haspopup="dialog"
      aria-expanded={context.isOpen() ? "true" : "false"}
      data-expanded={context.isOpen() ? "" : undefined}
      data-closed={context.isOpen() ? undefined : ""}
      onClick={(e: MouseEvent) => {
        props.onClick?.(e);
        context.toggle();
      }}
      {...others}
    />
  );
}

// --- Rows -------------------------------------------------------------------

export interface Row {
  id: number;
  label: Accessor<string>;
  setLabel: (next: string) => string;
}

export function makeRows(start: number, count: number): Row[] {
  const rows = new Array<Row>(count);
  for (let i = 0; i < count; i++) {
    const [label, setLabel] = createSignal(`row-${start + i}`);
    rows[i] = { id: start + i, label, setLabel };
  }
  return rows;
}

/**
 * What an application writes: a trigger rendered as a link, with a mix of
 * static attributes (data properties on the compiled props object) and
 * reactive ones (getters). `as="a"` overrides Button.Root's default, so the
 * chain exercises shadowing through merge → omit → merge, not just pass-through.
 */
export function TriggerRow(props: { row: Row }): JSX.Element {
  const { row } = props;
  return (
    <DialogTrigger
      as="a"
      class="btn"
      href={`#row-${row.id}`}
      data-x="1"
      aria-label={row.label()}
      title={row.label()}
    >
      {row.label()}
    </DialogTrigger>
  );
}

/** Floor: the element `TriggerRow` resolves to, written directly. */
export function CompiledRow(props: { row: Row }): JSX.Element {
  const { row } = props;
  const context = useContext(DialogContext)!;
  return (
    <a
      role="button"
      tabindex={0}
      aria-haspopup="dialog"
      aria-expanded={context.isOpen() ? "true" : "false"}
      data-expanded={context.isOpen() ? "" : undefined}
      data-closed={context.isOpen() ? undefined : ""}
      class="btn"
      href={`#row-${row.id}`}
      data-x="1"
      aria-label={row.label()}
      title={row.label()}
      onClick={() => context.toggle()}
    >
      {row.label()}
    </a>
  );
}

export type RowRenderer = (row: Row) => JSX.Element;

export const forms: Record<"compiled" | "chain", RowRenderer> = {
  compiled: row => <CompiledRow row={row} />,
  chain: row => <TriggerRow row={row} />
};

/** A `Dialog` wrapping a list of rows — the tree every consumer of this fixture renders. */
export function TriggerList(props: { rows: Accessor<Row[]>; render: RowRenderer }): JSX.Element {
  return (
    <Dialog>
      <ul>
        <For each={props.rows()}>{row => <li>{props.render(row)}</li>}</For>
      </ul>
    </Dialog>
  );
}
