/**
 * 九人议会 · UI 渲染逻辑（Doubao）
 *
 * 引擎接入：2026-10-27 已切到真实引擎 engine.js（原 mock 切换点已闭合）。
 *   改动背景：豆包侧 10-23 后停摆，10-30 检查点前必须真引擎上线，
 *   由 step-5（引擎方）按同一事件契约完成接线；mock-engine.js 保留作参考对照。
 *   事件契约：engine.js 9 类事件全量处理（含 proposal_received）。
 *   ⚠️ 豆包回来后请 review 本条改动（接线 + I1 三十秒判据接口 + 版本戳），
 *      有不同实现意图可直接再改 —— 改动日志见 git log，欢迎推翻重做。
 */
import { runCouncil, STANCES, DEMO_PROPOSAL, EVENTS } from './engine.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const $ = (id) => document.getElementById(id);

// 节点方位（与 index.html 环形图坐标一致）
const NODE_POS = {
  risk: { x: 300, y: 95 },
  cost: { x: 455, y: 250 },
  creative: { x: 300, y: 405 },
  user: { x: 145, y: 250 },
};
const NODE_R = 40;
const POS_LABEL = { support: '支持', oppose: '反对', conditional: '有条件' };
const DECISION_LABEL = { adopt: '采纳', reject: '驳回', conditional: '有条件采纳' };

/** 当前运行句柄（{ runId, cancel }）；并发时以它为 UI 锚点。 */
let current = null;
let conflictsTotal = 0;
let opinionsSeen = 0;
/** 同一路径（含方向）已画弧线数，用于让多条反驳弧线错开不重叠。 */
let arcCounts = {};

// ─────────────────────────────────────────────
// 小工具
// ─────────────────────────────────────────────

/** 沿 a→b 方向，取 a 节点边缘点。 */
function edgePoint(a, b, r = NODE_R) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: a.x + (dx / len) * r, y: a.y + (dy / len) * r };
}

/** 逐字打字，返回 Promise；可被 reset 打断（元素被替换即自然停止）。 */
function typeInto(el, text, speed = 12) {
  el.textContent = '';
  let i = 0;
  return new Promise((resolve) => {
    (function tick() {
      if (!el.isConnected) return resolve();
      if (i < text.length) {
        el.textContent += text[i++];
        setTimeout(tick, speed);
      } else resolve();
    })();
  });
}

function setStage(text) {
  $('hud-stage').textContent = text;
}

function setConv(resolved, total) {
  const el = $('hud-conv');
  el.textContent = `${resolved}/${total}`;
  el.classList.toggle('ok', total > 0 && resolved === total);
}

// ─────────────────────────────────────────────
// 重置（run_started 前清场）
// ─────────────────────────────────────────────

const OPINION_INITIAL = (name, id) => `
  <div class="head"><span class="name">${name}</span><span class="badge" id="badge-${id}">待激活</span></div>
  <p class="placeholder-line" id="ph-${id}">等待发表意见…</p>`;

function resetUI() {
  conflictsTotal = 0;
  opinionsSeen = 0;
  arcCounts = {};
  setStage('准备中…');
  setConv(0, 0);
  $('hud-run').textContent = '—';
  $('center-stage').textContent = '审议启动';
  $('center-stage').classList.add('busy');
  $('center-sub').textContent = '';

  // 清弧线
  $('arcs').innerHTML = '';

  // 节点与意见卡复位（SVG 元素 className 只读，必须用 setAttribute）
  for (const s of STANCES) {
    const g = $(`node-${s.id}`);
    g.querySelector('.node-circle').setAttribute('class', 'node-circle idle');
    g.querySelector('.node-label').setAttribute('class', 'node-label');
    const pos = g.querySelector('.node-pos');
    pos.setAttribute('class', 'node-pos');
    pos.textContent = '待激活';
    // 清掉可能存在的「已软化」提示文字
    g.querySelectorAll('.node-soft').forEach((n) => n.remove());
    $(`op-${s.id}`).innerHTML = OPINION_INITIAL(s.name, s.id);
  }

  // 隐藏结果卡
  $('verdict-card').classList.add('hidden');
  $('verdict-pending').classList.add('hidden');
  $('degraded-card').classList.add('hidden');
}

// ─────────────────────────────────────────────
// 渲染位：节点 + 意见卡（stance_opinion）
// ─────────────────────────────────────────────

function activateNode(stanceId, opinion) {
  const g = $(`node-${stanceId}`);
  const circle = g.querySelector('.node-circle');
  circle.classList.remove('idle');
  circle.classList.add(`pos-${opinion.position}`);
  g.querySelector('.node-label').classList.add('active');
  const pos = g.querySelector('.node-pos');
  pos.setAttribute('class', `node-pos ${opinion.position}`);
  pos.textContent = POS_LABEL[opinion.position];
}

async function fillOpinionCard(stanceId, opinion) {
  const card = $(`op-${stanceId}`);
  const badge = $(`badge-${stanceId}`);
  badge.className = `badge ${opinion.position}`;
  badge.textContent = POS_LABEL[opinion.position];

  const box = document.createElement('div');
  box.innerHTML = `
    <div class="judgment"></div>
    <div class="q-title">追问：</div>
    <ul>${opinion.questions.map(() => '<li></li>').join('')}</ul>`;
  $(`ph-${stanceId}`).replaceWith(box);

  const j = box.querySelector('.judgment');
  await typeInto(j, opinion.initialJudgment, 12);
  const lis = [...box.querySelectorAll('li')];
  for (let i = 0; i < opinion.questions.length; i++) {
    await typeInto(lis[i], opinion.questions[i], 9);
  }
}

// ─────────────────────────────────────────────
// 渲染位：冲突预备线 + 反驳弧线
// ─────────────────────────────────────────────

function ensureArrow() {
  const svg = $('ring');
  if (svg.querySelector('#arrow')) return;
  const defs = document.createElementNS(SVGNS, 'defs');
  defs.innerHTML = `
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5"
      markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="#58a6ff"></path>
    </marker>`;
  svg.insertBefore(defs, svg.firstChild);
}

function drawConflictPrep(conflict) {
  const [a, b] = conflict.pair;
  const pa = NODE_POS[a];
  const pb = NODE_POS[b];
  const p1 = edgePoint(pa, pb);
  const p2 = edgePoint(pb, pa);
  const line = document.createElementNS(SVGNS, 'line');
  line.setAttribute('x1', p1.x);
  line.setAttribute('y1', p1.y);
  line.setAttribute('x2', p2.x);
  line.setAttribute('y2', p2.y);
  line.setAttribute('class', 'conflict-prep');
  $('arcs').appendChild(line);
}

function drawRebuttal(rebuttal) {
  const { from, to, round } = rebuttal;
  const pf = NODE_POS[from];
  const pt = NODE_POS[to];
  const p1 = edgePoint(pf, pt);
  const p2 = edgePoint(pt, pf);

  // 弧线控制点（中点垂直偏移）；同一路径多条弧线错开
  const mx = (p1.x + p2.x) / 2;
  const my = (p1.y + p2.y) / 2;
  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const len = Math.hypot(dx, dy) || 1;
  const key = `${from}>${to}`;
  const nth = (arcCounts[key] = (arcCounts[key] || 0) + 1);
  const off = 22 + (nth - 1) * 18;
  const cx = mx - (dy / len) * off;
  const cy = my + (dx / len) * off;

  ensureArrow();
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`);
  path.setAttribute('class', 'rebuttal-arc');
  path.setAttribute('marker-end', 'url(#arrow)');
  $('arcs').appendChild(path);

  // round 徽标（弧线顶点附近）
  const tag = document.createElementNS(SVGNS, 'text');
  tag.setAttribute('x', cx);
  tag.setAttribute('y', cy - 4);
  tag.setAttribute('class', 'arc-round');
  tag.textContent = `R${round}`;
  $('arcs').appendChild(tag);

  // cost≥3 软化
  if (rebuttal.cost >= 3) markSoftened(to);
}

function markSoftened(stanceId) {
  const g = $(`node-${stanceId}`);
  g.querySelector('.node-circle').classList.add('softened');
  const label = document.createElementNS(SVGNS, 'text');
  label.setAttribute('class', 'node-soft');
  const p = NODE_POS[stanceId];
  label.setAttribute('x', p.x);
  label.setAttribute('y', p.y + NODE_R + 14);
  label.textContent = '已软化（权重 0.5）';
  g.appendChild(label);
}

// ─────────────────────────────────────────────
// 渲染位：裁决报告卡
// ─────────────────────────────────────────────

function li(arr) {
  return arr.map((x) => `<li>${x}</li>`).join('');
}

function showVerdict(verdict) {
  $('verdict-pending').classList.add('hidden');
  const card = $('verdict-card');
  const rate = Math.round((verdict.conflictsResolved / (verdict.conflictsTotal || 1)) * 100);
  card.innerHTML = `
    <div class="head">
      <span class="vname">最终裁决</span>
      <span class="decision-badge ${verdict.decision}">${DECISION_LABEL[verdict.decision]}</span>
      <span class="rate">收敛率 <b>${verdict.conflictsResolved}/${verdict.conflictsTotal}</b>（${rate}%）</span>
    </div>
    <div class="verdict-block"><h3>裁决理由</h3><ul>${li(verdict.reasons)}</ul></div>
    <div class="verdict-block"><h3>残余风险（未完全收敛）</h3><ul>${li(verdict.residualRisks)}</ul></div>
    <div class="verdict-block"><h3>推翻条件（满足则重新审议）</h3><ul>${li(verdict.overturnConditions)}</ul></div>`;
  card.classList.remove('hidden');
  setStage('审议完成');
  setConv(verdict.conflictsResolved, verdict.conflictsTotal);
  $('center-stage').textContent = '裁决已出';
  $('center-stage').classList.remove('busy');
}

function showPending() {
  $('verdict-pending').classList.remove('hidden');
  setStage('正在生成裁决');
  $('center-stage').textContent = '汇总中…';
}

// ─────────────────────────────────────────────
// 渲染位：降级卡
// ─────────────────────────────────────────────

function showDegraded(reason, echo) {
  const card = $('degraded-card');
  const echoText = [echo?.title, echo?.body].filter(Boolean).join(' / ') || '（空）';
  card.innerHTML = `
    <div class="dname">无法审议 · 我没把握</div>
    <div class="reason">${reason}</div>
    <div class="echo"><b>你刚才的输入：</b>${echoText}</div>`;
  card.classList.remove('hidden');
  setStage('无法审议');
  $('center-stage').textContent = '需要补充';
  $('center-stage').classList.remove('busy');
}

// ─────────────────────────────────────────────
// 事件分发
// ─────────────────────────────────────────────

function handleEvent(e) {
  switch (e.type) {
    case EVENTS.RUN_STARTED:
      $('hud-run').textContent = e.runId.slice(0, 18) + '…';
      setStage('正在分类意图');
      break;
    case EVENTS.PROPOSAL_RECEIVED:
      $('center-sub').textContent = `已收到：${(e.title || '无标题提案').slice(0, 20)}`;
      break;
    case EVENTS.PROPOSAL_TYPED:
      setStage('四视角审议中');
      $('center-stage').textContent = '视角发言中';
      break;
    case EVENTS.STANCE_OPINION:
      opinionsSeen += 1;
      activateNode(e.stanceId, e.opinion);
      fillOpinionCard(e.stanceId, e.opinion);
      setStage(`视角发言 ${opinionsSeen}/4`);
      break;
    case EVENTS.CONFLICT_DETECTED:
      conflictsTotal += 1;
      drawConflictPrep(e.conflict);
      setConv(0, conflictsTotal);
      setStage('冲突检测');
      break;
    case EVENTS.REBUTTAL:
      drawRebuttal(e.rebuttal);
      setStage(`反驳链 · 第 ${e.rebuttal.round} 轮`);
      break;
    case EVENTS.VERDICT_READY:
      showPending();
      break;
    case EVENTS.VERDICT:
      showVerdict(e.verdict);
      break;
    case EVENTS.DEGRADED:
      showDegraded(e.reason, e.echo);
      break;
    default:
      break;
  }
}

// ─────────────────────────────────────────────
// 启动与按钮
// ─────────────────────────────────────────────

function start(proposal) {
  if (current?.cancel) current.cancel();
  resetUI();
  const r = runCouncil(proposal, (e) => {
    // 并发保护：旧 run 的事件一律忽略（配合 cancel 清定时器，双保险）
    if (current !== r) return;
    handleEvent(e);
  });
  current = r;
}

function readInput() {
  return {
    title: $('in-title').value.trim(),
    body: $('in-body').value.trim(),
  };
}

$('btn-run').addEventListener('click', () => {
  const p = readInput();
  if (!p.body && !p.title) {
    setStage('请先输入提案');
    return;
  }
  start(p);
});

$('btn-demo').addEventListener('click', () => {
  $('in-title').value = DEMO_PROPOSAL.title;
  $('in-body').value = DEMO_PROPOSAL.body;
  start(DEMO_PROPOSAL);
});

// ─────────────────────────────────────────────
// 外部接口（I1 三十秒判据用）
// ─────────────────────────────────────────────

/** 供验收/测试外部驱动： CouncilUI.push(event) 注入单事件，或 CouncilUI.start(proposal) 跑全程。 */
window.CouncilUI = { push: handleEvent, start, EVENTS };

// ?autoplay=1：打开即自动跑引导提案（秒表从页面加载完成起算，无需点击）
if (new URLSearchParams(location.search).get('autoplay') === '1') {
  $('in-title').value = DEMO_PROPOSAL.title;
  $('in-body').value = DEMO_PROPOSAL.body;
  start(DEMO_PROPOSAL);
}
