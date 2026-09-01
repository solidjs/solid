export function Shadowed({ name, items }) @{
  const format = (name) => `[${name}]`;
  const mapper = items.map((entry) => {
    const name = entry.key;
    return name + format(name);
  });

  <div title={name}>
    <p>{name}</p>
    <p>{mapper.join(",")}</p>
    {@{
      let name = "inner";
      <em>{name}</em>
    }}
  </div>
}
