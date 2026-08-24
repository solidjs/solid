import { mkdir, readFile, writeFile } from "node:fs/promises";

const source = new URL("../server-functions/src/", import.meta.url);
const destination = new URL("../types/server-functions/", import.meta.url);

await mkdir(destination, { recursive: true });

for (const file of ["shared", "flash", "client", "server", "rich-args"]) {
  const declaration = await readFile(new URL(`${file}.d.ts`, source), "utf8");
  await writeFile(
    new URL(`${file}.d.ts`, destination),
    declaration
      .replaceAll("../../serialization/src/decode.js", "../serializer-decode.js")
      .replaceAll("../../src/response.js", "../response.js")
      .replaceAll("../../server/server.js", "../server.js")
  );
}
