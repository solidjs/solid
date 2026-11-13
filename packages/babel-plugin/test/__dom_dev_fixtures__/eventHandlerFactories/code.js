const branch = (
  <div>
    {show() && (
      <>
        <input onChange={makeHandler()} />
        <button onClick={makeHandler()} />
        <button onClick={handler} />
      </>
    )}
  </div>
);
