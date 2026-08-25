export let LetComp = () => <div>let</div>;
var VarComp = props => <span>{props.x}</span>;
const First = () => 1,
  second = 2,
  Third = function Named() {
    return 3;
  };
export default function () {
  return <div>anon</div>;
}
export { VarComp };
