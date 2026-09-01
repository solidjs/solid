export function DirectChild({ name }) @{
  <section>
    before
    @{
      const greeting = name.trim();
      <strong>{greeting}</strong>
    }
    after
  </section>
}
