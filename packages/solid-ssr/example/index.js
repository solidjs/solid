const path = require("path")
const ssr = require("../server")

const render = ssr({ path: path.resolve(__dirname, 'lib') })

console.log("http://localhost:8080/");
require("http")
  .createServer(async (req, res) => {
    if (req.url === '/') {
      const html = await render(req);
      res.writeHead(200, { "content-type": "text/html;charset=utf-8" });
      res.end(html);
    }
  })
  .listen(8080);
