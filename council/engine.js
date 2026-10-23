/**
 * 九人议会 · 规则引擎（骨架 v0.1 · 2026-10-23 晚机械类搭建）
 *
 * 规格宪法：agent-log/1024_PARLIAMENT_SPEC.md v1.0
 * 本文件当前只含：§1 数据结构（JSDoc）+ §2 事件常量 + runCouncil 签名。
 * §3 确定性规则（意图分类/透镜/冲突检测/反驳链/裁决）与 §4 degraded
 * 按 anyi2 红线纪律留到 10/26（周一）工作日实现——周末不写核心逻辑。
 *
 * @type {{ (proposal: Proposal, onEvent?: (e: RunEvent) => void): { runId: string, events: RunEvent[] } }}
 */

// ─────────────────────────────────────────────
// §1 数据结构（与规格 v1.0 §1 逐字对应，勿单方面改）
// ─────────────────────────────────────────────

/**
 * @typedef {'feature'|'business'|'tech'|'content'|'unknown'} ProposalType
 */

/**
 * @typedef {Object} Proposal
 * @property {string} id
 * @property {string} title   用户输入（可空）
 * @property {string} body    用户输入正文
 * @property {ProposalType} type  意图分类结果
 * @property {string[]} keywords   抽取关键词（≤8，去重）
 * @property {string} hash     title+body 简单 hash，用于 run_started
 */

/**
 * @typedef {'risk'|'cost'|'creative'|'user'} StanceId
 */

/**
 * @typedef {Object} Stance
 * @property {StanceId} id
 * @property {string} name  风险哨兵 / 成本会计 / 创意催化剂 / 用户代言
 * @property {string} lens  立场透镜一句话
 */

/**
 * @typedef {Object} Opinion
 * @property {StanceId} stanceId
 * @property {'support'|'oppose'|'conditional'} position
 * @property {string[]} questions     追问 1-3 条
 * @property {string} initialJudgment 初始判断一句话
 */

/**
 * @typedef {'polarity'|'resource'|'risk'|'priority'} ConflictType
 */

/**
 * @typedef {Object} Conflict
 * @property {string} id
 * @property {[StanceId, StanceId]} pair
 * @property {ConflictType} type
 * @property {string} desc  冲突描述（引用双方意见条目，不空泛）
 */

/**
 * @typedef {Object} Rebuttal
 * @property {string} id
 * @property {StanceId} from  反驳方
 * @property {StanceId} to    被驳方
 * @property {number} round   1-3
 * @property {string} content 反驳内容（引用冲突点 desc）
 * @property {number} cost    被驳方累计代价（cost≥3 立场软化）
 */

/**
 * @typedef {Object} Verdict
 * @property {'adopt'|'reject'|'conditional'} decision
 * @property {string[]} reasons           引用反驳链收敛结果
 * @property {string[]} residualRisks     未收敛冲突逐条
 * @property {string[]} overturnConditions 三条固定模板
 * @property {number} conflictsResolved
 * @property {number} conflictsTotal
 */

/**
 * @typedef {Object} RunEvent
 * 事件流（UI 唯一数据源，订阅式渲染）：
 *   run_started{runId, proposalHash} · proposal_typed{type, keywords}
 *   stance_opinion{stanceId, opinion} · conflict_detected{conflict}
 *   rebuttal{rebuttal} · verdict_ready{} · verdict{verdict} · degraded{reason}
 */

// ─────────────────────────────────────────────
// §2 事件名常量（UI 订阅用；改这里 = 改接口，须经 step-5 + Doubao 双认）
// ─────────────────────────────────────────────

export const EVENTS = {
  RUN_STARTED: 'run_started',
  PROPOSAL_TYPED: 'proposal_typed',
  STANCE_OPINION: 'stance_opinion',
  CONFLICT_DETECTED: 'conflict_detected',
  REBUTTAL: 'rebuttal',
  VERDICT_READY: 'verdict_ready',
  VERDICT: 'verdict',
  DEGRADED: 'degraded',
};

/** 四视角定义（规格 §3.2 的 id/name 层；lens 文案 10/26 随 demo-data 定稿） */
export const STANCES = [
  { id: 'risk', name: '风险哨兵' },
  { id: 'cost', name: '成本会计' },
  { id: 'creative', name: '创意催化剂' },
  { id: 'user', name: '用户代言' },
];

// ─────────────────────────────────────────────
// §3 主入口（签名定稿；实现 10/26 工作日补）
// ─────────────────────────────────────────────

/**
 * 跑一次议会审议。确定性：同一 proposal 两次运行，事件序列结论一致（E6）。
 * @param {Proposal} proposal
 * @param {(e: RunEvent) => void} [onEvent] 流式回调；不传则只返回全量 events
 * @returns {{ runId: string, events: RunEvent[] }}
 */
export function runCouncil(proposal, onEvent) {
  throw new Error('engine not implemented yet —— 规则实现排期 10/26（anyi2 红线纪律：周末不写核心逻辑）');
}

export default { runCouncil, EVENTS, STANCES };
