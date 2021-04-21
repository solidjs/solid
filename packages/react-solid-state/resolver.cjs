module.exports = (request, options) => {
  return options.defaultResolver(request, {
    ...options,
    packageFilter: pkg => {
      if(!pkg.name.startsWith("solid-js")) return pkg;
      return {
        ...pkg,
        main: pkg.browser || pkg.main,
      };
    },
  });
};