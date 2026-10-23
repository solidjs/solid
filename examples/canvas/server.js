// The whole production server: static client assets plus one import — the
// built server bundle's `handleRequest`, an adapter-agnostic web
// `Request -> Response` that streams the SSR render, resolves hashed assets
// through the build manifest, and serves the `/_server` endpoint. The node
// <-> web plumbing below is the only glue.
//
// Responses are compressed because every deployed host compresses text, and
// a benchmark against an uncompressed origin measures the harness rather than
// the app. Brotli quality 4 keeps per-chunk flushes cheap while still ~6x on
// HTML; each SSR chunk is flushed so streaming boundaries survive.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { brotliCompressSync, createBrotliCompress, createGzip, constants } from "node:zlib";
import { handleRequest } from "./dist/server/server.js";

const root = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3014;

// The cap. Every open tab holds one room stream, and every value goes down
// each of them, so the tabs a process can keep up with are a number: past it
// a new tab is told the room is full (503, try again shortly), and the tabs
// already in stay smooth. Its presence is refused with it, so it never takes
// a seat it cannot see. Each kind of stream is counted on its own, since a
// tab opens both in no set order. See the README's Cost section for where 70
// comes from.
const MAX_TABS = Number(process.env.CANVAS_MAX_TABS || 70);
const open = { room: 0, presence: 0 };
const streamOf = url =>
  url.startsWith("/_server/live/getRoom-")
    ? "room"
    : url.startsWith("/_server/live/getPresence-")
      ? "presence"
      : null;

const MIME = {
  ".js": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".ico": "image/x-icon",
  ".svg": "image/svg+xml"
};

/** Negotiated streaming compressor piped into `res`, or null for identity. */
function encoder(req, res) {
  const accepts = req.headers["accept-encoding"] || "";
  let stream;
  if (/\bbr\b/.test(accepts)) {
    res.setHeader("Content-Encoding", "br");
    stream = createBrotliCompress({ params: { [constants.BROTLI_PARAM_QUALITY]: 4 } });
  } else if (/\bgzip\b/.test(accepts)) {
    res.setHeader("Content-Encoding", "gzip");
    stream = createGzip();
  } else return null;
  stream.pipe(res);
  return stream;
}

// Static assets compress once at a higher quality — they're cached, not streamed.
const staticBrotli = new Map();

function webRequest(req, res) {
  const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);
  const method = req.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(req);
  // The client going away is the request's abort: the runtime tears the
  // response's sources down on it (a live source's `finally` is the leave),
  // and the sources themselves wait on it (server/db.ts `changed`). 'close'
  // fires on normal completion too; `writableEnded` tells the two apart.
  const controller = new AbortController();
  res.once("close", () => {
    if (!res.writableEnded) controller.abort();
  });
  return new Request(url, {
    method,
    headers: req.headers,
    body,
    signal: controller.signal,
    ...(body ? { duplex: "half" } : {})
  });
}

createServer(async (req, res) => {
  const url = req.url || "/";

  // Server-function calls skip the disk: a miss there throws, and pointer
  // positions arrive as a POST per frame per tab.
  if (url !== "/" && !url.startsWith("/_server/") && !url.includes("..")) {
    const file = url.split("?")[0];
    try {
      const content = readFileSync(path.resolve(root, "dist/client" + file));
      const headers = {
        "Content-Type": MIME[path.extname(file)] ?? "application/octet-stream",
        "Cache-Control": "public, max-age=3600"
      };
      if (/\bbr\b/.test(req.headers["accept-encoding"] || "")) {
        let compressed = staticBrotli.get(file);
        if (!compressed) {
          compressed = brotliCompressSync(content, {
            params: { [constants.BROTLI_PARAM_QUALITY]: 9 }
          });
          staticBrotli.set(file, compressed);
        }
        res.writeHead(200, { ...headers, "Content-Encoding": "br" });
        return res.end(compressed);
      }
      res.writeHead(200, headers);
      return res.end(content);
    } catch {
      // Fall through to the handler (SSR routes, /_server, ...).
    }
  }

  const stream = streamOf(url);
  if (stream) {
    if (open[stream] >= MAX_TABS) {
      res.writeHead(503, { "Retry-After": "15", "Content-Type": "text/plain" });
      return res.end("The room is full");
    }
    open[stream]++;
    res.once("close", () => open[stream]--);
  }

  try {
    const response = await handleRequest(webRequest(req, res));
    const cookies = response.headers.getSetCookie?.();
    response.headers.forEach((value, key) => {
      if (key !== "set-cookie") res.setHeader(key, value);
    });
    if (cookies?.length) res.setHeader("set-cookie", cookies);
    res.statusCode = response.status;
    const out = encoder(req, res) ?? res;
    if (response.body) {
      for await (const chunk of response.body) {
        out.write(chunk);
        if (out !== res) out.flush();
      }
    }
    out.end();
  } catch (e) {
    // A tab that closes mid-stream aborts its response; that is leaving, not a failure.
    if (e?.name === "AbortError") return;
    console.error(e);
    res.statusCode = 500;
    res.end(e.message);
  }
}).listen(PORT, () => {
  console.log(`Canvas on http://localhost:${PORT}`);
});
