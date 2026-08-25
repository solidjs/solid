export const StatusBadge = ({ status }) => @if (status === "active") {
  <span class="badge active">Online</span>
} @else if (status === "idle") {
  <span class="badge idle">Away</span>
} @else {
  <span class="badge">Offline</span>
};

export function NoElse({ kind }) @{
  <div>
    @if (kind === "a") {
      <a href="/a">A</a>
    } @else if (kind === "b") {
      <button>B</button>
    }
  </div>
}
