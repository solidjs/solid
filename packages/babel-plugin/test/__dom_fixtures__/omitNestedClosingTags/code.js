const form = (
  <div>
    <form>
      <label>
        Name <input />
      </label>
    </form>
    <p>{value()}</p>
  </div>
);

const twoForms = (
  <div>
    <section>
      <form>
        <input />
      </form>
    </section>
    <form>
      <button>{value()}</button>
    </form>
  </div>
);

const customElement = (
  <div>
    <my-card>
      <div>body</div>
    </my-card>
    <p>{value()}</p>
  </div>
);

const legend = (
  <fieldset>
    <legend>
      <h2>Title</h2>
    </legend>
    <p>{value()}</p>
  </fieldset>
);

const nestedList = (
  <ul>
    <li>
      Docs
      <ul>
        <li>Intro</li>
      </ul>
    </li>
    <li>{value()}</li>
  </ul>
);

const foreignObject = (
  <div>
    <div>
      <svg>
        <foreignObject>
          <div>x</div>
        </foreignObject>
      </svg>
    </div>
    <p>{value()}</p>
  </div>
);

const mathText = (
  <div>
    <p>
      <math>
        <mtext>
          <span>x</span>
        </mtext>
      </math>
    </p>
    <p>{value()}</p>
  </div>
);
