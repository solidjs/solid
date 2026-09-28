// Attribute slots (principles §9.2.3). Ref/event positions on server intrinsics
// compile to one guarded whole-attribute claim hole per element, gated on
// the render context's claims flag so plain SSR never evaluates the
// expressions.
const template = (
  <div>
    <button class="copy" onClick={props.onCopy} ref={props.btn}>
      Copy
    </button>
    <input onInput={props.onType} on:custom-thing={props.onCustom} />
    <span onClick={localHandler}>warns at render when the gate is open</span>
    <a href="/x" ref={first} ref={second}>
      multiple refs merge to an array
    </a>
    <section oncapture:click={props.onCapture}>capture variants stay dropped</section>
  </div>
);

// A dynamic `class`/`style` is a whole-attribute element-attribute hole
// rather than a value inside template quotes, so a slot value read at the
// position — whole, or as a name's condition in object form — binds instead
// of stringifying. Object literals stay objects. Static strings stay static.
const dynamicToo = (
  <li class={status()} style={row.style} onClick={props.onPick}>
    {label()}
  </li>
);

const objects = (
  <li class={{ completed: row.done, editing: row.editing }} style={{ color: row.color }}>
    <input type="checkbox" checked={row.done} hidden={row.removed} onInput={row.toggle} />
    <span class="static stays">{label()}</span>
  </li>
);
