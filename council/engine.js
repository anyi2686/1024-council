/**
 * 九人议会 · 规则引擎 v1.0（2026-10-26 step-5 实现，兑现 MVS 第一天交付）
 *
 * 规格宪法：1024_PARLIAMENT_SPEC.md v1.0（账本 `agent-log/` 内）
 * 验收标准：ACCEPTANCE_1024.md E1–E6（自验见 engine.test.mjs，node 直接跑）
 *
 * 契约（与 mock-engine.js 逐字一致，UI 切换只需改 import 一行）：
 *   - runCouncil(proposal, onEvent) → { runId, events, degraded, cancel }
 *   - onEvent 按规格 §2 时序异步播放（setTimeout）；events 为同步全量数组
 *   - 确定性（E6）：events 内容（除 runId）完全由输入决定，零随机零时钟
 *   - 事件集合 8 个：run_started / proposal_received / proposal_typed /
 *     stance_opinion×4 / conflict_detected×N / rebuttal×N / verdict_ready /
 *     verdict（或 degraded{reason, echo}）——proposal_received 为 v1.0 新增
 *     （小Q 10/24 指出的集合缺口；UI handleEvent 有 default 分支，安全忽略）
 */

import {
  TYPE_KEYWORDS,
  RISK_EDGE_WORDS,
  GROWTH_EDGE_WORDS,
  STANCE_LENSES,
  POSITION_BY_TYPE,
  OVERTURN_CONDITIONS,
  REBUTTAL_TEMPLATES,
  VERDICT_TEMPLATES,
  DEMO_PROPOSAL,
} from './demo-data.js';

// ─────────────────────────────────────────────
// §1 数据结构（规格 v1.0 §1，JSDoc）
// ─────────────────────────────────────────────

/**
 * @typedef {'feature'|'business'|'tech'|'content'|'unknown'} ProposalType
 */

/**
 * @typedef {Object} Proposal
 * @property {string} id
 * @property {string} title
 * @property {string} body
 * @property {ProposalType} type
 * @property {string[]} keywords
 * @property {string} hash
 */

/**
 * @typedef {'risk'|'cost'|'creative'|'user'} StanceId
 */

/**
 * @typedef {Object} Opinion
 * @property {StanceId} stanceId
 * @property {'support'|'oppose'|'conditional'} position
 * @property {string[]} questions
 * @property {string} initialJudgment
 */

/**
 * @typedef {'polarity'|'priority'} ConflictType
 */

/**
 * @typedef {Object} Conflict
 * @property {string} id
 * @property {[StanceId, StanceId]} pair
 * @property {ConflictType} type
 * @property {string} desc
 */

/**
 * @typedef {Object} Rebuttal
 * @property {string} id
 * @property {StanceId} from
 * @property {StanceId} to
 * @property {number} round
 * @property {string} content
 * @property {number} cost  被驳方累计代价（UI 软化判据：cost≥3）
 */

/**
 * @typedef {Object} Verdict
 * @property {'adopt'|'reject'|'conditional'} decision
 * @property {string[]} reasons
 * @property {string[]} residualRisks
 * @property {string[]} overturnConditions
 * @property {number} conflictsResolved
 * @property {number} conflictsTotal
 */

// ─────────────────────────────────────────────
// §2 事件常量与视角（契约层，改必经 step-5 + Doubao 双认）
// ─────────────────────────────────────────────

export const EVENTS = {
  RUN_STARTED: 'run_started',
  PROPOSAL_RECEIVED: 'proposal_received',
  PROPOSAL_TYPED: 'proposal_typed',
  STANCE_OPINION: 'stance_opinion',
  CONFLICT_DETECTED: 'conflict_detected',
  REBUTTAL: 'rebuttal',
  VERDICT_READY: 'verdict_ready',
  VERDICT: 'verdict',
  DEGRADED: 'degraded',
};

export const STANCES = [
  { id: 'risk', name: '风险哨兵' },
  { id: 'cost', name: '成本会计' },
  { id: 'creative', name: '创意催化剂' },
  { id: 'user', name: '用户代言' },
];

const STANCE_ORDER = STANCES.map((s) => s.id);

// ─────────────────────────────────────────────
// §3 确定性规则（规格 v1.0 §3）
// ─────────────────────────────────────────────

/** 简单字符串 hash（非加密；与 mock 同算法，保证同输入同 hash）。 */
function hash32(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 规格 §3.1：意图分类 + 关键词抽取。命中词表的词 + 引号片段（仅词表 0 命中时启用）。 */
function classify(title, body) {
  const text = `${title} ${body}`;
  const scores = { feature: 0, business: 0, tech: 0, content: 0 };
  const hit = [];
  for (const [type, words] of Object.entries(TYPE_KEYWORDS)) {
    for (const w of words) {
      if (text.includes(w)) {
        scores[type] += 1;
        hit.push(w);
      }
    }
  }
  let keywords = [...new Set(hit)].slice(0, 8);

  // 词表 0 命中时，引号片段作为关键词候选（2–12 字）——让带自定义术语的提案
  // （如「无缝断点续传」）也能被透镜引用；完全无关的输入仍会 0 命中 → degraded。
  if (keywords.length === 0) {
    const quoted = text.match(/[「『“”"']([^「」『』“”"']{2,12})[」』”"']/g) || [];
    keywords = quoted
      .map((s) => s.replace(/^[「『“”"']+|[」』”"']+$/g, ''))
      .filter((s) => s.length >= 2 && s.length <= 12)
      .slice(0, 3);
  }

  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [type, top] = entries[0];
  return { type: top > 0 ? type : 'unknown', keywords };
}

/** 关键词展示串（透镜模板 {kw} 槽位；无关键词时用泛称）。 */
function kwLabel(keywords) {
  return keywords.length ? keywords.slice(0, 3).join('、') : '该方案';
}

/** 规格 §3.2：立场先验（按类型）+ 关键词微调。 */
function decidePositions(type, keywords, text) {
  const base = POSITION_BY_TYPE[type] || POSITION_BY_TYPE.feature;
  const pos = { ...base };
  // 微调规则（确定性）：risk 增强词命中且 risk 非 oppose → 升 oppose；
  // growth 词命中且 user 非 support → 升 support。仅微调一档，保持可预期。
  if (RISK_EDGE_WORDS.some((w) => text.includes(w)) && pos.risk !== 'oppose') pos.risk = 'oppose';
  if (GROWTH_EDGE_WORDS.some((w) => text.includes(w)) && pos.user !== 'support') pos.user = 'support';
  return pos;
}

/** 规格 §3.2：四视角三段式意见（立场 + 追问 + 初始判断），模板填空。 */
function buildOpinions(type, keywords, text) {
  const pos = decidePositions(type, keywords, text);
  const kw = kwLabel(keywords);
  const opinions = {};
  for (const id of STANCE_ORDER) {
    const lens = STANCE_LENSES[id];
    const fill = (tpl) => tpl.replace(/\{kw\}/g, kw);
    opinions[id] = {
      stanceId: id,
      position: pos[id],
      questions: lens.questions.map(fill),
      initialJudgment: fill(lens.judgment),
    };
  }
  return opinions;
}

/**
 * 规格 §3.3：冲突检测（MVS 两型——polarity 与 priority；resource/risk 型列完整版）。
 * - polarity：立场确实相反（support vs oppose）——非硬凑，E3 人眼可验；
 * - priority：四透镜第一优先级结构性不同，仅在没有 polarity 时发一个保底，
 *   desc 写明"结构性差异"依据，不伪装成观点对立。
 * 返回 { conflicts, unresolvedCount }；无真实冲突时返回空数组（verdict 走 clean 路径）。
 */
function detectConflicts(opinions) {
  const conflicts = [];
  for (let i = 0; i < STANCE_ORDER.length && conflicts.length < 3; i++) {
    for (let j = i + 1; j < STANCE_ORDER.length && conflicts.length < 3; j++) {
      const a = STANCE_ORDER[i];
      const b = STANCE_ORDER[j];
      const oa = opinions[a];
      const ob = opinions[b];
      const opposite =
        (oa.position === 'support' && ob.position === 'oppose') ||
        (oa.position === 'oppose' && ob.position === 'support');
      if (opposite) {
        const supporter = oa.position === 'support' ? a : b;
        const opposer = oa.position === 'oppose' ? a : b;
        conflicts.push({
          id: `C${conflicts.length + 1}`,
          pair: [supporter, opposer],
          type: 'polarity',
          desc: `${STANCE_LENSES[supporter].name}以「${opinions[supporter].initialJudgment}」支持，${STANCE_LENSES[opposer].name}以「${opinions[opposer].initialJudgment}」反对——围绕同一提案，立场两极，需对质。`,
        });
      }
    }
  }
  if (conflicts.length === 0) {
    // 结构性 priority 冲突：不是观点对立，是四个透镜看同一个东西必然的优先级差异。
    conflicts.push({
      id: 'C1',
      pair: ['risk', 'creative'],
      type: 'priority',
      desc: `四视角立场未现两极，但透镜的第一优先级结构性不同：${STANCE_LENSES.risk.name}先保「${STANCE_LENSES.risk.priority}」，${STANCE_LENSES.creative.name}先求「${STANCE_LENSES.creative.priority}」——需确认先保稳还是先求差异。`,
    });
  }
  return conflicts;
}

/**
 * 规格 §3.4：反驳链（三代上限 + 代价软化）。
 * 对首个 polarity 冲突生成完整链；第二个冲突只生成一轮首驳（控制事件量，MVS）。
 * cost 累计在被驳方（to）身上：cost≥3 → 软化（UI markSoftened），
 * 最终由被驳方发改写陈述（concede），即 I1 判据要看见的「第一次立场被驳并改写」。
 *
 * 数据卫生（2026-10-26 修）：软化只改内部视图 positionView，
 * **不原地修改 opinions**——stance_opinion 事件里存的是引用，原地改会污染已发出的事件。
 */
function buildRebuttals(conflicts, opinions, keywords) {
  const rebuttals = [];
  const cost = { risk: 0, cost: 0, creative: 0, user: 0 };
  const positionView = {};
  for (const id of STANCE_ORDER) positionView[id] = opinions[id].position;
  const kw = kwLabel(keywords);

  const primary = conflicts.find((c) => c.type === 'polarity') || conflicts[0];
  if (!primary) return { rebuttals, cost, softened: [], positionView };

  // 被挑战方 = 冲突中的 support 方（反对者质疑支持者，议会直觉）；priority 型取 creative。
  const target = primary.type === 'polarity' ? primary.pair[0] : 'creative';
  const challenger = primary.type === 'polarity' ? primary.pair[1] : 'risk';

  const edgeFor = (stanceId) => {
    const o = opinions[stanceId];
    return o ? o.initialJudgment : STANCE_LENSES[stanceId].judgment.replace(/\{kw\}/g, kw);
  };
  const fixesFor = () => '对方点名的约束与前提';

  // R1：首驳（挑战方 → 被挑战方），cost=1
  cost[target] += 1;
  rebuttals.push({
    id: 'R1',
    from: challenger,
    to: target,
    round: 1,
    content: REBUTTAL_TEMPLATES.challenge
      .replace('{conflict}', primary.id)
      .replace('{challenger}', STANCE_LENSES[challenger].name)
      .replace('{edge}', edgeFor(challenger)),
    cost: cost[target],
  });

  // R2：第二驳，cost=2 —— 有第二个反对者则由其发难（双源质疑更硬）；
  // 没有则由挑战方从第二个切面追驳（保证链能打到 cost=3，软化必然可达）。
  const second = STANCE_ORDER.find(
    (s) => s !== target && s !== challenger && positionView[s] === 'oppose',
  );
  cost[target] += 1;
  if (second) {
    rebuttals.push({
      id: 'R2',
      from: second,
      to: target,
      round: 1,
      content: REBUTTAL_TEMPLATES.challenge2
        .replace('{conflict}', primary.id)
        .replace('{challenger}', STANCE_LENSES[second].name)
        .replace('{edge}', edgeFor(second)),
      cost: cost[target],
    });
  } else {
    rebuttals.push({
      id: 'R2',
      from: challenger,
      to: target,
      round: 1,
      content: REBUTTAL_TEMPLATES.followup
        .replace('{conflict}', primary.id)
        .replace('{challenger}', STANCE_LENSES[challenger].name)
        .replace('{edge2}', opinions[challenger].questions[0] || '问题的第二个切面'),
      cost: cost[target],
    });
  }

  // R3：升级驳（后果升级），cost=3 → 触发软化（I1：立场被驳并改写的可见时刻）
  cost[target] += 1;
  rebuttals.push({
    id: 'R3',
    from: challenger,
    to: target,
    round: 2,
    content: REBUTTAL_TEMPLATES.escalate
      .replace('{conflict}', primary.id)
      .replace('{edge2}', '核心目标直接达不成，且没有回头路可走'),
    cost: cost[target],
  });

  // R4：被驳方改写陈述（软化落地——「立场被驳并改写」的可见时刻）
  rebuttals.push({
    id: `R${rebuttals.length + 1}`,
    from: target,
    to: challenger,
    round: 3,
    content: REBUTTAL_TEMPLATES.concede
      .replace('{kw}', kw)
      .replace('{fixes}', fixesFor()),
    cost: 0, // 被陈述方（challenger）未被驳，cost=0——避免 UI 误软化 challenger（mock 同款纪律）
  });

  const softened = STANCE_ORDER.filter((s) => cost[s] >= 3);
  for (const s of softened) {
    positionView[s] = 'conditional'; // 只改内部视图，不碰 opinions（防事件污染）
  }

  // 第二个冲突（若有）：只发一轮首驳，不进软化链
  const secondary = conflicts.find((c) => c !== primary);
  if (secondary && rebuttals.length < 8) {
    const t2 = secondary.type === 'polarity' ? secondary.pair[0] : 'creative';
    const c2 = secondary.type === 'polarity' ? secondary.pair[1] : 'risk';
    rebuttals.push({
      id: `R${rebuttals.length + 1}`,
      from: c2,
      to: t2,
      round: 1,
      content: REBUTTAL_TEMPLATES.challenge
        .replace('{conflict}', secondary.id)
        .replace('{challenger}', STANCE_LENSES[c2].name)
        .replace('{edge}', edgeFor(c2)),
      // 已被软化的目标再受质疑不重复计软化（UI 判据是单条 cost≥3）；未软化的计 1
      cost: softened.includes(t2) ? 0 : 1,
    });
  }

  return { rebuttals, cost, softened, positionView };
}

/** 规格 §3.5：加权裁决（软化视角权重 0.5；支持>反对 adopt、反对>支持 reject、其余 conditional）。 */
function buildVerdict(positionView, conflicts, rebuttals, softened, keywords) {
  const kw = kwLabel(keywords);
  const w = { support: 0, oppose: 0 };
  for (const id of STANCE_ORDER) {
    const p = positionView[id];
    const weight = softened.includes(id) ? 0.5 : 1;
    if (p === 'support') w.support += weight;
    else if (p === 'oppose') w.oppose += weight;
  }
  const rebuttedIds = new Set(
    rebuttals.map((r) => r.content.match(/引用 (C\d+)/)?.[1]).filter(Boolean),
  );
  const resolved = conflicts.filter((c) => rebuttedIds.has(c.id)).length;
  const resolvedRatio = conflicts.length ? resolved / conflicts.length : 1;
  const softenedCount = softened.length;

  let decision;
  if (resolvedRatio >= 0.5 && softenedCount >= 1) decision = 'conditional';
  else if (w.support > w.oppose) decision = 'adopt';
  else if (w.oppose > w.support) decision = 'reject';
  else decision = 'conditional';

  const reasons = [];
  if (resolved > 0) {
    reasons.push(
      VERDICT_TEMPLATES.reasonsResolved
        .replace('{conflicts}', conflicts.filter((c) => rebuttedIds.has(c.id)).map((c) => c.id).join('、') || '对立点')
        .replace('{fix}', '补约束、有条件推进'),
    );
  } else {
    reasons.push(VERDICT_TEMPLATES.reasonsClean.replace('{kw}', kw));
  }
  const unresolved = conflicts.filter((c) => !rebuttedIds.has(c.id));
  const residualRisks = unresolved.map((c) => VERDICT_TEMPLATES.residualUnresolved.replace('{desc}', c.desc));
  if (residualRisks.length === 0) {
    residualRisks.push(VERDICT_TEMPLATES.residualGeneric.replace('{kw}', kw));
  }
  return {
    decision,
    reasons,
    residualRisks,
    overturnConditions: OVERTURN_CONDITIONS.map((t) => t.replace(/\{kw\}/g, kw)),
    conflictsResolved: resolved,
    conflictsTotal: conflicts.length,
  };
}

// ─────────────────────────────────────────────
// §4 显式失败态（规格 v1.0 §4；小Q E4 验收项）
// ─────────────────────────────────────────────

function degradedReason(normalized) {
  const tooShort = (normalized.title + normalized.body).trim().length < 10;
  if (tooShort) return '提案太短，我看不出它想解决什么。请补一句它要解决的问题或目标。';
  return '没抓到与产品/业务/技术/内容相关的意图，也没看到引号标出的关键术语，我没把握。请补一句它属于哪类决策。';
}

// ─────────────────────────────────────────────
// 事件装配与播放（契约层：与 mock 同签名同行为）
// ─────────────────────────────────────────────

/** 计算一次运行的完整事件序列（同步、确定性；E6 保证同输入同序列，runId 除外）。 */
function computeEvents(runId, proposal) {
  const events = [];
  events.push({ type: EVENTS.RUN_STARTED, runId, proposalHash: proposal.hash });
  events.push({ type: EVENTS.PROPOSAL_RECEIVED, title: proposal.title, body: proposal.body });
  events.push({ type: EVENTS.PROPOSAL_TYPED, typeName: proposal.type, keywords: proposal.keywords });

  const opinions = buildOpinions(proposal.type, proposal.keywords, `${proposal.title} ${proposal.body}`);
  for (const id of STANCE_ORDER) {
    // 深拷贝：事件快照不可被后续软化改写（2026-10-26 修：引用共享曾污染已发出事件）
    const o = opinions[id];
    events.push({
      type: EVENTS.STANCE_OPINION,
      stanceId: id,
      opinion: { stanceId: o.stanceId, position: o.position, questions: [...o.questions], initialJudgment: o.initialJudgment },
    });
  }

  const conflicts = detectConflicts(opinions);
  for (const conflict of conflicts) {
    events.push({ type: EVENTS.CONFLICT_DETECTED, conflict });
  }

  const { rebuttals, softened, positionView } = buildRebuttals(conflicts, opinions, proposal.keywords);
  for (const rebuttal of rebuttals) {
    events.push({ type: EVENTS.REBUTTAL, rebuttal });
  }

  events.push({ type: EVENTS.VERDICT_READY });
  events.push({ type: EVENTS.VERDICT, verdict: buildVerdict(positionView, conflicts, rebuttals, softened, proposal.keywords) });
  return events;
}

/** 规格 §2 时序约定（UI 播放节奏；E-事件间隔 ms）。 */
function delayFor(prev, curr) {
  switch (curr.type) {
    case EVENTS.RUN_STARTED:
      return 0;
    case EVENTS.PROPOSAL_RECEIVED:
      return 120;
    case EVENTS.PROPOSAL_TYPED:
      return 120;
    case EVENTS.STANCE_OPINION:
      return prev && prev.type === EVENTS.STANCE_OPINION ? 1000 : 500;
    case EVENTS.CONFLICT_DETECTED:
      return 500;
    case EVENTS.REBUTTAL:
      return 1200;
    case EVENTS.VERDICT_READY:
      return 900;
    case EVENTS.VERDICT:
      return 600;
    default:
      return 400;
  }
}

/** 归一化输入：接受 {title,body} 或字符串，补齐 id/type/keywords/hash。 */
function normalize(proposal) {
  const p =
    typeof proposal === 'string'
      ? { title: '', body: proposal }
      : { title: proposal?.title || '', body: proposal?.body || '' };
  const { type, keywords } = classify(p.title, p.body);
  const hash = hash32(`${p.title}\n${p.body}`);
  return { id: `p_${hash}`, title: p.title, body: p.body, type, keywords, hash };
}

/**
 * 跑一次议会审议（规则引擎 v1.0）。
 * @param {{title?:string, body?:string}|string} proposal
 * @param {(e: object) => void} [onEvent] 流式回调，按规格 §2 时序触发
 * @returns {{ runId: string, events: object[], degraded: boolean, cancel: () => void }}
 */
export function runCouncil(proposal, onEvent) {
  const normalized = normalize(proposal);
  const runId = `run_${normalized.hash}_${Date.now().toString(36)}`;

  const noHit = normalized.keywords.length === 0;
  const tooShort = (normalized.title + normalized.body).trim().length < 10;
  const degraded = noHit || tooShort;

  let events;
  if (degraded) {
    events = [
      { type: EVENTS.RUN_STARTED, runId, proposalHash: normalized.hash },
      { type: EVENTS.PROPOSAL_RECEIVED, title: normalized.title, body: normalized.body },
      {
        type: EVENTS.DEGRADED,
        reason: degradedReason(normalized),
        echo: { title: normalized.title, body: normalized.body },
      },
    ];
  } else {
    events = computeEvents(runId, normalized);
  }

  const timers = [];
  if (typeof onEvent === 'function') {
    let t = 0;
    events.forEach((e, i) => {
      t += delayFor(events[i - 1], e);
      timers.push(setTimeout(() => onEvent(e), t));
    });
  }

  return {
    runId,
    events,
    degraded,
    cancel: () => {
      timers.forEach(clearTimeout);
      timers.length = 0;
    },
  };
}

export { DEMO_PROPOSAL };
export default { runCouncil, EVENTS, STANCES, DEMO_PROPOSAL };
