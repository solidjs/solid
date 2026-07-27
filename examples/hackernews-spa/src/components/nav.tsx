function Nav() {
  return (
    <header class="header">
      <nav class="inner">
        <a href="/">
          <strong>HN</strong>
        </a>
        <a href="/new">
          <strong>New</strong>
        </a>
        <a href="/show">
          <strong>Show</strong>
        </a>
        <a href="/ask">
          <strong>Ask</strong>
        </a>
        <a href="/job">
          <strong>Jobs</strong>
        </a>
        <a class="github" href="http://github.com/solidjs/solid" target="_blank" rel="noreferrer">
          Built with Solid
        </a>
      </nav>
    </header>
  );
}

export default Nav;
