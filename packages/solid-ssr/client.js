const { JSDOM } = require("jsdom");

const { window } = new JSDOM("");
global.window = window;
global.document = window.document;
global.Node = window.Node;
global.customElements = window.customElements;
global.HTMLElement = window.HTMLElement;

module.exports = async function handler(code) {
  process.on('message', async params => {
    const { req, res, maxRAM } = params;
    const string = await code(req, res);
    const { heapUsed } = process.memoryUsage();
    if (process.send) {
      process.send({
        key: req.url,
        string,
        kill: heapUsed > maxRAM * 1024 * 1024,
      });
    }
  });
}
