const fs = require("fs");
const path = require("path");
const server = require(process.argv[2]);

async function write() {
  const res = await server({ url: process.argv[4] });
  fs.mkdir(path.dirname(process.argv[3]), {recursive: true},  () =>
    fs.writeFile(process.argv[3], res, () => process.exit(0))
  );
}
write();
