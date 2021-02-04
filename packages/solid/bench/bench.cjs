const { createRoot, createSignal, createComputed } = require("../dist/solid.cjs");

var now = typeof process === 'undefined' ? browserNow : nodeNow;

var COUNT = 1e5;

main();

function main() {
  var createTotal = 0;
  createTotal += bench(createDataSignals, COUNT, COUNT);
  createTotal += bench(createComputations0to1, COUNT, 0);
  createTotal += bench(createComputations1to1, COUNT, COUNT);
  createTotal += bench(createComputations2to1, COUNT / 2, COUNT);
  createTotal += bench(createComputations4to1, COUNT / 4, COUNT);
  createTotal += bench(createComputations1000to1, COUNT / 1000, COUNT);
  //total += bench1(createComputations8, COUNT, 8 * COUNT);
  createTotal += bench(createComputations1to2, COUNT, COUNT / 2);
  createTotal += bench(createComputations1to4, COUNT, COUNT / 4);
  createTotal += bench(createComputations1to8, COUNT, COUNT / 8);
  createTotal += bench(createComputations1to1000, COUNT, COUNT / 1000);
  console.log(`create total: ${createTotal.toFixed(0)}`);
  console.log('---');
  var updateTotal = 0;
  updateTotal += bench(updateComputations1to1, COUNT * 4, 1);
  updateTotal += bench(updateComputations2to1, COUNT * 2, 2);
  updateTotal += bench(updateComputations4to1, COUNT, 4);
  updateTotal += bench(updateComputations1000to1, COUNT / 100, 1000);
  updateTotal += bench(updateComputations1to2, COUNT * 4, 1);
  updateTotal += bench(updateComputations1to4, COUNT * 4, 1);
  updateTotal += bench(updateComputations1to1000, COUNT * 4, 1);
  console.log(`update total: ${updateTotal.toFixed(0)}`);
  console.log(`total: ${(createTotal + updateTotal).toFixed(0)}`);
}

function bench(fn, count, scount) {
  var time = run(fn, count, scount);
  console.log(`${fn.name}: ${time.toFixed(0)}`);
  return time;
}

function run(fn, n, scount) {
  // prep n * arity sources
  var start,
    end;

  createRoot(function () {
    // run 3 times to warm up
    var sources = createDataSignals(scount, []);
    fn(n / 100, sources);
    sources = createDataSignals(scount, []);
    fn(n / 100, sources);
    sources = createDataSignals(scount, []);
        % OptimizeFunctionOnNextCall(fn);
    fn(n / 100, sources);
    sources = createDataSignals(scount, []);
    for (var i = 0; i < scount; i++) {
      sources[i][0]();
      sources[i][0]();
      //%OptimizeFunctionOnNextCall(sources[i]);
      sources[i][0]();
    }

        // start GC clean
        % CollectGarbage(null);

    start = now();

    fn(n, sources);

    // end GC clean
    sources = null;
        % CollectGarbage(null);

    end = now();
  });

  return end - start;
}

function createDataSignals(n, sources) {
  for (var i = 0; i < n; i++) {
    sources[i] = createSignal(i);
  }
  return sources;
}

function createComputations0to1(n, sources) {
  for (var i = 0; i < n; i++) {
    createComputation0(i);
  }
}

function createComputations1to1000(n, sources) {
  for (var i = 0; i < n / 1000; i++) {
    const [get] = sources[i];
    for (var j = 0; j < 1000; j++) {
      createComputation1(get);
    }
    //sources[i] = null;
  }
}

function createComputations1to8(n, sources) {
  for (var i = 0; i < n / 8; i++) {
    const [get] = sources[i];
    createComputation1(get);
    createComputation1(get);
    createComputation1(get);
    createComputation1(get);
    createComputation1(get);
    createComputation1(get);
    createComputation1(get);
    createComputation1(get);
    //sources[i] = null;
  }
}

function createComputations1to4(n, sources) {
  for (var i = 0; i < n / 4; i++) {
    const [get] = sources[i];
    createComputation1(get);
    createComputation1(get);
    createComputation1(get);
    createComputation1(get);
    //sources[i] = null;
  }
}

function createComputations1to2(n, sources) {
  for (var i = 0; i < n / 2; i++) {
    const [get] = sources[i];
    createComputation1(get);
    createComputation1(get);
    //sources[i] = null;
  }
}

function createComputations1to1(n, sources) {
  for (var i = 0; i < n; i++) {
    const [get] = sources[i]
    createComputation1(get);
    //sources[i] = null;
  }
}

function createComputations2to1(n, sources) {
  for (var i = 0; i < n; i++) {
    createComputation2(
      sources[i * 2][0],
      sources[i * 2 + 1][0]
    );
    //sources[i * 2] = null;
    //sources[i * 2 + 1] = null;
  }
}

function createComputations4to1(n, sources) {
  for (var i = 0; i < n; i++) {
    createComputation4(
      sources[i * 4][0],
      sources[i * 4 + 1][0],
      sources[i * 4 + 2][0],
      sources[i * 4 + 3][0]
    );
    //sources[i * 4] = null;
    //sources[i * 4 + 1] = null;
    //sources[i * 4 + 2] = null;
    //sources[i * 4 + 3] = null;
  }
}

function createComputations8(n, sources) {
  for (var i = 0; i < n; i++) {
    createComputation8(
      sources[i * 8][0],
      sources[i * 8 + 1][0],
      sources[i * 8 + 2][0],
      sources[i * 8 + 3][0],
      sources[i * 8 + 4][0],
      sources[i * 8 + 5][0],
      sources[i * 8 + 6][0],
      sources[i * 8 + 7][0]
    );
    sources[i * 8] = null;
    sources[i * 8 + 1] = null;
    sources[i * 8 + 2] = null;
    sources[i * 8 + 3] = null;
    sources[i * 8 + 4] = null;
    sources[i * 8 + 5] = null;
    sources[i * 8 + 6] = null;
    sources[i * 8 + 7] = null;
  }
}

// only create n / 100 computations, as otherwise takes too long
function createComputations1000to1(n, sources) {
  for (var i = 0; i < n; i++) {
    createComputation1000(sources, i * 1000);
  }
}

function createComputation0(i) {
  createComputed(function () { return i; });
}

function createComputation1(s1) {
  createComputed(function () { return s1(); });
}

function createComputation2(s1, s2) {
  createComputed(function () { return s1() + s2(); });
}

function createComputation4(s1, s2, s3, s4) {
  createComputed(function () { return s1() + s2() + s3() + s4(); });
}

function createComputation8(s1, s2, s3, s4, s5, s6, s7, s8) {
  createComputed(function () { return s1() + s2() + s3() + s4() + s5() + s6() + s7() + s8(); });
}

function createComputation1000(ss, offset) {
  createComputed(function () {
    var sum = 0;
    for (var i = 0; i < 1000; i++) {
      sum += ss[offset + i][0]();
    }
    return sum;
  });
}

function updateComputations1to1(n, sources) {
  var [get1, set1] = sources[0];
  createComputed(function () { return get1(); });
  for (var i = 0; i < n; i++) {
    set1(i);
  }
}

function updateComputations2to1(n, sources) {
  var [get1, set1] = sources[0],
    [get2] = sources[1];
  createComputed(function () { return get1() + get2(); });
  for (var i = 0; i < n; i++) {
    set1(i);
  }
}

function updateComputations4to1(n, sources) {
  var [get1, set1] = sources[0],
    [get2] = sources[1];
    [get3] = sources[2],
    [get4] = sources[3];
  createComputed(function () { return get1() + get2() + get3() + get4(); });
  for (var i = 0; i < n; i++) {
    set1(i);
  }
}

function updateComputations1000to1(n, sources) {
  var [get1, set1] = sources[0];
  createComputed(function () {
    var sum = 0;
    for (var i = 0; i < 1000; i++) {
      sum += sources[i][0]();
    }
    return sum;
  });
  for (var i = 0; i < n; i++) {
    set1(i);
  }
}

function updateComputations1to2(n, sources) {
  var [get1, set1] = sources[0];
  createComputed(function () { return get1(); });
  createComputed(function () { return get1(); });
  for (var i = 0; i < n / 2; i++) {
    set1(i);
  }
}

function updateComputations1to4(n, sources) {
  var [get1, set1] = sources[0];
  createComputed(function () { return get1(); });
  createComputed(function () { return get1(); });
  createComputed(function () { return get1(); });
  createComputed(function () { return get1(); });
  for (var i = 0; i < n / 4; i++) {
    set1(i);
  }
}

function updateComputations1to1000(n, sources) {
  var [get1, set1] = sources[0];
  for (var i = 0; i < 1000; i++) {
    createComputed(function () { return get1(); });
  }
  for (var i = 0; i < n / 1000; i++) {
    set1(i);
  }
}

function browserNow() {
  return performance.now();
}

function nodeNow() {
  var hrt = process.hrtime();
  return hrt[0] * 1000 + hrt[1] / 1e6;
}