`(() => {
  const h = _$HYDRATION,
    resources = {};
  h.resolveResource = (id, data) => {
    const r = resources[id];
    if(!r) return resources[id] = data;
    delete resources[id];
    r(data);
  };
  h.loadResource = (id) => {
    const r = resources[id];
    if(!r) {
      let r,
        p = new Promise(res => r = res);
      resources[id] = r;
      return p;
    }
    delete resources[id];
    return Promise.resolve(r);
  }
})();`