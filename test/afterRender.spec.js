const { createRoot, createSignal,  selectWhen, selectEach } = require('../lib/solid');

function createList(parent, length) {
  let i = 0;
  while(i < length) {
    const el = document.createElement('div');
    el.model = ++i;
    parent.appendChild(el);
  }
}

describe('selectWhen', () => {
  const div = document.createElement('div'),
    [selected, setSelected] = createSignal(0);
  createList(div, 5);

  test('various selection', () => {
    createRoot(() => {
      const handler = selectWhen(selected, 'selected');
      handler(div.firstChild, null);
      expect(div.childNodes[1].className).toBe('');
      setSelected(2);
      expect(div.childNodes[1].className).toBe('selected');
      expect(div.childNodes[2].className).toBe('');
      setSelected(3);
      expect(div.childNodes[1].className).toBe('');
      expect(div.childNodes[2].className).toBe('selected');
    })
  });
});

describe('selectEach', () => {
  const div = document.createElement('div'),
    [selected, setSelected] = createSignal([]);
  createList(div, 5);

  test('various selection', () => {
    createRoot(() => {
      const handler = selectEach(selected, 'selected');
      handler(div.firstChild, null);
      expect(div.childNodes[1].className).toBe('');
      setSelected([2]);
      expect(div.childNodes[1].className).toBe('selected');
      expect(div.childNodes[2].className).toBe('');
      setSelected([3]);
      expect(div.childNodes[1].className).toBe('');
      expect(div.childNodes[2].className).toBe('selected');
      setSelected([1, 3]);
      expect(div.childNodes[0].className).toBe('selected');
      expect(div.childNodes[1].className).toBe('');
      expect(div.childNodes[2].className).toBe('selected');
    })
  });
});