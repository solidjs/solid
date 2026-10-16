// `sourceNames.locations`: every label carries where its JSX is written,
// `file:line:col` relative to `root` (here the fixtures directory, resolved
// against the working directory), line and column 1-based.
import { Layout, Card, Row } from "./components";

// Nested components → each `createComponent` points at its own `<Tag`.
const nested = (
  <Layout>
    <Card title="Hello">
      <Row />
    </Card>
  </Layout>
);

// An attribute binding → the attribute's start; a merged effect points at
// the first binding it lists.
const attribute = <div class={cls()} title={title()} />;
const styleObject = <div style={{ color: color() }} />;

// A hole → the `{` of the expression.
const hole = <p>Count: {count()}</p>;

// A spread → the `{...` of the first spread attribute.
const spread = <section {...props} />;

// A component inside a conditional → the conditional's memo keeps the label.
const conditional = <div>{visible() ? <Card title="On" /> : null}</div>;
