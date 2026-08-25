// Ref/event positions on server intrinsics compile to one guarded
// whole-attribute claim hole per element (`_bnd`), gated on the render
// context's claims flag so plain SSR never evaluates the expressions.
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

const dynamicToo = (
  <li class={status()} onClick={props.onPick}>
    {label()}
  </li>
);
