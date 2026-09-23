/**
 * The client's side of a server hand-off: a `<Loading>` boundary whose
 * fragment the server could not produce — its async rejected after the shell
 * flushed (`handling: "client"` on the server error hook, `outcome:
 * "client"` on the server's `"boundary"` record), or the stream was cut
 * before the fragment arrived — renders its children as fresh client DOM
 * instead of adopting server markup. One record per such boundary, on
 * `OBSERVE.records.subscribe("recovery", …)`, delivered when the fresh
 * render has committed. Joins the server's record by `id`.
 */
export interface RecoveryEvent {
  /** The boundary's hydration id — the server `"boundary"` record's `id`. */
  id: string;
  /** When the boundary registered against the fragment on the client (`performance.now()` clock). */
  at: number;
  /**
   * Registration → the rejection reaching the client, in milliseconds: the
   * fallback the person looked at while the server was still trying. 0 when
   * the rejection had already arrived by the time the boundary hydrated.
   */
  waitedMs: number;
  /** The fresh client render of the children, in milliseconds: from the rejection to the content committed. */
  renderMs: number;
}

/** Live handles beside a `"recovery"` record — none today; the error stayed on the server. */
export interface RecoveryLive {}

export type RecoveryListener = (event: RecoveryEvent, live: RecoveryLive) => void;
