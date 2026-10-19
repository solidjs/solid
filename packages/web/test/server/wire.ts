// Reading a frame stream's wire (frame-wire.ts) in assertions: record
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
