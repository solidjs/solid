// A turn of the conversation. The browser keeps these; the server sees them
// only as the history it is asked to continue.
export interface Turn {
  role: "user" | "assistant";
  /** Markdown. */
  text: string;
  /** An assistant turn cut short: by Stop, or by the next question. */
  stopped?: boolean;
}
