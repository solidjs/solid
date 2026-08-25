import { Show } from "somewhere";

const Child = props => {
  const [s, set] = createSignal();
  return (
    <>
      <div ref={props.ref} element={<div backgroundColor={s() ? "red" : "green"} />}>
        Hello {props.name}
      </div>
      <div>
        <div ref={set}>{props.children}</div>
        <Canvas>
          <mesh
            scale={2}
            position={[0, 0, 0]}
            geometry={<boxBufferGeometry args={[0, 1, 2]} />}
            material={<basicMaterial alpha={0} color={s() ? "red" : "green"} />}
          />
          <pointLight />
          <HTML>
            <div ref={props.ref} element={<div backgroundColor={s() ? "red" : "green"} />}>
              Hello {props.name}
            </div>
            <button></button>
          </HTML>
        </Canvas>
      </div>
    </>
  );
};

const Component = props => {
  return (
    <div>
      {props.three ? (
        <mesh
          scale={2}
          position={[0, 0, 0]}
          geometry={<boxBufferGeometry args={[0, 1, 2]} />}
          material={<basicMaterial alpha={0} color={s() ? "red" : "green"} />}
        >
          <pointLight />
        </mesh>
      ) : (
        <div>
          <button></button>
        </div>
      )}
    </div>
  );
};

const Mesh = props => {
  return (
    <group {...props}>
      <>
        <group>{a ? <mesh /> : <instancedMesh />}</group>
        <HTML>
          <div {...props}>{b ? <div /> : <button></button>}</div>
        </HTML>
      </>
    </group>
  );
};
