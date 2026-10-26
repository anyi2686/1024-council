/**
 * 议会引擎自验（ACCEPTANCE_1024.md E1–E6 · 2026-10-26 step-5）
 *
 * 跑法：node council/engine.test.mjs
 * 通过标准：E1–E6 全 ✅ 才允许进联调；任一 ❌ 按 MVS 规则记 🔴。
 */

import { runCouncil, EVENTS, DEMO_PROPOSAL } from './engine.js';

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail) {
  if (ok) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    failures.push(name);
    console.log(`  ❌ ${name}${detail ? ` —— ${detail}` : ''}`);
  }
}

/** 剥掉 runId 后深比较（E6 确定性：runId 含时钟，不参与确定性判定）。 */
function stripRunId(events) {
  return JSON.stringify(events.map(({ runId, ...rest }) => rest));
}

const typeSeq = (events) => events.map((e) => e.type).join(' → ');

console.log('\n=== E1 任意提案不崩（5 条输入）===');
{
  const inputs = [
    ['20 字碎句', { title: '加个按钮', body: '首页加个按钮' }],
    ['300 字长文', { title: '中台化改造', body: '数据'.repeat(150) + '接口架构性能重构'.repeat(10) }],
    ['纯英文', { title: 'Add a button', body: 'Add a button to the homepage for quick access.' }],
    ['与软件无关', { title: '食堂菜单', body: '下周午餐换新供应商，菜品质量和价格需要重新评估，大家有推荐吗。' }],
    ['正常提案', { title: '订单页性能优化', body: '订单列表接口慢，需要做分页和缓存优化，提升加载速度和用户体验。' }],
  ];
  for (const [label, input] of inputs) {
    let threw = null;
    let result = null;
    try {
      result = runCouncil(input);
    } catch (err) {
      threw = err;
    }
    const terminal = result && (result.events.some((e) => e.type === EVENTS.VERDICT) || result.degraded);
    check(`${label}：不抛异常且有终态`, !threw && !!result && result.events.length > 0 && terminal, threw ? String(threw) : `events=${result?.events.length}`);
  }
}

console.log('\n=== E2 事件流完整（规格 8 事件集合与顺序）===');
{
  const r = runCouncil({ title: '订单页性能优化', body: '订单列表接口慢，需要做分页和缓存优化，提升加载速度和用户体验。' });
  const seq = typeSeq(r.events);
  check('run_started 首位', r.events[0].type === EVENTS.RUN_STARTED);
  check('proposal_received 第二位', r.events[1].type === EVENTS.PROPOSAL_RECEIVED, seq);
  check('proposal_typed 第三位', r.events[2].type === EVENTS.PROPOSAL_TYPED);
  const opinionCount = r.events.filter((e) => e.type === EVENTS.STANCE_OPINION).length;
  check('stance_opinion×4', opinionCount === 4, `实际 ${opinionCount}`);
  const firstOpinion = r.events.find((e) => e.type === EVENTS.STANCE_OPINION);
  const firstConflict = r.events.find((e) => e.type === EVENTS.CONFLICT_DETECTED);
  check('conflict 在 opinion 之后', firstConflict && firstOpinion && r.events.indexOf(firstConflict) > r.events.indexOf(firstOpinion));
  const firstRebuttal = r.events.find((e) => e.type === EVENTS.REBUTTAL);
  check('rebuttal 在 conflict 之后', firstRebuttal && firstConflict && r.events.indexOf(firstRebuttal) > r.events.indexOf(firstConflict));
  const last2 = r.events.slice(-2).map((e) => e.type);
  check('verdict_ready → verdict 收尾', last2[0] === EVENTS.VERDICT_READY && last2[1] === EVENTS.VERDICT, last2.join(' → '));
}

console.log('\n=== E3 冲突是真的（无同向硬凑）===');
{
  const r = runCouncil({ title: '订单页性能优化', body: '订单列表接口慢，需要做分页和缓存优化，提升加载速度和用户体验。' });
  const conflicts = r.events.filter((e) => e.type === EVENTS.CONFLICT_DETECTED).map((e) => e.conflict);
  const opinions = {};
  for (const e of r.events) if (e.type === EVENTS.STANCE_OPINION) opinions[e.stanceId] = e.opinion;
  const allReal = conflicts.every((c) => {
    if (c.type === 'polarity') {
      const [s, o] = c.pair;
      return (
        (opinions[s].position === 'support' && opinions[o].position === 'oppose') ||
        (opinions[s].position === 'oppose' && opinions[o].position === 'support')
      );
    }
    // priority 型：desc 必须自证是结构性差异（含"结构性"字样）
    return c.desc.includes('结构性');
  });
  check(`全部冲突有真实依据（${conflicts.length} 个）`, conflicts.length > 0 && allReal);
  const descNonEmpty = conflicts.every((c) => c.desc && c.desc.length > 20);
  check('冲突描述非空泛', descNonEmpty);
}

console.log('\n=== E4 退化态可用（显式认怂）===');
{
  const r = runCouncil({ title: '啊啊啊', body: '？？？' });
  const deg = r.events.find((e) => e.type === EVENTS.DEGRADED);
  check('发 degraded 事件', !!deg);
  check('带 reason 与 echo', !!deg?.reason && !!deg?.echo);
  check('不静默不空白', r.events.length >= 3);
}

console.log('\n=== E5 并发不串流 ===');
{
  const a = { title: '订单页性能优化', body: '订单列表接口慢，需要做分页和缓存优化，提升加载速度和用户体验。' };
  const b = { title: '社区内容改版', body: '社区首页内容改版，新增专栏和专题，提升内容消费体验和停留时长。' };
  const ra = runCouncil(a);
  const rb = runCouncil(b);
  // 同步层：两次调用的事件数组相互独立，内容各随其输入
  check('两次运行 runId 不同', ra.runId !== rb.runId);
  check('事件数组相互独立', ra.events !== rb.events && ra.events.length > 0 && rb.events.length > 0);
  const bodyA = ra.events.find((e) => e.type === EVENTS.PROPOSAL_RECEIVED)?.body;
  const bodyB = rb.events.find((e) => e.type === EVENTS.PROPOSAL_RECEIVED)?.body;
  check('同步内容各随其输入', bodyA === a.body && bodyB === b.body && bodyA !== bodyB);

  // 异步层：并发播放互不串流（等前两个事件落地即可验证来源）
  const gotA = [];
  const gotB = [];
  const rA = runCouncil(a, (e) => gotA.push(e));
  const rB = runCouncil(b, (e) => gotB.push(e));
  await new Promise((res) => setTimeout(res, 1600));
  check('并发播放后 A 收到自己的事件', gotA.length >= 2 && gotA.some((e) => e.body === a.body));
  check('并发播放后 B 收到自己的事件', gotB.length >= 2 && gotB.some((e) => e.body === b.body));
  check('A 未收到 B 的输入内容', !gotA.some((e) => e.body === b.body));
  check('B 未收到 A 的输入内容', !gotB.some((e) => e.body === a.body));

  // cancel 隔离：取消 A 不影响 B 跑完
  rA.cancel();
  const aLen = gotA.length;
  await new Promise((res) => setTimeout(res, 13000));
  check('cancel 后 A 停止接收', gotA.length === aLen);
  check('cancel 后 B 跑完出裁决', gotB.some((e) => e.type === EVENTS.VERDICT));
  rB.cancel();
}

console.log('\n=== E6 确定性（同输入两次，结论一致）===');
{
  const input = { title: '订单页性能优化', body: '订单列表接口慢，需要做分页和缓存优化，提升加载速度和用户体验。' };
  const r1 = runCouncil(input);
  const r2 = runCouncil(input);
  check('事件序列深相等（除 runId）', stripRunId(r1.events) === stripRunId(r2.events));
  const v1 = r1.events.find((e) => e.type === EVENTS.VERDICT)?.verdict;
  const v2 = r2.events.find((e) => e.type === EVENTS.VERDICT)?.verdict;
  check('裁决结论一致', v1?.decision === v2?.decision && JSON.stringify(v1) === JSON.stringify(v2));
}

console.log('\n=== 附加：引导提案与 30 秒时序（I1 支撑）===');
{
  const r = runCouncil(DEMO_PROPOSAL);
  const v = r.events.find((e) => e.type === EVENTS.VERDICT)?.verdict;
  const softenedStance = r.events.filter((e) => e.type === EVENTS.REBUTTAL && e.rebuttal.cost >= 3).map((e) => e.rebuttal.to);
  check('demo 提案跑出裁决', !!v && ['adopt', 'reject', 'conditional'].includes(v.decision), `decision=${v?.decision}`);
  check('demo 提案出现软化（立场被驳并改写）', softenedStance.length > 0, softenedStance.join(','));
  // 时序总和（规格 §2 参数）
  const delays = { run_started: 0, proposal_received: 120, proposal_typed: 120, stance_opinion: 1000, conflict_detected: 500, rebuttal: 1200, verdict_ready: 900, verdict: 600 };
  let total = 0;
  r.events.forEach((e, i) => {
    total += e.type === EVENTS.STANCE_OPINION && i > 0 && r.events[i - 1].type === EVENTS.STANCE_OPINION ? 1000 : delays[e.type] ?? 400;
  });
  check(`播放总时长 ${(total / 1000).toFixed(1)}s ≤ 30s（I1）`, total <= 30000);
}

console.log(`\n=== 结果：${pass} 过 / ${fail} 挂 ===`);
if (fail > 0) {
  console.log('失败项：' + failures.join(' | '));
  process.exit(1);
}
