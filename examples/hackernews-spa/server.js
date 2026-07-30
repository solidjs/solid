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
const PORT = process.env.PORT || 3005;

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

function webRequest(req) {
  const url = new URL(req.url || "/", `http://${req.headers.host || `localhost:${PORT}`}`);
  const method = req.method || "GET";
  const body = method === "GET" || method === "HEAD" ? undefined : Readable.toWeb(req);
  return new Request(url, {
    method,
    headers: req.headers,
    body,
    ...(body ? { duplex: "half" } : {})
  });
}

createServer(async (req, res) => {
  const url = req.url || "/";

  if (url !== "/" && !url.includes("..")) {
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

  try {
    const response = await handleRequest(webRequest(req));
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
    console.error(e);
    res.statusCode = 500;
    res.end(e.message);
  }
}).listen(PORT, () => {
  console.log(`HackerNews (SSR + hydration) on http://localhost:${PORT}`);
});
