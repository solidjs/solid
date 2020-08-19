const fs = require("fs");
const path = require("path");
const server = require(process.argv[2]);

server({ url: process.argv[4] }).then(res => {
  fs.writeFile(process.argv[3], res, () => {
    process.exit(0);
  });
});
