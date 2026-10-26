const fs = require("fs");
const vm = require("vm");
const ctx = { console, Math };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync("data.js", "utf8"), ctx);
const { makeCommits, optimalSteps, SCENARIOS } = ctx;
Object.keys(SCENARIOS).forEach(function (key) {
  const sc = SCENARIOS[key];
  const cs = makeCommits(sc.n);
  let lo = 1, hi = sc.n, steps = 0;
  while (lo < hi && steps < 50) {
    steps++;
    const mid = Math.floor((lo + hi) / 2);
    if (mid >= sc.culprit) hi = mid; else lo = mid + 1;
  }
  console.log(key, "n=" + sc.n, "commits=" + cs.length, "found=" + lo, "steps=" + steps, "optimal=" + optimalSteps(sc.n));
});