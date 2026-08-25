export function Badge({ show }) @{
  <>
    @if (show) {
      <span>Visible</span>
    }
  </>
}

export const Toggle = ({ on }) => @if (on) {
  <span>On</span>
} @else {
  <span>Off</span>
};

export function WithSetup({ user }) @{
  <div>
    @if (user) {
      const label = user.name.trim();
      <strong>{label}</strong>
    } @else {
      <em>anonymous</em>
    }
  </div>
}
