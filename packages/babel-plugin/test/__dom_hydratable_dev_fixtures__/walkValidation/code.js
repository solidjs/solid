const name = () => "dynamic";

const singleChild = (
  <div>
    <span>{name()}</span>
  </div>
);

const siblingElements = (
  <div>
    <header>Title</header>
    <main>{name()}</main>
    <footer>End</footer>
  </div>
);

const mixedTextAndElements = (
  <span>
    Hello <b>{name()}</b> world
  </span>
);

const nestedWalk = (
  <div>
    <ul>
      <li>{name()}</li>
    </ul>
    <p>Static</p>
  </div>
);
