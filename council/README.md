# 九人议会 · council/ 模块地图

> 主作品「九人议会 · 多视角审议台」代码区。与 `bisect/`（BISECT 副品）平级，`deploy.mjs` 一次推两个页面。
> 线上：`https://anyi2686.github.io/1024-council/`（占位页 v3 已上线；议会本体联调后替换/挂载）。
> 规格宪法：`C:\Users\anyi2\.workbuddy\agent-log\1024_PARLIAMENT_SPEC.md`（v1.0，改规则走流水账 @step-5，别静默改接口）。
> 验收标准：`ACCEPTANCE_1024.md` E1–E6（引擎）+ I1–I5（UI）+ D1–D4（部署）。

## 分工

| 文件 | 内容 | 负责人 | 状态 |
| --- | --- | --- | --- |
| `engine.js` | 规则引擎：意图分类 / 视角透镜 / 冲突检测 / 反驳链 / 加权裁决 / degraded | step-5 | 🟡 骨架就位（2026-10-23 晚，机械类），规则实现 10/26 开工 |
| `demo-data.js` | 预置引导提案 + 视角人设文案 + 裁决文案库 | step-5 | 🟡 视角 id/name 就位，提案文案 10/26 |
| `index.html` | UI：五渲染位（环形图 / 反驳弧线 / HUD / 降级卡 / 报告卡）+ 输入 | Doubao | ⏸️ 待 Doubao 开工（规格 §5 对接约定 + 小Q I1/I3 判据） |
| `style.css` | 暗色终端风（沿用占位页配色变量） | Doubao | ⏸️ 同上 |

## 接口（engine.js → UI）

```js
import { runCouncil } from './engine.js';
// 返回 { runId, events: RunEvent[] }；UI 按 events 顺序订阅渲染
// 事件流：run_started → proposal_typed → stance_opinion×4 → conflict_detected×N
//         → rebuttal×N → verdict_ready → verdict（或 degraded{reason}）
```

纯 ES module、无依赖、无网络、无构建——GitHub Pages 直接跑。

## 时间线（anyi2 拍板：守红线修正版）

- 10/26（一）–10/28（三）：引擎规则实现（step-5）；Doubao UI 并行（10/26 起）
- 10/29（四）–10/30（五）：联调 + 部署 + 三视角验收 + **10/30 MVS 检查点**（未达任一条自动降级方案 C）
- 10/31（六）：投稿上墙（机械类）
- 11/1（日）：截稿日，不安排——作品 10/31 定稿

## 红线纪律（anyi2 定，10/23 确认）

周日＝休息日，不排任务；周末只搭骨架/机械类，不写核心逻辑。本目录 10/23 晚的骨架提交即此纪律的产物。
