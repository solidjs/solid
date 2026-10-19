// Reading a frame stream's wire (frame-sink.ts) in assertions: record
// batches `{ id, version, r }` beside the `start` / `data` / `outcome`
// messages.

/** What one message writes: the `type` of a message that is not records
 *  (`start`, `data`, `outcome`), else its record keys, space-joined (the
 *  root's content is `""`). */
export const writes = (msg: any): string => msg.type ?? Object.keys(msg.r).join(" ");

/** Whether a message writes the record `key`. */
export const has = (msg: any, key: string): boolean => !!msg.r && key in msg.r;

/** The record `key` as the first message writing it carries it. */
export const record = (msgs: any[], key: string): any => {
  const msg = msgs.find(m => has(m, key));
  return msg && msg.r[key];
};

/** Every record whose key starts with `prefix`, in wire order, as `[key, record]`. */
export const records = (msgs: any[], prefix: string): [string, any][] =>
  msgs.flatMap(m =>
    m.r
      ? Object.keys(m.r)
          .filter(k => k.startsWith(prefix))
          .map(k => [k, m.r[k]] as [string, any])
      : []
  );

/** The message that ends the response (it writes `:complete`), if any. */
export const completion = (msgs: any[]): any => msgs.find(m => has(m, ":complete"));

/** Whether a message writes a segment's content (`seg:<k>`, not its gates). */
export const writesSegment = (msg: any): boolean =>
  !!msg.r && Object.keys(msg.r).some(k => /^seg:[^:]+$/.test(k));

/** The `value` of every record whose key starts with `prefix`, in wire order. */
export const values = (msgs: any[], prefix: string): any[] =>
  records(msgs, prefix).map(([, r]) => r.value);

const contentKind = (key: string): string | undefined =>
  key === ""
    ? ""
    : /^seg:[^:]+$/.test(key)
      ? "seg"
      : /^hole:lh:\d+$/.test(key)
        ? "hole"
        : undefined;

/** The html of every content record — the root (`""`), a segment
 *  (`seg:<k>`), a hole (`hole:lh:<n>`) — in wire order; `only` narrows the
 *  kinds (`""`, `"seg"`, `"hole"`). Row ops (no html) are left out. */
export const content = (msgs: any[], only: string[] = ["", "seg", "hole"]): string[] =>
  msgs.flatMap(m =>
    m.r
      ? Object.keys(m.r)
          .filter(k => only.includes(contentKind(k)!) && typeof m.r[k].value === "string")
          .map(k => m.r[k].value)
      : []
  );
