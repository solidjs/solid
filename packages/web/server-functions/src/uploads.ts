// @ts-nocheck
// Files and blobs in server function arguments, on the codec path.
//
// The client sends a call whose arguments hold files as multipart form data:
// - the codec output in the `UPLOAD_ARGS_PART` field;
// - each file in its own `UPLOAD_FILE_PART<index>` part, as it is, without
//   base64.
// The codec output holds only each file's index. The request keeps the
// `Serialized` tag; its multipart content type is what marks an upload.
//
// A seroval plugin made for the call finds the files wherever the codec
// meets one: arguments, arrays, objects, maps, sets, and `FormData` entries.
// The server decodes with a plugin made for the request, which turns each
// index back into its part. Any other body decodes without that plugin, so
// an index in a plain codec body fails to decode.
//
// A multipart part always arrives as a file: an empty type comes back as
// `application/octet-stream`, `lastModified` is the time the server parsed
// it, and some characters in the name are escaped. So the node also holds
// the type, and for a file the name and `lastModified`, and the server
// rebuilds the value from them. Clients before these fields send only the
// index, which reads as the part.
//
// Ported from SolidStart (solidjs/solid-start#2359).

export const UPLOAD_ARGS_PART = "args";
export const UPLOAD_FILE_PART = "file";

const UPLOAD_TAG = "solid/server-function-upload";

/**
 * True for a file or a blob. One from another frame is an instance of that
 * frame's `Blob`, so its shape tells instead.
 */
function isBlob(value) {
  if (typeof Blob !== "undefined" && value instanceof Blob) return true;
  return (
    typeof value === "object" &&
    value !== null &&
    typeof value.size === "number" &&
    typeof value.type === "string" &&
    typeof value.arrayBuffer === "function" &&
    typeof value.slice === "function"
  );
}

function isFile(value) {
  return typeof value.name === "string" && typeof value.lastModified === "number";
}

function malformed() {
  return new TypeError("Malformed server function upload");
}

/**
 * The client half. Each file or blob in the arguments serializes as its
 * index in `files`. A file that appears twice is pushed once, so it arrives
 * as one value.
 */
export function createUploadSerializer(files) {
  const indexOf = value => {
    const index = files.indexOf(value);
    return index === -1 ? files.push(value) - 1 : index;
  };
  // The fields are plain values, so the sync parser works for every mode.
  const parse = (value, ctx) => {
    const node = { i: ctx.parse(indexOf(value)), t: ctx.parse(value.type) };
    if (isFile(value)) {
      node.n = ctx.parse(value.name);
      node.l = ctx.parse(value.lastModified);
    }
    return node;
  };
  return {
    tag: UPLOAD_TAG,
    test: isBlob,
    parse: {
      sync: parse,
      async: async (value, ctx) => {
        const node = { i: await ctx.parse(indexOf(value)), t: await ctx.parse(value.type) };
        if (isFile(value)) {
          node.n = await ctx.parse(value.name);
          node.l = await ctx.parse(value.lastModified);
        }
        return node;
      },
      stream: parse
    },
    serialize: (node, ctx) => ctx.serialize(node.i),
    deserialize: () => {
      throw malformed();
    }
  };
}

/**
 * The server half, made for one request. Each index turns back into its
 * part of `form`. A bad index or a missing part fails the decode.
 */
export function createUploadDeserializer(form) {
  const refuse = () => {
    throw malformed();
  };
  return {
    tag: UPLOAD_TAG,
    test: () => false,
    parse: { sync: refuse, async: refuse, stream: refuse },
    serialize: refuse,
    deserialize: (node, ctx) => {
      const index = ctx.deserialize(node.i);
      if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 0) refuse();
      const part = form.get(UPLOAD_FILE_PART + index);
      if (!isBlob(part)) refuse();
      // A client before the metadata fields sends only the index.
      if (node.t === undefined) return part;
      const type = ctx.deserialize(node.t);
      if (typeof type !== "string") refuse();
      // The new blob or file refers to the bytes of the part instead of copying them.
      if (node.n === undefined) return new Blob([part], { type });
      const name = ctx.deserialize(node.n);
      const lastModified = node.l === undefined ? undefined : ctx.deserialize(node.l);
      if (typeof name !== "string" || typeof lastModified !== "number") refuse();
      return new File([part], name, { type, lastModified });
    }
  };
}

/**
 * The request body for a call with files. `FormData` only takes blobs of its
 * own frame, so a blob from another frame is copied first.
 */
export async function createUploadBody(serialized, files) {
  const form = new FormData();
  form.set(UPLOAD_ARGS_PART, serialized);
  const blobs = await Promise.all(
    files.map(async file =>
      file instanceof Blob ? file : new Blob([await file.arrayBuffer()], { type: file.type })
    )
  );
  for (let i = 0; i < blobs.length; i++) {
    form.set(UPLOAD_FILE_PART + i, blobs[i], files[i].name ?? "blob");
  }
  return form;
}
