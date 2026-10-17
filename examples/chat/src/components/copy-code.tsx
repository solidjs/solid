// A code block's Copy button. The block is server markup; the server places
// this client component in it (a slot) with the block's text. In the reply
// being written the block keeps growing: each new text reaches the mounted
// button as a new prop, so it stays the same button, "Copied" and all.
import { createSignal } from "solid-js";

export default function CopyCode(props: { code: string }) {
  const [copied, setCopied] = createSignal(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (
    <button
      class="copy-code"
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(props.code).catch(() => {});
        setCopied(true);
        clearTimeout(timer);
        timer = setTimeout(() => setCopied(false), 1200);
      }}
    >
      {copied() ? "Copied" : "Copy"}
    </button>
  );
}
