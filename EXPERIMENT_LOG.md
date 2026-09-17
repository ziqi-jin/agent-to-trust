# EXPERIMENT LOG — Agent to Trust (A2T)

> 用途：记录每一次实验的 Hypothesis / Setup / Result / Interpretation / Reproducibility。

## 实验记录规范

每个实验必须至少生成：

```text
experiment.yaml     # 实验定义（objective/hypothesis/scope/metrics）
config.json         # 运行配置
seed.txt            # 随机种子
run.json            # 运行元数据（开始/结束/版本/env）
results.json        # 结果数据
report.md           # 结论
```

必须记录 provenance：

```text
code_version, experiment_version, score_model_version,
model_name/model_version, prompt_version, scenario_version,
random_seed, environment, source_type, simulation_or_real, timestamp
```

## 日志

<!-- 每次实验追加一条，格式如下：
### EXP-00X — 标题
- 日期：
- Hypothesis：
- Setup（agents/parameters/seed）：
- Result（metrics）：
- Interpretation：
- Reproducibility：
- Artifacts：
-->

_（暂无实验。Stage 1 完成后开始记录。）_
