const { fork } = require("child_process");

class ForkBalancer {
  constructor({ path = "", forks = 2, maxRAM = 250, args = [], requestLimit = 100 }) {
    this.activeFork = 0;
    this.forks = forks;
    this.maxRAM = maxRAM;
    this.path = path;
    this.args = args;
    this.resolvers = new Map();
    this.requestLimit = requestLimit;
    this.renderers = Array.from({ length: forks }, () => this.createFork());
  }

  getFromRenderer(req) {
    const { resolvers, maxRAM, activeFork, restartFork, renderers, requestLimit } = this;
    const renderer = renderers[activeFork];

    return new Promise(function(resolve, reject) {
      try {
        renderer.once("message", (res) => {
          resolvers.delete(req.url);
          resolve(res);

          if (res.kill) restartFork();
        });

        if (!resolvers.has(req.url)) {
          renderer.setMaxListeners(requestLimit);
          resolvers.set(req.url, resolve);
          renderer.send({ req, maxRAM });
        }
      } catch (error) {
        resolvers.delete(req.url);
        reject(error);
      }
    });
  }

  createFork() {
    const { path, args } = this;
    return fork(path, args);
  };

  restartFork() {
    const { activeFork, renderers, next, createFork } = this;
    const renderer = renderers[activeFork];
    next();
    renderer.kill();
    this.renderers[activeFork] = createFork();
  };

  next() {
    const { activeFork, forks } = this;
    if (activeFork === forks - 1) {
      this.activeFork = 0;
    } else {
      this.activeFork++;
    }
  };
}

module.exports = function createSSR(options) {
  const forkBalancer = new ForkBalancer(options);
  return async function render(req) {
    const { string } = await forkBalancer.getFromRenderer({
      url: req.url, cookies: req.cookies, headers: req.headers
    });
    return string;
  }
}
