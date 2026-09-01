export function Panel({ as = "section", title }) @{
  <{as} class="panel">
    <h2>{title}</h2>
  </{as}>
}

export function Pick({ expanded, ExpandedBody, CompactBody, item }) @{
  const Body = expanded ? ExpandedBody : CompactBody;

  <{Body} item={item} />
}
