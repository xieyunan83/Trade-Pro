---
name: pptx-report
description: >-
  Trade-Pro 背调/开发 PPT 报告设计与导出规范。在修改 exportService、pptx 主题、
  背调报告下载、PptxGenJS 排版、文字超框、产品匹配页时必须使用。
---

# 背调 PPT 报告（产品链接客户）

蒸馏自公开 PPT Skills（vokako/pptx-generator、MiniMax pptx-generator、openai slides 思路），绑定本平台差异化：**产品分析 × 我方产品匹配**。

## 何时启用

- 改 `services/exportService.ts` / PPT 主题 / 背调「下载 PPT」
- 用户反馈 PPT 普通、超框、空段、决策人溢出
- 需要让报告体现「工贸一体工厂：产品链接客户」价值

## 硬规则

1. **空数据不进页**：`N/A` / `暂无` / `公开信息未找到` / 空数组 → 整块或整页省略。
2. **产品主轴优先**：封面 KPI → 客户产品画像 → 市场策略 → 官网品类 → 客户产品明细 → **推荐我方产品** → 其余。
3. **防超框**：所有进卡片的正文必须经 `clipText` / `fitLines`；禁止把 100+ 字原因塞进矮卡片。
4. **密度上限**（16:9 = 10×5.625"）:
   - 客户产品明细：**每页最多 2 张**大卡
   - 我方匹配：**每页最多 3 张**
   - 官网品类：**每页最多 6 张**
   - 决策人：**3×4=12 / 页**，多列卡片，禁止单表硬塞 20+ 行
5. **标题层级**：页标题 ≥20pt；卡片标题 13–14pt；正文 11–12pt；脚注 ≤10pt。正文不加粗。
6. **主题**：Trade Command（墨海军 + 信号青绿 + 琥珀金），暖纸色底。禁止默认蓝紫 AI 模板；禁止卡片顶部细彩条。
7. **左强调可有，顶彩条禁止**（AI 味标志）。
8. **前台文案**：不写供应商/模型名（千问、Hunter、Tavily 等）。
9. **不改其它业务功能**：只动 PPT 生成与本 skill；Excel/权限/背调流水线保持不变。

## 主题 token（与代码一致）

| Token | Hex | 用途 |
|-------|-----|------|
| ink | `0B1C24` | 页眉/封面 |
| signal | `0F766E` | 强调/标题色 |
| teal | `14B8A6` | 点缀 |
| gold | `C9A227` | 匹配分/高光 |
| paper | `F6F1E8` | 页底 |
| card | `FFFCF7` | 卡片 |
| muted | `5B6B73` | 次要文字 |
| line | `E7E0D4` | 边框 |

风格：**Sharp & Compact**（`rectRadius ≈ 0.04`）。

## 实现入口

- `services/pptxAnalysisSlides.ts`：幻灯片生成
- `services/exportService.ts`：导出 API（`exportToPPT` 等）调用上述模块

## QA

导出后人工抽查：产品明细、我方匹配两页是否出框；无数据页是否消失；决策人是否分页完整。
