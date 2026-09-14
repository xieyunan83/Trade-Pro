# 版本回滚说明

改进批次开始前已备份当前稳定点（Mail Group 提交 `69ede06`）。

## 备份标识

| 类型 | 名称 |
|------|------|
| 分支 | `backup/pre-improvements-20260914` |
| 标签 | `backup-pre-improvements-20260914` |
| 提交 | `69ede06` |

远程已推送：https://github.com/xieyunan83/Trade-Pro

## 如何回到备份版本

### 仅查看 / 临时切换（不丢 main 历史）

```bash
git fetch origin
git checkout backup/pre-improvements-20260914
```

### 让本地 main 硬回到备份（会丢掉之后未推送的提交）

```bash
git fetch origin
git checkout main
git reset --hard backup-pre-improvements-20260914
# 若需同步远程 main（危险，需明确确认）：
# git push --force-with-lease origin main
```

### 用标签检出

```bash
git checkout backup-pre-improvements-20260914
```

## 建议

优先用分支/标签开新工作区对照；不要轻易对 `main` 做 force push。
