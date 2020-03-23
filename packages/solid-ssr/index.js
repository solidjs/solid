const { init, Node, customElements, HTMLElement } = require("basichtml");

const { document, window } = init({});
global.window = window;
global.document = document;
global.Node = Node;
global.customElements = customElements;
global.HTMLElement = HTMLElement;

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
