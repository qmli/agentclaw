---
name: workspaceDir
description: 获取当前工作区目录，并定位工作区 skills 目录。
---

## 你能做什么

- 你可以使用“工作区目录（workspaceDir）”来理解用户项目的根目录位置。
- 你可以将“工作区 skills 目录”视为项目技能库根目录：`<workspaceDir>/skills`。

## 如何使用

1. 当用户要求“读取 skills 目录/列出有哪些 skills/检查某个 skill 是否存在”时，先确定工作区目录 `workspaceDir`。
2. 目标 skills 根目录通常是：
   - `<workspaceDir>/skills`（最常见）
   - 如果 `<workspaceDir>/skills` 不存在，则回退为 `<workspaceDir>`（某些项目会直接把 skill 文件夹放在根目录）

## 约束

- 不要猜测 skills 的绝对路径；应以 `workspaceDir` 为基准计算。
- 如果需要列出目录内容，使用合适的“列目录/搜索文件”能力，而不是凭空编造。

