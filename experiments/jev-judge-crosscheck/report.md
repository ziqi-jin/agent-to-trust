# Jev Judge Cross-Check — 实验报告

> 模型：`jev-latest` · 生成时间：2026-09-22T02:27:59.930Z · 样本组：34

> 红线：这是「可复现的标定实验」，不是科学基准；样本为构造法（金标签由构造决定）。

## 总览

| 判官 | 准确率 | 正确/可用 | 错误 | 平均延迟(ms) | 输入token | 估算成本(USD) |
|------|--------|-----------|------|--------------|-----------|----------------|
| deterministic | 70.6% | 24/34 | 0 | 0 | 0 | 0 |
| jev | 76.5% | 26/34 | 0 | 811 | 13655 | 0.000574 |
| llm | 67.6% | 23/34 | 0 | 647 | 2841 | 0.000119 |

## 混淆矩阵（行=金标签，列=预测）

### deterministic

| 金标签 \ 预测 | success | partial | failure |
|---|---|---|---|
| success | 10 | 0 | 0 |
| partial | 8 | 0 | 2 |
| failure | 0 | 0 | 14 |

### jev

| 金标签 \ 预测 | success | partial | failure |
|---|---|---|---|
| success | 10 | 0 | 0 |
| partial | 4 | 5 | 1 |
| failure | 2 | 1 | 11 |

### llm

| 金标签 \ 预测 | success | partial | failure |
|---|---|---|---|
| success | 10 | 0 | 0 |
| partial | 10 | 0 | 0 |
| failure | 1 | 0 | 13 |

## 复现

```bash
TYPESAFE_API_KEY=... DEEPSEEK_API_KEY=... npm run jev:crosscheck --workspace @a2t/jev -- --live
```
