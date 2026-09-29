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

// A spread element's named `ref`/`on*` compile to the same claim map a
// template element's do — duplicate refs merged, a tuple kept whole —
// handed to `ssrElement` as a thunk it reads only inside a server
// component's render, wherever the attributes sit relative to the spreads
// (before, between, after). Plain SSR drops them; the tail after the last
// spread still bakes its statics; the spread's own handler keys are the
// runtime's to bind.
const spread = (
  <button {...rest} onClick={row.go} ref={row.el} class="static">
    <span onInput={row.type} {...more} onKeyDown={[row.key, 1]} {...last} />
    <i ref={[row.a, row.b]} ref={row.c} {...last} onClick={localHandler} />
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
