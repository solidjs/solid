export function Greeting({ name }) @{
  const message = name ? `Hello, ${name}` : "Hello, stranger";

  <div class="card">
    <p>{message}</p>
  </div>
}

const icon = <svg aria-hidden="true" />;
