describe('Basic element attributes', () => {
  test('spread', () => {
    const props = {id: 'main', name:'main'},
      d = <div {...props}/>;
      expect(d.id).toBe('main');
      expect(d.name).toBe('main');
  });

  test('classList', () => {
    const classes = {first: true, second: false, 'third fourth': true},
      d = <div classList={classes}/>;
      expect(d.className).toBe('first third fourth');
  });
});