const S = require('s-js');
const { from, pipe, map } = require('../lib/solid');
const Observable = require('zen-observable');

describe('from operator', () => {

  test('Signal passthrough', () => {
    S.root(() => {
      var data = S.data(5),
          out = from(data);

      expect(out).toBe(data);
    });
  });

  test('Signal from an async Signal', (done) => {
    s = S.data('init')
    setTimeout(s, 20, 'started');
    S.root(() => {
      var out = from(s);
      expect(out()).toBe('init');
      S.on(out, () => {
        expect(out()).toBe('started');
        done();
      }, null, true);
    });
  });

  test('Signal from a promise', (done) => {
    S.root(() => {
      var p = new Promise(resolve => { setTimeout(resolve, 20, 'promised'); }),
          out = from(p, 'init');

      expect(out()).toBe('init');
      S.on(out, () => {
        expect(out()).toBe('promised');
        done();
      }, null, true);
    });
  });

  test('Signal from an observable', (done) => {
    S.root(() => {
      var o = new Observable(observer => {
        let timer = setTimeout(() => {
          observer.next('hello');
          observer.complete();
        }, 20);
        return () => clearTimeout(timer);
      }), out = from(o, 'init');

      expect(out()).toBe('init');
      S.on(out, () => {
        expect(out()).toBe('hello');
        done();
      }, null, true);
    });
  });

});

describe('pipe operator', () => {

  test('Signal passthrough', () => {
    S.root(() => {
      var data = S.data(5),
          out = pipe(data);

      expect(out).toBe(data);
    });
  });

  test('pipe map', () => {
    S.root(() => {
      var data = S.data(5),
          out = pipe(data, map(i => i * 2));

      expect(out()).toBe(data() * 2);
    });
  });
});
