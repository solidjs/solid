export function Dashboard({ user }) @{
  if (!user) {
    return null;
  }
  if (user.banned) {
    return <p>Access revoked</p>;
  }

  <main>
    <h1>Welcome back, {user.name}</h1>
  </main>
}
