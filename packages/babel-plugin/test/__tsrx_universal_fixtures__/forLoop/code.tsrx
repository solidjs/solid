export function List({ items }) @{
  <list>
    @for (const item of items; key item.id) {
      <cell>{item.label}</cell>
    }
  </list>
}
