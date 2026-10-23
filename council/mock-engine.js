/**
 * 九人议会 · mock 引擎（Doubao 开发期用，非真实引擎）
 *
 * 用途：真实引擎 engine.js 按红线纪律 10/26（周一）才实现。UI 不能空等，
 * 本文件提供一个**与 engine.js 签名一致**的 mock，按规格 1024_PARLIAMENT_SPEC.md
 * §2 的时序吐完整事件流，让 UI 可独立开发、测试、演示。
 *
 * 联调切换：UI 把 `import { runCouncil } from './mock-engine.js'`
 * 改成 `from './engine.js'` 即可，渲染逻辑不动。
 *
 * 注意：mock 里的演示文案是 Doubao 为「7 天 Pro 试用」这一引导提案手写的，
 * 用来验证「真对抗 + 立场被驳并改写」的观感；真实引擎的文案由 step-5 规则生成。
 * 任意其他输入走通用模板（带入分类/关键词），保证不崩，但不代表真实引擎措辞。
 */

import { EVENTS, STANCES } from './engine.js';

// ─────────────────────────────────────────────
// 工具
// ─────────────────────────────────────────────

/** 简单字符串 hash（与规格 hash 用途一致，非加密）。 */
function hash32(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** 规格 §3.1 意图分类词表（mock 用简化计分，真实词表以 step-5 为准）。 */
const TYPE_KEYWORDS = {
  feature: ['功能', '页面', '按钮', '工具', '体验', '流程', '交互', '入口', '弹窗', '试用'],
  business: ['商业', '变现', '市场', '付费', '增长', '客户', '营收', '转化', '会员', '订阅', '续费'],
  tech: ['架构', '性能', '接口', '数据库', '部署', '安全', '缓存', '并发', '重构', '自动'],
  content: ['内容', '文案', '故事', '视频', '社区', '连载', '角色', '剧本'],
};

/** 简化意图分类：返回 { type, keywords }。 */
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
  const keywords = [...new Set(hit)].slice(0, 8);
  const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [type, top] = entries[0];
  return { type: top > 0 ? type : 'unknown', keywords };
}

// ─────────────────────────────────────────────
// 引导提案（「试一个」按钮）：7 天 Pro 试用 —— 手写的真对抗演示
// ─────────────────────────────────────────────

export const DEMO_PROPOSAL = {
  title: '给核心功能加 7 天 Pro 免费试用',
  body: '给核心功能加一个 7 天 Pro 会员免费试用，用户开通后可以体验全部高级功能，试用期结束后自动转为付费订阅，希望能提升付费转化。',
};

/** 引导提案的四视角意见（手写，立场两极，用于真对抗演示）。 */
function demoOpinions() {
  return {
    risk: {
      stanceId: 'risk',
      position: 'oppose',
      initialJudgment: '「自动转付费」有合规与投诉风险，应用商店对自动续费要求显著提示、可随时取消。',
      questions: [
        '自动续费是在开通前显著告知，还是藏在协议条款里？',
        '用户未注意就被扣款，争议和差评谁来处理？',
        '首批被扣款用户的差评会不会拉低应用评分？',
      ],
    },
    cost: {
      stanceId: 'cost',
      position: 'conditional',
      initialJudgment: '要接支付与订阅状态管理，成本中等；试用状态、取消、退款需要长期维护。',
      questions: [
        '支付、订阅、退款链路是新建，还是复用现有支付？',
        '试用状态、取消、续费的逻辑要维护多久？',
        '客服处理续费争议的人力算进成本了吗？',
      ],
    },
    creative: {
      stanceId: 'creative',
      position: 'support',
      initialJudgment: '免费试用降低尝试门槛，是成熟的增长手段，能让用户先体验到完整价值。',
      questions: [
        '用户在试用期内能否真正感知到 Pro 的核心价值？',
        '转化的钩子放在第几天、什么场景？',
        '和同行的试用策略相比，差异点在哪？',
      ],
    },
    user: {
      stanceId: 'user',
      position: 'oppose',
      initialJudgment: '「试用期结束自动扣款」容易被当成套路，尤其新用户，会损伤信任。',
      questions: [
        '用户有没有一键取消、随时取消的入口？',
        '扣款前会不会主动提醒，还是直接扣款？',
        '怕被扣款的用户，会不会干脆不敢试用？',
      ],
    },
  };
}

/** 引导提案的冲突（手写，引用双方意见，非硬凑）。 */
function demoConflicts() {
  return [
    {
      id: 'C1',
      pair: ['creative', 'risk'],
      type: 'polarity',
      desc: '创意催化剂以「成熟增长手段、提升转化」支持，风险哨兵以「自动续费合规、投诉风险」反对，双方都围绕「自动转付费」。',
    },
    {
      id: 'C2',
      pair: ['creative', 'risk'],
      type: 'risk',
      desc: '风险哨兵指出的「自动续费投诉」风险，正落在创意催化剂所支持的「自动转付费」功能点上。',
    },
    {
      id: 'C3',
      pair: ['creative', 'user'],
      type: 'priority',
      desc: '创意催化剂第一优先级是「转化」，用户代言第一优先级是「不被套路、信任」，优先级冲突。',
    },
  ];
}

/**
 * 引导提案的反驳链（手写）。
 * 创意催化剂被连续驳回，cost 累到 3，立场软化并改写方案 ——
 * 这是 30 秒判据（I1）要看见的「第一次立场被驳并改写」。
 */
function demoRebuttals() {
  return [
    {
      id: 'R1',
      from: 'risk',
      to: 'creative',
      round: 1,
      content: '商店要求自动续费在开通前显著提示、可随时取消；未显著告知时，扣款争议和差评会反噬你要的转化（引用 C1/C2）。',
      cost: 1,
    },
    {
      id: 'R2',
      from: 'user',
      to: 'creative',
      round: 1,
      content: '扣款前若不提醒，「被自动扣款」的记忆会直接损伤信任；请给一键取消和扣款前提醒（引用 C3）。',
      cost: 2,
    },
    {
      id: 'R3',
      from: 'risk',
      to: 'creative',
      round: 2,
      content: '若默认自动扣款，商店可能直接驳回该订阅版本，上架受阻——这不是差评，是上不了架。',
      cost: 3,
    },
    {
      id: 'R4',
      from: 'creative',
      to: 'risk',
      round: 3,
      content: '接受并改写：开通前显著告知、到期前一天主动提醒、默认不自动扣款、需用户确认续费；保留试用，去掉「自动」。立场由支持改为有条件。',
      // 这是被驳方（creative）的回应陈述，to=risk 并未被驳回，故 cost=0，
      // 避免 drawRebuttal 误把 risk 标记为软化（真正软化的是 creative）。
      cost: 0,
    },
  ];
}

/** 引导提案的裁决（手写，conditional）。 */
function demoVerdict() {
  return {
    decision: 'conditional',
    reasons: [
      '「自动转付费」经反驳链改写为「显著告知 + 到期前提醒 + 确认制续费」，合规与信任风险收敛（引用 R1–R4）。',
      '支付与订阅链路保留，复用现有支付可控制成本（回应成本会计）。',
    ],
    residualRisks: [
      '仍有部分用户未注意显著提示，扣款争议无法完全消除（C1/C2 部分未收敛）。',
      '确认制会降低自动转化的转化率，需用数据验证。',
    ],
    overturnConditions: [
      '若数据假设变化（试用转化显著低于预期），重新审议。',
      '若范围扩大（叠加多个订阅档位），重新审议。',
      '若外部约束失效（商店审核规则变化），重新审议。',
    ],
    conflictsResolved: 2,
    conflictsTotal: 3,
  };
}

// ─────────────────────────────────────────────
// 通用提案（任意输入）：模板化生成，保证不崩
// ─────────────────────────────────────────────

/** 按类型给四视角一个默认立场倾向（规格 §3.2 的立场层）。 */
function genericOpinions(type, keywords) {
  const kw = keywords.length ? keywords.slice(0, 3).join('、') : '该方案';
  const byType = {
    tech: { risk: 'oppose', cost: 'conditional', creative: 'support', user: 'conditional' },
    business: { risk: 'oppose', cost: 'conditional', creative: 'support', user: 'oppose' },
    feature: { risk: 'conditional', cost: 'conditional', creative: 'support', user: 'support' },
    content: { risk: 'conditional', cost: 'conditional', creative: 'support', user: 'support' },
    unknown: { risk: 'conditional', cost: 'conditional', creative: 'conditional', user: 'conditional' },
  };
  const pos = byType[type] || byType.unknown;
  const make = (stanceId, judgment, qs) => ({
    stanceId,
    position: pos[stanceId],
    initialJudgment: judgment,
    questions: qs,
  });
  return {
    risk: make('risk', `围绕「${kw}」，需先确认最可能的失败方式与无人监控的环节。`, [
      `「${kw}」最可能怎么坏？`,
      '坏了谁会发现、谁来兜底？',
    ]),
    cost: make('cost', `「${kw}」要投入时间与复杂度，需估算维护债。`, [
      `做成「${kw}」要烧掉多少时间？`,
      '后续维护债占多少？',
    ]),
    creative: make('creative', `「${kw}」的差异点需要明确，避免与现有做法雷同。`, [
      `「${kw}」和现有东西的差异在哪？`,
      '用户为什么会觉得新鲜？',
    ]),
    user: make('user', `需明确谁在什么场景下因「${kw}」受益。`, [
      '谁会在什么场景下使用？',
      '不用它会损失什么？',
    ]),
  };
}

/** 通用冲突：在立场相反的视角间生成。 */
function genericConflicts(opinionMap) {
  const list = Object.values(opinionMap);
  const conflicts = [];
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (
        (a.position === 'support' && b.position === 'oppose') ||
        (a.position === 'oppose' && b.position === 'support')
      ) {
        conflicts.push({
          id: `C${conflicts.length + 1}`,
          pair: [a.stanceId, b.stanceId],
          type: 'polarity',
          desc: `${a.stanceId} 与 ${b.stanceId} 立场相反，且判断关键词重叠，需对质。`,
        });
      }
    }
  }
  if (conflicts.length === 0) {
    // 没有明显两极时，给一个优先级冲突，保证流程不空
    conflicts.push({
      id: 'C1',
      pair: ['risk', 'creative'],
      type: 'priority',
      desc: '风险与创意的第一优先级不同，需确认先保稳定还是先求差异。',
    });
  }
  return conflicts.slice(0, 3);
}

/** 通用反驳链：让后发言方被驳、再回应，制造一次改写。 */
function genericRebuttals(conflicts) {
  const c = conflicts[0];
  const [a, b] = c.pair;
  return [
    {
      id: 'R1',
      from: a,
      to: b,
      round: 1,
      content: `引用 ${c.id}：请先回应对立点，不能各说各话。`,
      cost: 1,
    },
    {
      id: 'R2',
      from: b,
      to: a,
      round: 2,
      content: '接受部分条件并改写：在保留核心意图的前提下，补上对方要求的约束，立场调整为有条件。',
      cost: 2,
    },
  ];
}

/** 通用裁决。 */
function genericVerdict(conflicts, rebuttals) {
  return {
    decision: 'conditional',
    reasons: ['对立点经一轮反驳后，以「补约束、有条件推进」收敛。'],
    residualRisks: ['通用模板未覆盖的具体风险，需结合真实场景再评估。'],
    overturnConditions: [
      '数据假设变化时重新审议。',
      '范围扩大时重新审议。',
      '外部约束失效时重新审议。',
    ],
    conflictsResolved: conflicts.length,
    conflictsTotal: conflicts.length,
  };
}

// ─────────────────────────────────────────────
// 事件装配与播放
// ─────────────────────────────────────────────

/** 计算一次运行的完整事件序列（同步，确定性）。 */
function computeEvents(runId, proposal, isDemo) {
  const events = [];
  events.push({ type: EVENTS.RUN_STARTED, runId, proposalHash: proposal.hash });
  events.push({ type: EVENTS.PROPOSAL_TYPED, typeName: proposal.type, keywords: proposal.keywords });

  const opinionMap = isDemo ? demoOpinions() : genericOpinions(proposal.type, proposal.keywords);
  const opinionList = STANCES.map((s) => opinionMap[s.id]);
  for (const opinion of opinionList) {
    events.push({ type: EVENTS.STANCE_OPINION, stanceId: opinion.stanceId, opinion });
  }

  const conflicts = isDemo ? demoConflicts() : genericConflicts(opinionMap);
  for (const conflict of conflicts) {
    events.push({ type: EVENTS.CONFLICT_DETECTED, conflict });
  }

  const rebuttals = isDemo ? demoRebuttals() : genericRebuttals(conflicts);
  for (const rebuttal of rebuttals) {
    events.push({ type: EVENTS.REBUTTAL, rebuttal });
  }

  events.push({ type: EVENTS.VERDICT_READY });
  const verdict = isDemo ? demoVerdict() : genericVerdict(conflicts, rebuttals);
  events.push({ type: EVENTS.VERDICT, verdict });
  return events;
}

/**
 * 每个事件相对前一个的播放延迟（ms），对齐规格 §2 时序约定：
 * stance_opinion 间隔 800–1500；rebuttal 间隔 1200；verdict_ready 停留 600。
 */
function delayFor(prev, curr) {
  switch (curr.type) {
    case EVENTS.RUN_STARTED:
      return 0;
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
  return {
    id: `p_${hash}`,
    title: p.title,
    body: p.body,
    type,
    keywords,
    hash,
  };
}

/**
 * 跑一次议会审议（mock）。
 * @param {{title?:string, body?:string}|string} proposal
 * @param {(e: object) => void} [onEvent] 流式回调，按规格时序触发
 * @returns {{ runId: string, events: object[], cancel: () => void, degraded: boolean }}
 */
export function runCouncil(proposal, onEvent) {
  const normalized = normalize(proposal);
  const runId = `run_${normalized.hash}_${Date.now().toString(36)}`;

  // 规格 §4 显式失败态：正文 < 10 字 或 0 命中
  const tooShort = (normalized.title + normalized.body).trim().length < 10;
  const noHit = normalized.keywords.length === 0;
  const degraded = tooShort || noHit;

  let events;
  if (degraded) {
    const reason = tooShort
      ? '提案太短，我看不出它想解决什么。请补一句它要解决的问题或目标。'
      : '没抓到与产品/业务/技术/内容相关的意图，我没把握。请补一句它属于哪类决策。';
    events = [
      { type: EVENTS.RUN_STARTED, runId, proposalHash: normalized.hash },
      { type: EVENTS.DEGRADED, reason, echo: { title: normalized.title, body: normalized.body } },
    ];
  } else {
    const isDemo =
      normalized.body === DEMO_PROPOSAL.body && normalized.title === DEMO_PROPOSAL.title;
    events = computeEvents(runId, normalized, isDemo);
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

export { STANCES };
export default { runCouncil, EVENTS, STANCES, DEMO_PROPOSAL };
