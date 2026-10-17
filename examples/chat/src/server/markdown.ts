import "server-only";
// Markdown and syntax highlighting. Both libraries are heavy, and both stay
// here: the browser receives the HTML they produce and never the code.
import { Marked } from "marked";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";

hljs.registerLanguage("javascript", javascript);
hljs.registerAliases(["js", "jsx", "ts", "tsx"], { languageName: "javascript" });

const marked = new Marked();

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };
const escapeHtml = (text: string) => text.replace(/[&<>]/g, c => HTML_ESCAPES[c]);

export interface Segment {
  /** A fenced code block (highlighted), or everything between two of them. */
  code: boolean;
  html: string;
  /** A code block's own text, for its Copy button. */
  text?: string;
}

/**
 * Markdown as prose and code segments. Prose is opaque HTML; code blocks
 * come back separately so the component can put a Copy button on each.
 * `partial` says the text is still arriving, and closes what it left open.
 */
export function render(md: string, partial: boolean): Segment[] {
  const tokens = marked.lexer(partial ? closePartial(md) : md);
  const out: Segment[] = [];
  let prose: string[] = [];
  const flush = () => {
    if (prose.length) {
      out.push({ code: false, html: marked.parse(prose.join(""), { async: false }) as string });
      prose = [];
    }
  };
  for (const token of tokens) {
    if (token.type === "code") {
      flush();
      const lang = (token.lang || "").trim().split(/\s+/)[0];
      const html = hljs.getLanguage(lang)
        ? hljs.highlight(token.text, { language: lang }).value
        : escapeHtml(token.text);
      out.push({ code: true, html, text: token.text });
    } else {
      prose.push(token.raw);
    }
  }
  flush();
  return out;
}

// A reply that is still arriving dangles inline delimiters: `**Solid` shows
// literal asterisks until the closer comes, and a half-arrived link sits raw
// for longer. Close them for this render. Fenced code needs no help (an
// unclosed fence is code to the end of input), and on the finished text
// everything balances, so this changes nothing.
function closePartial(md: string): string {
  // Inside an open code fence the tail is code: nothing to balance.
  if ((md.match(/(^|\n)```/g) || []).length % 2 === 1) return md;
  // Inline constructs can't span paragraphs: only the last one can dangle.
  const cut = md.lastIndexOf("\n\n");
  const head = cut === -1 ? "" : md.slice(0, cut + 2);
  let tail = cut === -1 ? md : md.slice(cut + 2);
  // A half-arrived link or image: hide it rather than close it.
  tail = tail.replace(/!?\[[^\]]*(\]\([^)\s]*)?$/, "");
  // Closers must hug the text (`**Solid **` is not emphasis).
  tail = tail.replace(/\s+$/, "");
  // An odd backtick makes the rest of the line code: close it first, or the
  // emphasis balancing below would count asterisks inside it.
  if ((tail.match(/`/g) || []).length % 2 === 1) tail += "`";
  const bold = (tail.match(/\*\*/g) || []).length % 2 === 1;
  const italic = (tail.replace(/\*\*/g, "").match(/\*/g) || []).length % 2 === 1;
  if (italic) tail += "*";
  if (bold) tail += "**";
  return head + tail;
}
