// data.js · 场景与 commit 数据（确定性，不随机）
var SCENARIOS = {
  "64":  { n: 64,  culprit: 41, flaky: false, label: "64 · 教学",
           desc: "6 次是下界：64 = 2^6。乱点也能找到，但会多花步数。" },
  "128": { n: 128, culprit: 97, flaky: false, label: "128 · 压力",
           desc: "128 = 2^7：下界 7 次。格子变密，手快不如手稳。" },
  "flaky": { n: 64, culprit: 23, flaky: true, flakyAt: 20, label: "flaky · 需 skip",
           desc: "第 20 个 commit 偶发不稳定（就在标准二分的路径上）：测它会得到不可判定的结果。正确做法是 skip、不计入区间，换个点继续。" }
};

var MSGS = [
  "feat: 登录页骨架", "fix: 空指针", "chore: 升依赖", "feat: 会话中间件",
  "refactor: 鉴权抽取", "test: 补单测", "fix: 时区偏移", "feat: 审计日志",
  "style: 格式化", "perf: 缓存预热", "feat: 权限位", "fix: 并发写锁",
  "chore: 清理死代码", "feat: 限流", "fix: 重试退避", "docs: 注释"
];

var AUTHORS = ["lin", "zhou", "chen", "wu", "li", "sun"];

function shasum(i) {
  var h = 2166136261;
  var s = "commit-" + i;
  for (var k = 0; k < s.length; k++) { h ^= s.charCodeAt(k); h = (h * 16777619) >>> 0; }
  var hex = h.toString(16);
  while (hex.length < 8) hex = "0" + hex;
  return hex;
}

function makeCommits(n) {
  var out = [];
  for (var i = 1; i <= n; i++) {
    out.push({
      i: i,
      sha: shasum(i),
      msg: MSGS[(i - 1) % MSGS.length],
      author: AUTHORS[(i * 7) % AUTHORS.length],
      day: 1 + Math.floor((i - 1) / 6)
    });
  }
  return out;
}

function optimalSteps(n) { return Math.ceil(Math.log(n) / Math.log(2)); }