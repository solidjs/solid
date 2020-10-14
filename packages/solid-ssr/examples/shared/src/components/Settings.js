import { styled } from "solid-styled-components";

const Div = styled("div")`
 color: orange;
 font-weight: 800;
`

const Settings = () => (
  <>
    <h1>Settings</h1>
    <p>All that configuration you never really ever want to look at.</p>
    <Div>Important</Div>
  </>
);

export default Settings;