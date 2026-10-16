// Copy, for every code block in the thread. The buttons are server markup;
// this client component is placed once by the thread (a slot) and answers
// their clicks from the document, so a button that arrives mid-reply works
// with nothing bound to it. It renders nothing.
//
// Once rather than per block: a slot placed inside markup that re-renders
// from the live source (the reply being written) would stop that markup
// updating, since the server cannot place a client component twice.
import { onSettled } from "solid-js";

export default function CopyCode() {
  onSettled(() => {
    const onClick = (e: MouseEvent) => {
      const button = (e.target as Element | null)?.closest?.("button.copy-code");
      if (!button) return;
      const code = button.parentElement?.querySelector("code");
      if (!code) return;
      navigator.clipboard.writeText(code.textContent ?? "").catch(() => {});
      button.textContent = "Copied";
      setTimeout(() => (button.textContent = "Copy"), 1200);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  });
  return null;
}
