// @ts-ignore
globalThis.MessageChannel = class {
  port1: { onmessage?: any } = {};
  port2 = {
    postMessage: () => {
      setTimeout(this.port1.onmessage, 0);
    }
  };
};
