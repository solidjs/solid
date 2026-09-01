interface User {
  name: string;
  role: "admin" | "member";
}

export function Profile({ user }: { user: User }) @{
  const label: string = user.name.toUpperCase();

  <section>
    <h2>{label}</h2>
    @if (user.role === "admin") {
      <span class="pill">Admin</span>
    }
  </section>
}
