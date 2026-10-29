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

/**
 * 预置提案（评委视角：没想好输入什么，点一个直接看完整审议）。
 * 四类意图各一个（功能/商业/技术/内容），全部经引擎实跑验证：
 * 有 risk 反对位、有软化点（I1 的"立场被驳并改写"）、冲突≥1。
 * title = 正文精简版（不重复正文原文）。2026-10-28 step-5 增补（anyi2 拍板）。
 * 交互（v0.8 按 anyi2 反馈修正）：只填入、不自动跑——跑不跑的决定权留给评委。
 */
const PRESETS = [
  { tag: '🧩 功能', label: '一键下单 · 免密支付', title: '新增一键下单，默认免密支付', body: '新增一键下单功能，默认免密支付，减少下单步骤' },
  { tag: '💰 商业', label: '订阅涨价 50%', title: '核心订阅涨价 50%', body: '核心订阅套餐价格上调 50%，老用户同步执行' },
  { tag: '🔧 技术', label: '单体拆微服务', title: '单体应用拆微服务', body: '把现在的单体应用拆成微服务，各团队独立部署' },
  { tag: '📣 内容', label: '取消人工审核', title: '用户内容取消人工审核', body: '用户内容取消人工审核，通过后直接上架' },
];

/**
 * 「试一个」轮播剧本（v0.8 按 anyi2 反馈增补）：连点连看不重样，共 7 个。
 * 第 1 个是原 7 天 Pro 引导提案，其余与预置同源（引擎实跑验证有对抗有软化）。
 */
const DEMO_SCRIPTS = [
  { title: '给核心功能加 7 天 Pro 免费试用', body: DEMO_PROPOSAL.body },
  { title: '新增一键下单，默认免密支付', body: '新增一键下单功能，默认免密支付，减少下单步骤' },
  { title: '核心订阅涨价 50%', body: '核心订阅套餐价格上调 50%，老用户同步执行' },
  { title: '单体应用拆微服务', body: '把现在的单体应用拆成微服务，各团队独立部署' },
  { title: '用户内容取消人工审核', body: '用户内容取消人工审核，通过后直接上架' },
  { title: '上线会员积分体系', body: '上线会员积分体系，消费自动累积积分可抵扣现金' },
  { title: '数据库迁移新机房', body: '把数据库迁移到新机房，预计停机两小时' },
];
let demoIdx = 0;

/** 当前运行句柄（{ runId, cancel }）；并发时以它为 UI 锚点。 */
let current = null;
let conflictsTotal = 0;
let opinionsSeen = 0;
/** 同一路径（含方向）已画弧线数，用于让多条反驳弧线错开不重叠。 */
let arcCounts = {};
/** stanceId → position（support/oppose/conditional），用于箭头按目标立场分色。 */
let positionsMap = {};

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

/** 下滑工具组 v2（anyi2 2026-10-28）：两个目标各自可调——
   ① 审议区：环形图面板垂直居中（start() 自动下滑）
   ② 结论区：裁决卡顶对齐 +24px（结论出现后右侧箭头一键下滑）
   默认偏移 = anyi2 实测调定值（2026-10-28 22:38）：审议 +124 / 结论 -299。
   localStorage 有保存值则覆盖默认（调过的人保留自己的）；「恢复默认」回内置值。
   调整 UI 平常对评委隐身，?scrolladjust=1 唤出（再调不用改代码）。 */
const SCROLL_KEY_STAGE = 'council-scroll-delta-v2';
const SCROLL_KEY_VERDICT = 'council-scroll-verdict-v2';
const SCROLL_DEFAULT = { stage: 124, verdict: -299 }; // anyi2 实测调定，烙为默认
let scrollDelta = { ...SCROLL_DEFAULT };
let scrollAdjust = false;
let scrollAdjustSeg = 'stage'; // 当前调整段：stage=审议区 / verdict=结论区
try {
  // 注意：必须先用原始串判空——Number(null)===0 会把「无保存」误判成「保存了 0」而覆盖默认值
  const rs = localStorage.getItem(SCROLL_KEY_STAGE);
  const rv = localStorage.getItem(SCROLL_KEY_VERDICT);
  if (rs !== null && Number.isFinite(Number(rs))) scrollDelta.stage = Number(rs);
  if (rv !== null && Number.isFinite(Number(rv))) scrollDelta.verdict = Number(rv);
} catch (e) { scrollDelta = { ...SCROLL_DEFAULT }; }

function scrollBaseTarget(which) {
  const el = which === 'verdict' ? $('verdict-card') : $('stage-panel');
  if (!el || typeof el.getBoundingClientRect !== 'function') return 0;
  const r = el.getBoundingClientRect();
  const docTop = r.top + (window.scrollY || 0);
  if (which === 'verdict') return Math.max(0, docTop - 24); // 裁决卡可能超高：顶对齐 +24px 最稳
  return Math.max(0, docTop - Math.max(0, (window.innerHeight - r.height) / 2)); // 审议区垂直居中
}
function scrollReduceMotion() {
  return typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
function scrollToStage() {
  if (scrollAdjust) return; // 调整模式中不抢用户的滚动控制权
  window.scrollTo({ top: Math.max(0, scrollBaseTarget('stage') + scrollDelta.stage), behavior: scrollReduceMotion() ? 'auto' : 'smooth' });
}
function scrollToVerdict() {
  window.scrollTo({ top: Math.max(0, scrollBaseTarget('verdict') + scrollDelta.verdict), behavior: scrollReduceMotion() ? 'auto' : 'smooth' });
}
function scrollSegKey() { return scrollAdjustSeg === 'verdict' ? SCROLL_KEY_VERDICT : SCROLL_KEY_STAGE; }
function scrollSegName() { return scrollAdjustSeg === 'verdict' ? '结论区' : '审议区'; }
function scrollFmt(d) { return d === 0 ? '默认' : `${d >= 0 ? '+' : ''}${d}px`; }

function scrollAdjustLabel() {
  const btn = $('scrollAdjustBtn');
  if (!btn) return;
  btn.textContent = `⚙ 下滑位置（审议 ${scrollFmt(scrollDelta.stage)} · 结论 ${scrollFmt(scrollDelta.verdict)}）`;
  btn.title = '点击调整两个下滑目标的位置（先选目标段，再滚到理想位保存）';
}
function scrollAdjustSegmentsRender() {
  document.querySelectorAll('.seg-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.seg === scrollAdjustSeg);
  });
}
function scrollAdjustGoto() {
  // 预滚到当前段的生效位（进模式 / 切段时用）
  window.scrollTo({
    top: Math.max(0, scrollBaseTarget(scrollAdjustSeg) + scrollDelta[scrollAdjustSeg]),
    behavior: scrollReduceMotion() ? 'auto' : 'smooth',
  });
  scrollAdjustShowDelta();
}
function scrollAdjustEnter() {
  scrollAdjust = true;
  $('scrollBar').classList.remove('hidden');
  scrollAdjustSegmentsRender();
  scrollAdjustGoto();
  scrollAdjustLoop(); // rAF 兜底：scroll 事件若被合并/漏掉，显示照样实时
}
function scrollAdjustShowDelta() {
  const d = Math.round((window.scrollY || 0) - scrollBaseTarget(scrollAdjustSeg));
  const el = $('scrollDelta');
  if (el) el.textContent = `当前偏移 ${d >= 0 ? '+' : ''}${d}px`;
}
function scrollAdjustLoop() {
  if (!scrollAdjust) return;
  scrollAdjustShowDelta();
  requestAnimationFrame(scrollAdjustLoop);
}
function scrollAdjustSave() {
  scrollDelta[scrollAdjustSeg] = Math.round((window.scrollY || 0) - scrollBaseTarget(scrollAdjustSeg));
  try { localStorage.setItem(scrollSegKey(), String(scrollDelta[scrollAdjustSeg])); } catch (e) { /* 写入失败则仅本会话 */ }
  scrollAdjustExit();
  setStage(`${scrollSegName()}位置已保存（偏移 ${scrollFmt(scrollDelta[scrollAdjustSeg])}）`);
}
function scrollAdjustReset() {
  scrollDelta[scrollAdjustSeg] = SCROLL_DEFAULT[scrollAdjustSeg]; // 恢复内置默认（anyi2 调定值）而非 0
  try { localStorage.removeItem(scrollSegKey()); } catch (e) { /* ignore */ }
  scrollAdjustExit();
  setStage(`${scrollSegName()}位置已恢复默认（${scrollFmt(SCROLL_DEFAULT[scrollAdjustSeg])}）`);
}
function scrollAdjustExit() {
  scrollAdjust = false;
  $('scrollBar').classList.add('hidden');
  scrollAdjustLabel();
}
window.addEventListener('scroll', () => { if (scrollAdjust) scrollAdjustShowDelta(); }, { passive: true });

// 结论区一键下滑箭头（裁决出现后从右侧中部浮出，点击滑到结论区）
$('toVerdict').addEventListener('click', scrollToVerdict);

// ─────────────────────────────────────────────
// 重置（run_started 前清场）
// ─────────────────────────────────────────────

const OPINION_INITIAL = (name, id) => `
  <div class="head"><span class="name">${name}</span><span class="badge" id="badge-${id}">待激活</span></div>
  <p class="placeholder-line" id="ph-${id}">等待发表意见…</p>`;

function resetUI() {
  zoomClose(); // 新 run 清场：关掉可能钉住的放大镜
  $('toVerdict').classList.add('hidden'); // 结论箭头收起（新 run 未出结论）
  conflictsTotal = 0;
  opinionsSeen = 0;
  arcCounts = {};
  positionsMap = {};
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

  const stanceName = (STANCES.find((s) => s.id === stanceId) || {}).name || stanceId;
  const box = document.createElement('div');
  box.classList.add('zoomable');
  box.setAttribute('data-zoom-title', `${stanceName} · 意见`);
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
  if (svg.querySelector('#arrow-support')) return;
  const defs = document.createElementNS(SVGNS, 'defs');
  // 三色箭头：按目标立场分（绿=支持/黄=有条件/红=反对）
  const colors = [
    ['support', '#3fb950'],
    ['conditional', '#d29922'],
    ['oppose', '#f85149'],
  ];
  defs.innerHTML = colors.map(([id, color]) => `
    <marker id="arrow-${id}" viewBox="0 0 10 10" refX="9" refY="5"
      markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M0,0 L10,5 L0,10 z" fill="${color}"></path>
    </marker>`).join('');
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
  // 按目标（to）立场分色：弧线 + 箭头
  const toPos = positionsMap[to] || 'conditional';
  const path = document.createElementNS(SVGNS, 'path');
  path.setAttribute('d', `M ${p1.x} ${p1.y} Q ${cx} ${cy} ${p2.x} ${p2.y}`);
  path.setAttribute('class', `rebuttal-arc arc-${toPos}`);
  path.setAttribute('marker-end', `url(#arrow-${toPos})`);
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
    <div class="head zoomable" data-zoom-title="最终裁决">
      <span class="vname">最终裁决</span>
      <span class="decision-badge ${verdict.decision}">${DECISION_LABEL[verdict.decision]}</span>
      <span class="rate">收敛率 <b>${verdict.conflictsResolved}/${verdict.conflictsTotal}</b>（${rate}%）</span>
    </div>
    <div class="verdict-block zoomable" data-zoom-title="裁决理由"><h3>裁决理由</h3><ul>${li(verdict.reasons)}</ul></div>
    <div class="verdict-block zoomable" data-zoom-title="残余风险（未完全收敛）"><h3>残余风险（未完全收敛）</h3><ul>${li(verdict.residualRisks)}</ul></div>
    <div class="verdict-block zoomable" data-zoom-title="推翻条件（满足则重新审议）"><h3>推翻条件（满足则重新审议）</h3><ul>${li(verdict.overturnConditions)}</ul></div>`;
  card.classList.remove('hidden');
  $('toVerdict').classList.remove('hidden'); // 结论已出：浮出右侧下滑箭头
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
      positionsMap[e.stanceId] = e.opinion.position;
      activateNode(e.stanceId, e.opinion);
      fillOpinionCard(e.stanceId, e.opinion);
      playSfx(sfxWake); // 节点唤醒音，和点亮同步，共 4 声
      setStage(`视角发言 ${opinionsSeen}/4`);
      break;
    case EVENTS.CONFLICT_DETECTED:
      conflictsTotal += 1;
      drawConflictPrep(e.conflict);
      playSfx(sfxArrow); // 箭头出现同步
      setConv(0, conflictsTotal);
      setStage('冲突检测');
      break;
    case EVENTS.REBUTTAL:
      drawRebuttal(e.rebuttal);
      playSfx(sfxArrow); // 反驳箭头出现同步
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
  scrollToStage(); // 丝滑下滑到审议区：评委点完就知道该看哪
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

// ─────────────────────────────────────────────
// 音效（5 路：节点唤醒 / 箭头 / 点击 / 悬浮弹出 / 背景）
// ─────────────────────────────────────────────

const sfxWake = new Audio('./wake.wav');   // 节点点亮，4 声同步
const sfxArrow = new Audio('./arrow.wav');  // 箭头出现同步
const sfxClick = new Audio('./click.wav');  // 开始审议按钮
const sfxHover = new Audio('./hover.wav');  // 悬浮窗弹出
const sfxBg = new Audio('./bg.wav');       // 背景音（极轻循环）
sfxBg.loop = true;
[sfxWake, sfxArrow, sfxClick, sfxHover, sfxBg].forEach((a) => { a.preload = 'auto'; });
// 音量在下方「音量控制面板」段落统一 apply（声明在彼处，避免 TDZ）

function playSfx(a) {
  try {
    a.currentTime = 0; // 快速连续触发时从头播，避免叠音
    const p = a.play();
    if (p && p.catch) p.catch(() => { /* 自动播放策略拦截则静默 */ });
  } catch (e) { /* 音频不可用时不影响主流程 */ }
}

// 背景音：首次用户交互后启动（浏览器自动播放策略，autoplay 不强制）
document.addEventListener('pointerdown', () => playSfx(sfxBg), { once: true });

// ─────────────────────────────────────────────
// 音量控制面板（anyi2 2026-10-29 规格，联调日交付）
// 拖动栏×2（音效/背景）+ 状态栏 + 总开关 + 「音量在此关闭」小提醒；
// 滑块是相对豆包 v0.14 基础音量的比例（默认 100% = 她的平衡，一行未改）；
// anyi2 试听定值后改 AUDIO_DEFAULT 烙死，滑块仍留给评委自调。
// ─────────────────────────────────────────────
const AUDIO_KEY = 'council-audio-v1';
const SFX_BASE = { wake: 0.4, arrow: 0.35, click: 0.25, hover: 0.4 }; // 豆包 v0.14 平衡
const BG_BASE = 0.4;
const AUDIO_DEFAULT = { sfx: 100, bg: 100, on: true }; // ← anyi2 试听后把数值改这里
const audio = { ...AUDIO_DEFAULT };
try { Object.assign(audio, JSON.parse(localStorage.getItem(AUDIO_KEY) || '{}')); } catch (e) { /* ignore */ }

function audioApply() {
  const k = audio.on ? 1 : 0;
  sfxWake.volume = SFX_BASE.wake * audio.sfx / 100 * k;
  sfxArrow.volume = SFX_BASE.arrow * audio.sfx / 100 * k;
  sfxClick.volume = SFX_BASE.click * audio.sfx / 100 * k;
  sfxHover.volume = SFX_BASE.hover * audio.sfx / 100 * k;
  sfxBg.volume = BG_BASE * audio.bg / 100 * k;
  const st = $('audioStatus');
  if (st) st.textContent = audio.on ? `音效 ${audio.sfx}% · 背景 ${audio.bg}%` : '已关闭';
  const sw = $('audioSwitch');
  if (sw) {
    sw.textContent = audio.on ? '🔊' : '🔇';
    sw.setAttribute('aria-pressed', String(audio.on));
  }
}
function audioSave() {
  try { localStorage.setItem(AUDIO_KEY, JSON.stringify(audio)); } catch (e) { /* ignore */ }
  audioApply();
}
// 拖动滑块即调即存（关了的情况下拖动=重开，与小提醒文案一致）
$('audioSfx').addEventListener('input', (e) => { audio.sfx = Number(e.target.value) || 0; audio.on = true; audioSave(); });
$('audioBg').addEventListener('input', (e) => { audio.bg = Number(e.target.value) || 0; audio.on = true; audioSave(); });
$('audioSwitch').addEventListener('click', () => { audio.on = !audio.on; audioSave(); });
audioApply(); // 初始化音量（含持久化的用户选择）

$('btn-run').addEventListener('click', () => {
  const p = readInput();
  if (!p.body && !p.title) {
    setStage('请先输入提案');
    return;
  }
  playSfx(sfxClick);
  start(p);
});

$('btn-demo').addEventListener('click', () => {
  const i = demoIdx;
  demoIdx = (demoIdx + 1) % DEMO_SCRIPTS.length;
  const s = DEMO_SCRIPTS[i];
  $('in-title').value = s.title;
  $('in-body').value = s.body;
  $('btn-demo').textContent = `试一个 ${i + 1}/${DEMO_SCRIPTS.length}`;
  start({ title: s.title, body: s.body });
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

// ─────────────────────────────────────────────
// 预置提案（评委视角：一键看完整审议）
// v0.8 修正（anyi2 反馈）：只填入不自动跑——评委要先读提案再决定跑不跑，
// 自动触发是剥夺控制权；填入后给「开始审议」一个脉冲提示下一步。
// ─────────────────────────────────────────────

document.querySelectorAll('.preset').forEach((btn) => {
  btn.addEventListener('click', () => {
    const p = PRESETS[Number(btn.dataset.i)];
    if (!p) return;
    $('in-title').value = p.title;
    $('in-body').value = p.body;
    const runBtn = $('btn-run');
    runBtn.classList.remove('pulse');
    void runBtn.offsetWidth; // 强制重排，让动画可重复触发
    runBtn.classList.add('pulse');
    setStage('已填入提案 · 点「开始审议」开跑');
  });
});

// 下滑位置手动调整（anyi2）：进入 / 保存 / 恢复默认 / 取消
$('scrollAdjustBtn').addEventListener('click', scrollAdjustEnter);
$('scrollSave').addEventListener('click', scrollAdjustSave);
$('scrollReset').addEventListener('click', scrollAdjustReset);
$('scrollCancel').addEventListener('click', scrollAdjustExit);
scrollAdjustLabel(); // 有历史自定义则启动即显示状态

// 调整 UI 平常对评委隐身（anyi2 2026-10-28：调定后隐藏开关）；?scrolladjust=1 唤出再调
const SCROLL_ADMIN = new URLSearchParams(location.search).get('scrolladjust') === '1';
if (!SCROLL_ADMIN) $('scrollAdjustBtn').classList.add('hidden');

// 调整模式的目标段切换（审议区 / 结论区）
document.querySelectorAll('.seg-btn').forEach((b) => {
  b.addEventListener('click', () => {
    scrollAdjustSeg = b.dataset.seg;
    scrollAdjustSegmentsRender();
    scrollAdjustGoto(); // 切段即预滚到该目标当前生效位
  });
});

// ─────────────────────────────────────────────
// 结论区悬浮放大镜（hover 预览 / click 钉住 / Esc 或罩外点击关闭）
// 触发区：裁决卡四区（最终裁决 / 裁决理由 / 残余风险 / 推翻条件），class=zoomable
// ─────────────────────────────────────────────

const zoomEl = $('zoom');
const zoomInner = $('zoomInner');
let zoomPinned = false;
let zoomTimer = null;
/* 悬浮窗位置：按目标元素分键记忆（各自独立），localStorage 持久化（刷新不丢）。 */
const ZOOM_POS_KEY = 'council-zoom-pos-v1';
let zoomPos = {};
try { zoomPos = JSON.parse(localStorage.getItem(ZOOM_POS_KEY) || '{}') || {}; } catch (e) { zoomPos = {}; }
let zoomCurKey = null;
function zoomKeyOf(block) { return block.getAttribute('data-zoom-title') || block.className || 'default'; }
function zoomSavePos(key, left, top) {
  zoomPos[key] = { l: Math.round(left), t: Math.round(top) };
  try { localStorage.setItem(ZOOM_POS_KEY, JSON.stringify(zoomPos)); } catch (e) { /* 隐私模式等写入失败则仅会话有效 */ }
}

/** 定位：该目标有记忆位置则恢复（钳位防跨屏幕尺寸出屏），否则贴触发块右侧自动定位。 */
function zoomPlace(block) {
  const key = zoomKeyOf(block);
  const saved = zoomPos[key];
  if (saved) {
    const w = zoomEl.offsetWidth;
    const h = zoomEl.offsetHeight;
    zoomEl.style.left = `${Math.min(saved.l, Math.max(4, window.innerWidth - w - 4))}px`;
    zoomEl.style.top = `${Math.min(saved.t, Math.max(4, window.innerHeight - h - 4))}px`;
    return;
  }
  const r = block.getBoundingClientRect();
  const zw = zoomEl.offsetWidth;
  const zh = zoomEl.offsetHeight;
  let left = r.right + 14;
  if (left + zw > window.innerWidth - 12) left = r.left - zw - 14;
  if (left < 12) left = Math.max(12, (window.innerWidth - zw) / 2);
  let top = r.top + r.height / 2 - zh / 2;
  top = Math.min(Math.max(12, top), Math.max(12, window.innerHeight - zh - 12));
  zoomEl.style.left = `${Math.round(left)}px`;
  zoomEl.style.top = `${Math.round(top)}px`;
}

function zoomOpen(block) {
  const wasHidden = zoomEl.classList.contains('hidden');
  const title = block.getAttribute('data-zoom-title') || '详情';
  zoomCurKey = zoomKeyOf(block);
  zoomInner.innerHTML = `<h3 class="zoom-title">${title}</h3><div class="zoom-body">${block.innerHTML}</div>`;
  zoomEl.classList.remove('hidden');
  zoomEl.classList.remove('handle-hidden'); // 每次打开重新显示手柄（调整完再淡出）
  zoomPlace(block);
  if (wasHidden) playSfx(sfxHover); // 仅窗口弹出瞬间播音，悬停移动不重复
}

function zoomScheduleClose() {
  clearTimeout(zoomTimer);
  zoomTimer = setTimeout(() => {
    if (!zoomPinned && !zoomEl.matches(':hover')) zoomEl.classList.add('hidden');
  }, 260);
}

function zoomClose() {
  zoomPinned = false;
  zoomEl.classList.add('hidden');
}

/** 取最近的 .zoomable 触发块（e.target 可能是 SVG 子元素，closest 通吃）。 */
function zoomTarget(e) {
  const t = e && e.target;
  return t && typeof t.closest === 'function' ? t.closest('.zoomable') : null;
}

document.addEventListener('mouseover', (e) => {
  const b = zoomTarget(e);
  if (!b || zoomPinned) return;
  clearTimeout(zoomTimer);
  zoomOpen(b);
});
document.addEventListener('mouseout', (e) => {
  if (!zoomTarget(e) || zoomPinned) return;
  zoomScheduleClose();
});
zoomEl.addEventListener('mouseenter', () => clearTimeout(zoomTimer));
zoomEl.addEventListener('mouseleave', () => { if (!zoomPinned) zoomScheduleClose(); });
$('zoomClose').addEventListener('click', zoomClose);
document.addEventListener('click', (e) => {
  const t = e.target;
  const inZoom = t && typeof t.closest === 'function' && t.closest('#zoom');
  if (inZoom && !(t.closest('#zoomClose'))) return; // 罩内点击不关（方便选中文字）
  const b = zoomTarget(e);
  if (b) { zoomPinned = true; zoomOpen(b); return; } // 点击触发块 = 钉住
  if (zoomPinned) zoomClose(); // 罩外点击且处于钉住态 = 关闭
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') zoomClose(); });

// ─────────────────────────────────────────────
// 放大窗拖移（anyi2 2026-10-28 需求）：手柄拖动定位，钳在视口内；
// 拖移过后位置粘滞（不再自动定位），手柄淡出让位；悬停面板可重新唤出手柄
// ─────────────────────────────────────────────

const zoomHandle = $('zoomHandle');
let zoomDragging = false;
let zoomDragOff = { x: 0, y: 0 };

zoomHandle.addEventListener('pointerdown', (e) => {
  zoomDragging = true;
  const r = zoomEl.getBoundingClientRect();
  zoomDragOff.x = e.clientX - r.left;
  zoomDragOff.y = e.clientY - r.top;
  zoomHandle.setPointerCapture(e.pointerId);
  zoomEl.classList.add('dragging');
  e.preventDefault();
});
zoomHandle.addEventListener('pointermove', (e) => {
  if (!zoomDragging) return;
  const w = zoomEl.offsetWidth;
  const h = zoomEl.offsetHeight;
  const x = Math.min(Math.max(4, e.clientX - zoomDragOff.x), Math.max(4, window.innerWidth - w - 4));
  const y = Math.min(Math.max(4, e.clientY - zoomDragOff.y), Math.max(4, window.innerHeight - h - 4));
  zoomEl.style.left = `${Math.round(x)}px`;
  zoomEl.style.top = `${Math.round(y)}px`;
});
function zoomDragEnd(e) {
  if (!zoomDragging) return;
  zoomDragging = false;
  zoomEl.classList.remove('dragging');
  if (e && e.pointerId !== undefined && zoomHandle.releasePointerCapture) {
    try { zoomHandle.releasePointerCapture(e.pointerId); } catch (_) { /* 已释放则忽略 */ }
  }
  // 松手即存：该窗口自己的位置（分键），刷新不丢
  if (zoomCurKey) zoomSavePos(zoomCurKey, parseFloat(zoomEl.style.left) || 0, parseFloat(zoomEl.style.top) || 0);
  zoomEl.classList.add('handle-hidden'); // 调整完毕：手柄淡出（悬停面板可唤回）
}
zoomHandle.addEventListener('pointerup', zoomDragEnd);
zoomHandle.addEventListener('pointercancel', zoomDragEnd);
zoomEl.addEventListener('mouseenter', () => zoomEl.classList.remove('handle-hidden'));
