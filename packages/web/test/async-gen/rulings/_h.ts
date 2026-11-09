/** Small constructors shared by the ruling files. */
import type { Node, Read, SrcRef, Step } from "../scenario.js";

export const s = (i: number): SrcRef => ({ k: "s", i });
export const m = (i: number): SrcRef => ({ k: "m", i });
export const plain = (src: SrcRef): Read => ({ how: "plain", src });
export const lat = (src: SrcRef): Read => ({ how: "latest", src });
export const pend = (src: SrcRef): Read => ({ how: "pending", src });
export const pendLat = (src: SrcRef): Read => ({ how: "pendingLatest", src });
/** One `<span>` with one text hole per read, one effect per hole. */
export const leaf = (...text: Read[]): Node => ({ t: "leaf", text, attrs: [], grouped: false });
/** One `<span>` with one attribute per read, all in ONE effect (one scope). */
export const scope = (...attrs: Read[]): Node => ({ t: "leaf", text: [], attrs, grouped: true });
export const group = (...kids: Node[]): Node => ({ t: "group", kids });
export const loading = (child: Node, on?: Read[]): Node => ({
  t: "loading",
  child,
  ...(on ? { on } : {})
});
export const show = (
  when: Read,
  child: Node,
  opts: { fallback?: boolean; owns?: number[] } = {}
): Node => ({
  t: "show",
  when,
  child,
  fallback: !!opts.fallback,
  ...(opts.owns ? { owns: opts.owns } : {})
});
export const asyncMemo = (src: SrcRef, how: "plain" | "latest" = "plain") => ({
  async: true,
  deps: [{ src, how }],
  poison: null
});
export const syncMemo = (
  ...deps: { src: SrcRef; how: "plain" | "latest" | "pending"; when?: SrcRef }[]
) => ({ async: false, deps, poison: null });
export const write = (sIdx: number, v: number): Step => ({ t: "write", s: sIdx, v });
export const settle = (pick = 0): Step => ({ t: "settle", pick });
export const flush: Step = { t: "flush" };
export const task: Step = { t: "task" };
export const micro: Step = { t: "micro" };
export const act = (sIdx: number, v: number): Step => ({ t: "action", s: sIdx, v });
