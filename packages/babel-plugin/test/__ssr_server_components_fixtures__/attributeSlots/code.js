// Attribute slots (principles §9.2.3). Ref/event positions on server intrinsics
// compile to one guarded whole-attribute claim hole per element, gated on
// the render context's claims flag so plain SSR never evaluates the
// expressions.
const template = (
  <div>
    <button class="copy" onClick={props.onCopy} ref={props.btn}>
      Copy
    </button>
    <input onInput={props.onType} onKeyDown={props.onKey} />
    <span onClick={localHandler}>warns at render when the gate is open</span>
    <a href="/x" ref={first} ref={second}>
      multiple refs merge to an array
    </a>
  </div>
);

// A spread element has no claim hole: its named `ref`/`on*` ride as SOURCE
// properties (a getter when dynamic), before or after the spreads, and
// `ssrElement`'s walk binds a slot value found at such a key of a source
// exactly as it does for one inside the spread object. Plain SSR drops
// them; the tail after the last spread still bakes its statics.
const spread = (
  <button {...rest} onClick={row.go} ref={row.el} class="static">
    <span {...more} onInput={row.type} />
    <i ref={row.only} {...last} />
  </button>
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
