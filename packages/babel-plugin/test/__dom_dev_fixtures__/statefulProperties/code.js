// Stateful DOM properties in dev DOM output (#4186): every write goes
// through `setStatefulProperty` so the dev runtime can report an
// uncommitted edit being overwritten. Production output inlines the same
// writes as assignments.
const grouped = <input class={cls()} value={props.name} onChange={commit} />;

const lone = <input value={text()} />;

const checked = <input type="checkbox" checked={on()} title={title()} />;

const checkableValue = <input type="checkbox" value={choice()} />;

const textarea = <textarea value={text()} />;

const media = <video muted={muted()} />;

const select = (
  <select value={picked()}>
    <option value={first()} selected={isFirst()} />
  </select>
);

const explicitProp = <input prop:value={text()} />;

const defaults = <input defaultValue={text()} defaultChecked={on()} />;

const once = <input value={initial} />;

const spreadInput = <input {...rest} value={text()} />;
