export const StatusMessage = ({ status }) => @switch (status) {
  @case "loading": {
    <p>Loading...</p>
  }
  @case "success": {
    <p class="success">Done!</p>
  }
  @default: {
    <p>Unknown status.</p>
  }
};
