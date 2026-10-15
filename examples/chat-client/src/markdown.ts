// Enough markdown for a reply: a block is a paragraph, a fenced code block,
// or one bullet. No inline syntax and no dependency — what matters here is
// the shape: a list of blocks of which only the last one grows.

export type Kind = "p" | "pre" | "li";

export interface Block {
  kind: Kind;
  /** The block's source, trailing blank lines included: the blocks joined
   * with "\n" are the text as the model sent it. */
  text: string;
}

/** Splits text into blocks: at a blank line (outside a fence) and at each
 * bullet. Every character lands in exactly one block. */
export function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let lines: string[] = [];
  let fenced = false;
  let gap = false;
  for (const line of text.split("\n")) {
    const blank = !fenced && line.trim() === "";
    const bullet = !fenced && line.startsWith("- ");
    if (lines.length && ((gap && !blank) || bullet)) {
      blocks.push(lines.join("\n"));
      lines = [];
    }
    if (line.startsWith("```")) fenced = !fenced;
    lines.push(line);
    gap = blank;
  }
  if (lines.length) blocks.push(lines.join("\n"));
  return blocks;
}

export const kindOf = (text: string): Kind =>
  text.startsWith("```") ? "pre" : text.startsWith("- ") ? "li" : "p";

/** Adds a delta to the last block, opening new blocks where it splits. The
 * common chunk — a word inside a paragraph — is one write, to one text. */
export function append(blocks: Block[], delta: string): void {
  const last = blocks.at(-1);
  const parts = splitBlocks((last?.text ?? "") + delta);
  if (last) {
    last.text = parts[0];
    last.kind = kindOf(parts[0]);
  } else blocks.push({ kind: kindOf(parts[0]), text: parts[0] });
  for (const text of parts.slice(1)) blocks.push({ kind: kindOf(text), text });
}

/** The code inside a fence, with the fence lines removed. */
export const unfence = (block: string): string =>
  block.replace(/^```[^\n]*\n?/, "").replace(/\n?```\s*$/, "");
