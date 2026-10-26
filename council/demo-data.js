/**
 * 九人议会 · 数据层（词表 / 透镜 / 文案模板 · v1.0 · 2026-10-26 step-5）
 *
 * 与 engine.js（逻辑层）分离：改文案不动逻辑，改词表不动文案。
 * 透镜提问模板的槽位填词（Doubao 条件①"什么词最自然"）联调时与 Doubao 对。
 */

/** 规格 §3.1 意图分类词表（四类；计分命中，同分按本对象键序取先） */
export const TYPE_KEYWORDS = {
  feature: ['功能', '页面', '按钮', '工具', '体验', '流程', '交互', '入口', '弹窗', '试用', '上线', '改版', '新增'],
  business: ['商业', '变现', '市场', '付费', '增长', '客户', '营收', '转化', '会员', '订阅', '续费', '套餐', '定价', '促销'],
  tech: ['架构', '性能', '接口', '数据库', '部署', '安全', '缓存', '并发', '重构', '自动', '迁移', '监控', '告警', '脚本'],
  content: ['内容', '文案', '故事', '视频', '社区', '连载', '角色', '剧本', '资讯', '栏目', '专题'],
};

/** 风险增强词：命中则 risk 立场向 oppose 倾斜（合规/资金/信任类议案风险哨兵天然反对） */
export const RISK_EDGE_WORDS = ['风险', '安全', '合规', '支付', '扣款', '续费', '自动', '隐私', '数据', '审核', '上架'];

/** 增长类词：命中则 user 立场向 support 倾斜（用户价值明确的事用户代言天然支持） */
export const GROWTH_EDGE_WORDS = ['体验', '提升', '增长', '转化', '效率', '免费', '优惠', '简化'];

/**
 * 规格 §3.2 四视角立场透镜。
 * priority = 该视角的结构性第一优先级（用于 priority 型冲突判据，非硬凑）。
 * judgment / questions 为模板：{kw} 槽位由引擎填入提案关键词（≤3 个，顿号连接）。
 */
export const STANCE_LENSES = {
  risk: {
    name: '风险哨兵',
    priority: '稳定',
    judgment: '围绕「{kw}」，最需先确认它最可能的失败方式，以及坏了有没有人看着。',
    questions: ['「{kw}」最可能怎么坏？坏在哪一环？', '真出问题时，谁会发现、谁来兜底？'],
  },
  cost: {
    name: '成本会计',
    priority: '成本',
    judgment: '「{kw}」要烧掉时间与复杂度，还得算上长期维护债，先估账再动手。',
    questions: ['做成「{kw}」要烧掉多少时间？', '后续维护债（修复、适配、客服）占多少？'],
  },
  creative: {
    name: '创意催化剂',
    priority: '差异',
    judgment: '「{kw}」的差异点必须明确，否则只是又一个和现有做法雷同的东西。',
    questions: ['「{kw}」和现有做法的差异在哪？', '用户为什么会觉得它新鲜、愿意试？'],
  },
  user: {
    name: '用户代言',
    priority: '价值',
    judgment: '先讲清楚谁在什么场景下因「{kw}」受益，不讲场景的功能是自嗨。',
    questions: ['谁会在什么场景下打开「{kw}」？', '不用它，用户会损失什么？'],
  },
};

/**
 * 规格 §3.2 立场倾向表（按意图类型的先验 position）。
 * 微调规则在 engine.js：命中 RISK_EDGE_WORDS → risk 倾向 oppose；命中 GROWTH_EDGE_WORDS → user 倾向 support。
 */
export const POSITION_BY_TYPE = {
  tech: { risk: 'oppose', cost: 'conditional', creative: 'support', user: 'conditional' },
  business: { risk: 'oppose', cost: 'conditional', creative: 'support', user: 'oppose' },
  feature: { risk: 'conditional', cost: 'conditional', creative: 'support', user: 'support' },
  content: { risk: 'conditional', cost: 'conditional', creative: 'support', user: 'support' },
};

/** 规格 §3.5 推翻条件三模板（{kw} 槽位） */
export const OVERTURN_CONDITIONS = [
  '若数据假设变化（「{kw}」的收益/成本实测显著偏离预期），重新审议。',
  '若范围扩大（在「{kw}」之上叠加更多目标或档位），重新审议。',
  '若外部约束失效（平台规则、合规要求、依赖服务发生重大变化），重新审议。',
];

/** 反驳链文案模板（引擎按 round 选用；{conflict}/{challenger}/{edge}/{kw}/{fixes} 槽位） */
export const REBUTTAL_TEMPLATES = {
  /** round1 首驳：挑战方直指冲突点 */
  challenge: '引用 {conflict}：{challenger}要求先回应这一点——{edge}。不回应这一点，其余论证都先挂起。',
  /** round1 第二挑战方（存在第二个同向质疑者时） */
  challenge2: '引用 {conflict}：{challenger}补上同向质疑——{edge}。两方独立指向同一处，不是巧合。',
  /** round1 挑战方第二切面追驳（无第二挑战方时，保证链可达 cost=3） */
  followup: '引用 {conflict}：{challenger}再补一层——{edge2}。这不是重复上一轮，是同一处问题的第二个切面。',
  /** round2 升级：从风险描述升级为后果 */
  escalate: '引用 {conflict}：若此点不解决，后果不是「体验打折」，而是「{edge2}」——这是升级，不是重复。',
  /** round3 被驳方的改写陈述（软化后） */
  concede: '接受并改写：保留「{kw}」的核心意图，补上对方要求的约束（{fixes}），立场由支持改为有条件。',
};

/** 裁决文案模板 */
export const VERDICT_TEMPLATES = {
  reasonsResolved: '对立点（{conflicts}）经反驳链收敛为「补约束、有条件推进」，不是和稀泥的折中，是约束补上后的可执行版本。',
  reasonsClean: '四视角未检出实质性对立，「{kw}」可按现状推进，留意残余风险。',
  residualUnresolved: '（未收敛）{desc}',
  residualGeneric: '规则引擎未覆盖的具体场景风险，需结合「{kw}」的真实上下文再评估。',
};

/** 引导提案（「试一个」按钮；与 mock 同一份，跑同一套规则——不内置手写剧本） */
export const DEMO_PROPOSAL = {
  title: '给核心功能加 7 天 Pro 免费试用',
  body: '给核心功能加一个 7 天 Pro 会员免费试用，用户开通后可以体验全部高级功能，试用期结束后自动转为付费订阅，希望能提升付费转化。',
};
