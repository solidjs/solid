export const Toggle = ({ on }) => @if (on) {
  <span>On</span>
} @else {
  <span>Off</span>
};

export const StatusBadge = ({ status }) => @if (status === "active") {
  <span class="badge active">Online</span>
} @else if (status === "idle") {
  <span class="badge idle">Away</span>
} @else {
  <span class="badge">Offline</span>
};
