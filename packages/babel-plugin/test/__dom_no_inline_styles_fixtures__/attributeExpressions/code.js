const template1 = <div style="color: red" />;

const template2 = <div style={someStyle()} />;

const template3 = <div style={{ color: "red" }} />;

const template4 = <div style={{ "background-color": color(), "margin-right": "40px" }} />;

const template5 = <div style={{ background: "red", color: "green", margin: 3, padding: 0.4 }} />;

const template6 = <div style={{ background: "red", color: "green", border: signal() }} />;

const template7 = <div style={{ background: "red", color: "green", border: undefined }} />;

const template8 = <div style={{}} />;
