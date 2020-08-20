const fs = require("fs");
const server = require(process.argv[2]);

async function write() {
  const res = await server({ url: process.argv[4] });
  fs.writeFile(process.argv[3], res, () => process.exit(0));
}
write();
