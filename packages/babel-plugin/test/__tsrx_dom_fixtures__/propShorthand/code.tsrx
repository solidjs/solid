import { Input } from "./input.js";

export function Field({ value, onChange }) @{
  <Input {value} {onChange} />
}

export function Host({ title }) @{
  <section {title} data-fixed="yes">
    <p>{title}</p>
  </section>
}
