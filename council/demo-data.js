/**
 * 九人议会 · demo 数据（骨架 v0.1 · 2026-10-23 晚机械类搭建）
 *
 * 定位（规格 §3.2 注）：demo 数据只作首屏引导——引擎必须对任意提案有效（Doubao 条件 2）。
 * 提案文案与视角透镜的具体措辞属脑力产出，按 anyi2 红线纪律留到 10/26 工作日。
 */

/** 预置引导提案（首屏"试一个"按钮用；评委多数会输入自己的提案） */
export const DEMO_PROPOSAL = null; // TODO 10/26: { id, title, body, type, keywords, hash }

/**
 * 四视角立场透镜（规格 §3.2 的提问模板层）。
 * TODO 10/26: 填 lens 文案 + 每视角的 questions 模板槽位（Doubao 已认条件①：
 * 透镜提问模板的槽位填什么词最自然，联调前与他对一遍）。
 * @type {Array<{id: string, name: string, lens: string}>}
 */
export const STANCE_LENSES = [
  { id: 'risk', name: '风险哨兵', lens: null },
  { id: 'cost', name: '成本会计', lens: null },
  { id: 'creative', name: '创意催化剂', lens: null },
  { id: 'user', name: '用户代言', lens: null },
];

/** 裁决文案库（reasons / residualRisks / overturnConditions 的措辞层） */
export const VERDICT_COPY = null; // TODO 10/26

/** 意图分类词表（规格 §3.1 四类代表词；10/26 实现时扩充并配计分） */
export const TYPE_KEYWORDS = {
  feature: null,
  business: null,
  tech: null,
  content: null,
};
