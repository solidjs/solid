const template = `literal @{ ${"value"} }`;

export function LexicalTraps({ value }) @{
  // @{ this comment is not a statement container
  /* @if (false) { <p>not syntax</p> } */
  const block = "@{ not a block }";
  const lazy = "&{ not a lazy pattern }";

  <pre title="@{">
    {template} / {block} / {lazy} / {value}
  </pre>
}
