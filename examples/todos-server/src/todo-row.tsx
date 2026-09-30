// The row. One component, no directive, no side: the server renders it for
// every todo it has, the client renders it for every todo the server does
// not have yet (an add in flight, or one that failed). What differs is what
// `row` IS at the call site — on the server a BINDING SLOT (server/todos.tsx:
// `props.row({ id, completed })`), whose properties are stand-ins the
// positions below bind and the client owns; on the client the fill's result
// itself (app.tsx: `rowFor(todo)`), so the same positions are ordinary
// bindings. The component cannot tell and does not need to.
//
// Keys are semantic, positions are structural: nothing in `RowBehavior` says
// attribute, class or handler — where each property is bound below does.

/** What the client decides about a row: the values and behavior it owns. */
export interface RowBehavior {
  rowClass: Record<string, boolean>;
  removed: boolean;
  done: boolean;
  onToggle: (e: InputEvent & { currentTarget: HTMLInputElement }) => void;
  onRemove: () => void;
  onRetry: () => void;
  error: string | undefined;
}

export function TodoRow(props: { id: string; title: string; row: RowBehavior }) {
  // `$key` is the <li>'s MORPH identity (server markup: a response keeps the
  // node for the same todo); a DOM compile strips it. The `row` call's own
  // `$key` is the occurrence's identity — two keys, two jobs.
  return (
    <li $key={props.id} class={props.row.rowClass} hidden={props.row.removed}>
      <div class="view">
        <input
          class="toggle"
          type="checkbox"
          checked={props.row.done}
          onInput={props.row.onToggle}
        />
        <label>{props.title}</label>
        <button class="retry" title={props.row.error} onClick={props.row.onRetry} />
        <button class="destroy" onClick={props.row.onRemove} />
      </div>
    </li>
  );
}
