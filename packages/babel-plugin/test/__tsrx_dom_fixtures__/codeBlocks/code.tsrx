export function App({ name }) @{
  const title = @{
    const label = name.trim();

    <span>{label}</span>
  };

  <section>
    <h1>{title}</h1>
    {@{
      const footer = name.toUpperCase();

      <footer>{footer}</footer>
    }}
  </section>
}

const nativeTemplate = @{
  const label = "static";

  <span>{label}</span>
};
