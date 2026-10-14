// What the server keeps. Only the server reads these: the browser gets
// markup, never a thread or a message as data.
export interface Thread {
  id: string;
  /** The first line of the first prompt. */
  title: string;
  createdAt: number;
  updatedAt: number;
}

export type MessageStatus = "complete" | "generating" | "stopped" | "failed";

export interface Message {
  id: string;
  threadId: string;
  role: "user" | "assistant";
  /** Markdown. For an assistant message that is generating, the reply so far. */
  text: string;
  /** The model's reasoning, when it sends any. */
  reasoning: string;
  status: MessageStatus;
  /** Why it failed, worded by the server. */
  error?: string;
  /** Set when a generation completes. */
  usage?: { tokens: number; seconds: number };
  createdAt: number;
}
