// Event handler expressions in dev DOM output (#1742): a handler is bound
// once, where its element is created, so any expression that can read
// reactive state goes through `strictHandler(() => expr)`. The dev runtime
// warns on a reactive read there and still tracks it. Identifiers, inline
// functions and literals cannot read anything and compile as in production.
function handler() {}
const local = () => {};

const plain = (
  <div>
    <button onClick={handler} />
    <button onClick={local} />
    <button onClick={() => count(c => c + 1)} />
    <button onClick={unknown} />
  </div>
);

const forwarded = (
  <div>
    <button onClick={props.onClick} />
    <button onClick={makeHandler(id())} />
    <button onClick={selected() ? a : b} />
    <input onInput={store.handlers.input} />
  </div>
);

const bound = (
  <div>
    <button onClick={[props.select, row.id]} />
    <button onClick={[handler, id()]} />
    <input onInput={[props.update]} />
    <input onFocus={[props.focus, row.id]} />
  </div>
);

const nonDelegated = (
  <div>
    <video onPlay={props.onPlay} />
    <video onPlay={() => play()} />
    <dialog onClose={{ handleEvent: props.onClose, once: true }} />
  </div>
);
