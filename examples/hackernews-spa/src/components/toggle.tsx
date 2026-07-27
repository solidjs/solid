import { createSignal } from "solid-js";

export default function Toggle(props: { children: any }) {
  const [open, setOpen] = createSignal(true);

  return (
    <>
      <div class={["toggle", { open: open() }]}>
        <a onClick={() => setOpen(o => !o)}>{open() ? "[-]" : "[+] comments collapsed"}</a>
      </div>
      <ul class="comment-children" style={{ display: open() ? "block" : "none" }}>
        {props.children}
      </ul>
    </>
  );
}
