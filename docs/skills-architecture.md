# OpenClaw Skills 架构详解

> 本文档深度解析 OpenClaw 的 **Skills（技能）系统**：从文件系统加载、过滤、注入 System Prompt，到大模型按需读取执行的完整链路。

---

## 目录

1. [架构概览](#1-架构概览)
2. [核心概念与类型定义](#2-核心概念与类型定义)
3. [技能文件格式（SKILL.md）](#3-技能文件格式skillmd)
4. [技能来源与优先级](#4-技能来源与优先级)
5. [加载管线（Loading Pipeline）](#5-加载管线loading-pipeline)
6. [过滤与资格判定](#6-过滤与资格判定)
7. [System Prompt 注入](#7-system-prompt-注入)
8. [大模型调用技能的完整流程](#8-大模型调用技能的完整流程)
9. [斜杠命令调用路径](#9-斜杠命令调用路径)
10. [快照版本管理](#10-快照版本管理)
11. [限额与安全机制](#11-限额与安全机制)
12. [配置参考](#12-配置参考)
13. [实例：multi-search-engine 技能](#13-实例multi-search-engine-技能)
14. [核心源码文件速查](#14-核心源码文件速查)

---

## 1. 架构概览

Skills 系统的核心设计理念：**技能是文档驱动的，而非 function-calling 驱动的**。

```
┌────────────────────────────────────────────────────────────┐
│                     技能来源（6 个优先级）                    │
│  Extra < Bundled < Managed < Personal < Project < Workspace │
└──────────────────────────┬─────────────────────────────────┘
                           │ loadSkillEntries()
                           ▼
┌────────────────────────────────────────────────────────────┐
│               过滤管线（Filter Pipeline）                    │
│  文件大小 → realpath安全 → 合并去重 → OS/env/bin过滤 → 限额  │
└──────────────────────────┬─────────────────────────────────┘
                           │ buildWorkspaceSkillSnapshot()
                           ▼
┌────────────────────────────────────────────────────────────┐
│                     SkillSnapshot                           │
│           prompt (格式化文本) + skills[] + version          │
└──────────────────────────┬─────────────────────────────────┘
                           │ buildSystemPrompt()
                           ▼
┌────────────────────────────────────────────────────────────┐
│               System Prompt 中的 Skills 段落                │
│   ## Skills (mandatory)                                     │
│   <available_skills>                                        │
│     <skill name="..." description="..." location="..." />   │
│   </available_skills>                                       │
└──────────────────────────┬─────────────────────────────────┘
                           │ 发送给大模型
                           ▼
           ┌───────────────┴───────────────┐
           │                               │
           ▼                               ▼
  普通对话（Prompt 驱动）          /斜杠命令（命令派发）
  模型扫描 → 选技能                resolveSkillCommandInvocation()
  → Read(SKILL.md)                    → dispatch:tool 或改写消息
  → 执行指令
```

---

## 2. 核心概念与类型定义

### 2.1 Skill（来自 @mariozechner/pi-coding-agent）

底层 `Skill` 对象由外部包提供，包含技能的基本信息：

```typescript
// 来自 @mariozechner/pi-coding-agent
type Skill = {
  name: string;         // 技能唯一标识名
  description: string;  // 技能描述（出现在 available_skills 列表）
  filePath: string;     // SKILL.md 文件绝对路径
  baseDir: string;      // 技能目录
  source: string;       // 来源标识（如 "openclaw-bundled"）
};
```

### 2.2 SkillEntry（OpenClaw 扩展）

`src/agents/skills/types.ts`

```typescript
type SkillEntry = {
  skill: Skill;                          // 底层 Skill 对象
  frontmatter: ParsedSkillFrontmatter;   // 解析后的 YAML frontmatter
  metadata?: OpenClawSkillMetadata;      // OpenClaw 专属元数据
  invocation?: SkillInvocationPolicy;    // 调用策略
};
```

### 2.3 OpenClawSkillMetadata

控制技能的运行时行为：

```typescript
type OpenClawSkillMetadata = {
  always?: boolean;      // true = 始终包含，跳过环境检查
  skillKey?: string;     // 配置文件 key（默认等于 name）
  primaryEnv?: string;   // 主环境变量名（配置 apiKey 时自动注入）
  emoji?: string;
  homepage?: string;
  os?: string[];         // 限定操作系统：["darwin", "linux", "win32"]
  requires?: {
    bins?: string[];     // 必须存在的可执行文件（ALL）
    anyBins?: string[];  // 任一存在即可（ANY）
    env?: string[];      // 必须存在的环境变量
    config?: string[];   // 必须为 truthy 的配置路径
  };
  install?: SkillInstallSpec[]; // 安装规范
};
```

### 2.4 SkillSnapshot

技能快照，存入 session，避免每次请求重新扫描文件系统：

```typescript
type SkillSnapshot = {
  prompt: string;     // 格式化后的 available_skills 文本，直接注入 system prompt
  skills: Array<{
    name: string;
    primaryEnv?: string;
    requiredEnv?: string[];
  }>;
  skillFilter?: string[];    // agent 级别的技能白名单过滤
  resolvedSkills?: Skill[];  // 完整 Skill 对象列表
  version?: number;          // 快照版本号（用于缓存失效）
};
```

### 2.5 SkillInvocationPolicy

控制技能的调用方式：

```typescript
type SkillInvocationPolicy = {
  userInvocable: boolean;         // 是否可通过 /命令名 调用（默认 true）
  disableModelInvocation: boolean; // 禁止模型主动调用（默认 false）
};
```

---

## 3. 技能文件格式（SKILL.md）

每个技能目录下必须有一个 `SKILL.md` 文件，由 YAML frontmatter 和 Markdown 正文组成。

### 3.1 完整 SKILL.md 格式

```yaml
---
name: my-skill                         # 必须：技能唯一名称
description: 用一句话描述技能功能        # 必须：出现在 available_skills 列表
user-invocable: true                   # 可选：是否可用 /命令名 调用（默认 true）
disable-model-invocation: false        # 可选：禁止模型主动调用（默认 false）

# 斜杠命令直接派发到 tool（可选）
command-dispatch: tool
command-tool: web_search               # 目标 AnyAgentTool.name
command-arg-mode: raw                  # 参数传递模式（raw = 不解析，直接传递）

metadata:
  openclaw:
    always: false                      # true = 始终包含，跳过 OS/env/bin 检查
    skillKey: my-skill-key             # 配置 key（不填则等于 name）
    primaryEnv: MY_API_KEY             # 主环境变量（apiKey 配置时自动注入）
    emoji: "🔍"
    homepage: https://example.com
    os: [darwin, linux]                # 仅在指定 OS 上启用
    requires:
      bins: [ffmpeg, jq]               # 必须全部存在的可执行文件
      anyBins: [brew, apt-get]         # 任一存在即可
      env: [MY_API_KEY]                # 必须存在的环境变量
      config: [browser.enabled]        # 必须为 truthy 的配置路径
      tools: [web_fetch]               # 依赖的 agent 工具（声明用，不做运行时检查）
    install:
      - kind: brew
        formula: ffmpeg
      - kind: node
        package: "@my/tool"
      - kind: go
        module: github.com/user/repo
      - kind: uv
        package: my-python-pkg
      - kind: download
        url: https://example.com/binary
        extract: true
        stripComponents: 1
        targetDir: ~/.local/bin
---

# 技能正文（模型读取此内容后执行）

## 使用场景

当用户需要 ... 时，使用本技能。

## 操作步骤

1. 首先检查 ...
2. 调用工具：`web_fetch({ url: "..." })`
3. 处理返回结果

## 注意事项

- Rate limit：单次写入不超过 X 条
- 优先使用大批量写入，避免逐条循环
```

### 3.2 install.kind 类型说明

| kind | 字段 | 说明 |
|------|------|------|
| `brew` | `formula` | Homebrew 包名（macOS） |
| `node` | `package` | npm 包名（`@scope/name` 或 `name@version`） |
| `go` | `module` | Go module 路径（含可选 `@version`） |
| `uv` | `package` | Python uv 包名 |
| `download` | `url`, `archive`, `extract`, `stripComponents`, `targetDir` | 直接下载二进制 |

---

## 4. 技能来源与优先级

技能从多个目录加载，**同名技能后加载的来源覆盖先加载的**（Map.set 策略）。

### 4.1 优先级顺序（从低到高）

| 优先级 | 来源标识 | 目录路径 | 说明 |
|--------|---------|---------|------|
| 1（最低）| `openclaw-extra` | `config.skills.load.extraDirs[]` | 配置文件指定的额外目录 |
| 1 | `openclaw-extra` | `extensions/*/skills` | 插件自带技能目录 |
| 2 | `openclaw-bundled` | `skills/`（包根目录） | 随包内置技能 |
| 3 | `openclaw-managed` | `~/.openclaw/skills` | `openclaw skills install` 安装的技能 |
| 4 | `agents-skills-personal` | `~/.agents/skills` | 用户个人技能 |
| 5 | `agents-skills-project` | `<workspace>/.agents/skills` | 项目级技能 |
| 6（最高）| `openclaw-workspace` | `<workspace>/skills` | 工作区技能（覆盖一切） |

### 4.2 合并逻辑（workspace.ts）

```typescript
const merged = new Map<string, Skill>();
// 优先级从低到高依次 set，同名技能后者覆盖
for (const skill of extraSkills)          merged.set(skill.name, skill);
for (const skill of bundledSkills)        merged.set(skill.name, skill);
for (const skill of managedSkills)        merged.set(skill.name, skill);
for (const skill of personalAgentsSkills) merged.set(skill.name, skill);
for (const skill of projectAgentsSkills)  merged.set(skill.name, skill);
for (const skill of workspaceSkills)      merged.set(skill.name, skill); // 最高优先级
```

### 4.3 嵌套根目录自动检测

`resolveNestedSkillsRoot()` 启发式检测：若 `dir/skills/*/SKILL.md` 存在，则自动将真正的根设为 `dir/skills/`。

```
workspace/
└── skills/           ← resolveNestedSkillsRoot() 识别此为真正根
    ├── github/
    │   └── SKILL.md
    └── my-skill/
        └── SKILL.md
```

### 4.4 环境变量覆盖

`OPENCLAW_BUNDLED_SKILLS_DIR` 环境变量可覆盖内置技能目录路径，方便开发测试。

---

## 5. 加载管线（Loading Pipeline）

`loadSkillEntries()` 是核心加载函数，内部流程：

```
① 目录扫描 (listChildDirectories)
   ↓
② 文件大小检查 (maxSkillFileBytes = 256KB)
   ↓
③ realpath 安全检查 (filterLoadedSkillsInsideRoot)
   防止符号链接逃出配置根目录
   ↓
④ loadSkillsFromDir (pi-coding-agent)
   读取 SKILL.md，构造 Skill 对象
   ↓
⑤ 来源合并 (Map<name, Skill>)
   按优先级顺序合并，同名覆盖
   ↓
⑥ frontmatter 解析 (parseFrontmatter + resolveOpenClawMetadata)
   YAML frontmatter → OpenClawSkillMetadata
   ↓
⑦ 调用策略解析 (resolveSkillInvocationPolicy)
   user-invocable, disable-model-invocation
   ↓
⑧ 输出 SkillEntry[]
```

### 5.1 数量限额（每个来源）

```typescript
const DEFAULT_MAX_CANDIDATES_PER_ROOT = 300;       // 每根目录最多扫描子目录数
const DEFAULT_MAX_SKILLS_LOADED_PER_SOURCE = 200;  // 每来源最多加载技能数
```

超出时按字母排序截断，并输出 warn 日志。

---

## 6. 过滤与资格判定

`filterSkillEntries()` 调用 `shouldIncludeSkill()` 对每个技能做资格判定。

### 6.1 判定逻辑（config.ts）

```typescript
function shouldIncludeSkill({ entry, config, eligibility }): boolean {
  const skillKey = resolveSkillKey(entry.skill, entry);
  const skillConfig = resolveSkillConfig(config, skillKey);

  // 1. 显式禁用
  if (skillConfig?.enabled === false) return false;

  // 2. bundled 白名单
  if (!isBundledSkillAllowed(entry, allowBundled)) return false;

  // 3. 运行时资格评估
  return evaluateRuntimeEligibility({
    os: entry.metadata?.os,                // OS 平台匹配
    always: entry.metadata?.always,        // true = 跳过后续检查
    requires: entry.metadata?.requires,    // bins / anyBins / env / config
    hasBin: hasBinary,                     // 本机 PATH 检查
    hasEnv: (envName) =>
      Boolean(
        process.env[envName] ||             // 系统环境变量
        skillConfig?.env?.[envName] ||      // 配置文件注入
        (skillConfig?.apiKey && entry.metadata?.primaryEnv === envName)
      ),
    isConfigPathTruthy: (path) => isConfigPathTruthy(config, path),
  });
}
```

### 6.2 调用策略过滤

在 `resolveWorkspaceSkillPromptState()` 中：

```typescript
// disableModelInvocation = true 的技能不注入 prompt（用户可以 /命令 调用，但模型不会主动选择）
const promptEntries = eligible.filter(
  (entry) => entry.invocation?.disableModelInvocation !== true
);
```

---

## 7. System Prompt 注入

### 7.1 调用链

```
resolveSkillsPromptForRun(params)
  → 若 skillsSnapshot.prompt 非空：直接返回快照 prompt
  → 否则：buildWorkspaceSkillsPrompt(workspaceDir, opts)
       → resolveWorkspaceSkillPromptState()
           → loadSkillEntries() + filterSkillEntries()
           → applySkillsPromptLimits()  // 数量/字符截断
           → compactSkillPaths()        // home → ~/ (节省 token)
           → formatSkillsForPrompt()    // 格式化为 XML-like 文本
```

### 7.2 buildSkillsSection()（system-prompt.ts）

```typescript
function buildSkillsSection({ skillsPrompt, readToolName }) {
  if (!skillsPrompt?.trim()) return [];
  return [
    "## Skills (mandatory)",
    "Before replying: scan <available_skills> <description> entries.",
    `- If exactly one skill clearly applies: read its SKILL.md at <location> with \`${readToolName}\`, then follow it.`,
    "- If multiple could apply: choose the most specific one, then read/follow it.",
    "- If none clearly apply: do not read any SKILL.md.",
    "Constraints: never read more than one skill up front; only read after selecting.",
    "- When a skill drives external API writes, assume rate limits: prefer fewer larger writes, ...",
    skillsPrompt,  // ← available_skills XML 列表
    "",
  ];
}
```

### 7.3 注入后的 System Prompt 格式（示例）

```
## Skills (mandatory)
Before replying: scan <available_skills> <description> entries.
- If exactly one skill clearly applies: read its SKILL.md at <location> with `read`, then follow it.
- If multiple could apply: choose the most specific one, then read/follow it.
- If none clearly apply: do not read any SKILL.md.
Constraints: never read more than one skill up front; only read after selecting.
- When a skill drives external API writes, assume rate limits: ...

<available_skills>
  <skill
    name="multi-search-engine"
    description="Integration of 17 search engines for web crawling without API keys."
    location="~/skills/multi-search-engine/SKILL.md"
  />
  <skill
    name="github"
    description="GitHub API integration for issues, PRs, and repositories."
    location="~/.openclaw/skills/github/SKILL.md"
  />
</available_skills>
```

### 7.4 路径压缩（Token 优化）

`compactSkillPaths()` 将绝对路径的家目录前缀替换为 `~/`，每条技能路径节省 5-6 个 token，100 个技能可节省约 500 token。

---

## 8. 大模型调用技能的完整流程

### 8.1 会话级快照构建

```
会话开始 / 新消息
    ↓
ensureSkillSnapshot(session, workspaceDir, config)
    ↓ 比对 session.skillsSnapshot.version 与当前版本
    ↓ 版本不一致时重建
buildWorkspaceSkillSnapshot(workspaceDir, opts)
    ↓
{ prompt, skills[], skillFilter, resolvedSkills, version }
    ↓ 写入 sessionEntry.skillsSnapshot
```

### 8.2 每次 Agent 回合

```
Step 1: resolveSkillsPromptForRun(params)
  → 从 skillsSnapshot.prompt 取格式化好的技能列表文本

Step 2: buildSystemPrompt(..., { skillsPrompt })
  → 将 ## Skills 段落嵌入完整 system prompt

Step 3: 向大模型发送 [system prompt + 对话历史]
```

### 8.3 模型侧执行逻辑

```
模型收到包含 <available_skills> 的 system prompt
    ↓
扫描 <available_skills> 中每个 skill 的 name 和 description
    ↓
根据用户消息语义判断是否有适合的技能
    ↓ 确定使用某个技能
tool_call: read({ path: "~/skills/multi-search-engine/SKILL.md" })
    ↓
读取 SKILL.md 全文，按照其中的指令执行任务
    ↓
tool_call: web_fetch({ url: "https://www.google.com/search?q=..." })
    ↓
处理结果，回复用户
```

### 8.4 关键约束（写入 System Prompt）

1. **每次最多读取一个 SKILL.md**：避免冗余 token 消耗
2. **先选择后读取**：不允许先读多个再比较
3. **没有匹配时不读取**：不滥用 Read 工具
4. **外部 API 写操作注意 rate limit**：倾向批量写入，避免 tight loop

---

## 9. 斜杠命令调用路径

### 9.1 命令规格构建

`buildWorkspaceSkillCommandSpecs()` 从 frontmatter 读取命令配置：

```typescript
// SKILL.md frontmatter 中：
// command-dispatch: tool
// command-tool: web_search
// command-arg-mode: raw

type SkillCommandSpec = {
  name: string;          // 斜杠命令名（sanitize 后的 skill.name）
  skillName: string;     // 原始技能名
  description: string;   // Discord 命令描述（≤100字符）
  dispatch?: {
    kind: "tool";
    toolName: string;    // AnyAgentTool.name
    argMode?: "raw";
  };
};
```

### 9.2 路径 A：dispatch → Tool 直接派发

```
用户输入 /search "python tutorial"
    ↓
resolveSkillCommandInvocation() 匹配 SkillCommandSpec
    ↓ dispatch.kind === "tool"
createOpenClawTools() 中查找 toolName 对应的 tool
    ↓
tool.execute({ command: "python tutorial" })
    ↓ 绕过 LLM，直接执行
返回结果给用户
```

适用场景：技能本质上是对某个工具的包装，参数简单，不需要模型推理。

### 9.3 路径 B：改写消息 → Agent 流程

```
用户输入 /github "create issue: fix login bug"
    ↓
resolveSkillCommandInvocation() 匹配 SkillCommandSpec
    ↓ 无 dispatch 配置
消息体改写为：「请使用 github skill 来：create issue: fix login bug」
    ↓ 进入正常 agent 对话流程
模型在 system prompt 中看到 github skill
    ↓
Read("~/.openclaw/skills/github/SKILL.md")
    ↓
按照 SKILL.md 指令执行 GitHub API 调用
```

适用场景：技能操作复杂，需要模型理解语义和多步推理。

---

## 10. 快照版本管理

### 10.1 版本刷新机制

```
refresh.ts — 文件系统 watcher
    ↓ 检测 skills/**/ SKILL.md 变化
getSkillsSnapshotVersion() 返回递增版本号
    ↓
ensureSkillSnapshot() 每次 agent 回合比对版本
    ↓ 版本不一致
重建 SkillSnapshot（重新扫描文件系统）
```

### 10.2 串行化锁

`serialize.ts` 中 `serializeByKey()` 确保同一 `workspaceDir` 的技能构建串行执行：

```typescript
// 防止多个 agent 回合同时重建同一工作区的 snapshot
await serializeByKey(workspaceDir, () => buildWorkspaceSkillSnapshot(...));
```

---

## 11. 限额与安全机制

### 11.1 默认限额参数

| 配置路径 | 默认值 | 说明 |
|---------|--------|------|
| `skills.limits.maxCandidatesPerRoot` | 300 | 每个来源目录最多扫描的子目录数 |
| `skills.limits.maxSkillsLoadedPerSource` | 200 | 每个来源最多加载的技能数 |
| `skills.limits.maxSkillsInPrompt` | 150 | 注入 system prompt 的最大技能数 |
| `skills.limits.maxSkillsPromptChars` | 30,000 | skills 段落最大字符数 |
| `skills.limits.maxSkillFileBytes` | 256,000 | 单个 SKILL.md 最大字节数（256 KB） |

### 11.2 字符预算截断算法

当技能列表格式化文本超过 `maxSkillsPromptChars` 时，使用**二分查找**找到能放入预算的最大技能前缀：

```typescript
// applySkillsPromptLimits() 核心逻辑
let lo = 0, hi = skillsForPrompt.length;
while (lo < hi) {
  const mid = Math.ceil((lo + hi) / 2);
  if (fits(skillsForPrompt.slice(0, mid))) lo = mid;
  else hi = mid - 1;
}
// 截断后输出警告：⚠️ Skills truncated: included X of Y
```

### 11.3 路径安全（防逃逸）

`filterLoadedSkillsInsideRoot()` 使用 `fs.realpathSync()` 解析真实路径后，通过 `isPathInside()` 验证 skill 的 `baseDir` 和 `filePath` 必须在配置根目录内部，防止符号链接攻击。

---

## 12. 配置参考

### 12.1 openclaw.json 配置结构

```json
{
  "skills": {
    "allowBundled": ["github", "multi-search-engine"],
    "load": {
      "extraDirs": ["/path/to/my/skills"]
    },
    "limits": {
      "maxCandidatesPerRoot": 300,
      "maxSkillsLoadedPerSource": 200,
      "maxSkillsInPrompt": 150,
      "maxSkillsPromptChars": 30000,
      "maxSkillFileBytes": 256000
    },
    "entries": {
      "my-skill": {
        "enabled": true,
        "apiKey": "sk-...",
        "env": {
          "MY_EXTRA_VAR": "value"
        }
      },
      "heavy-skill": {
        "enabled": false
      }
    }
  }
}
```

### 12.2 每个 entry 的配置字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `enabled` | `boolean` | `false` 显式禁用技能 |
| `apiKey` | `string` | 自动注入到 `primaryEnv` 指定的环境变量 |
| `env` | `Record<string, string>` | 注入技能运行时所需的额外环境变量 |

### 12.3 allowBundled 白名单

内置技能（`openclaw-bundled` 来源）受 `allowBundled` 白名单控制：

- 未配置 `allowBundled`：所有内置技能均可用（默认开放）
- 配置了 `allowBundled: [...]`：只有列表中的内置技能被加载
- 非内置来源的技能不受此限制

---

## 13. 实例：multi-search-engine 技能

### 13.1 目录结构

```
skills/
└── multi-search-engine/
    ├── SKILL.md            ← 核心技能文件
    ├── CHANGELOG.md
    └── references/
        ├── advanced-search.md
        └── international-search.md
```

### 13.2 SKILL.md frontmatter

```yaml
---
name: multi-search-engine
description: Integration of 17 search engines for web crawling without API keys.
  Includes domestic (Baidu, Bing, 360, Sogou, WeChat, Toutiao, Jisilu) and
  international (Google, DuckDuckGo, Yahoo, Startpage, Brave, Ecosia, Qwant,
  WolframAlpha) search engines.
metadata:
  {
    "openclaw": {
      "requires": { "tools": ["web_fetch"] },
      "examples": [...]
    }
  }
---
```

### 13.3 触发条件

- `requires.tools: ["web_fetch"]` — 声明依赖 `web_fetch` 工具
- **无 `os` 限制** — 在所有平台可用
- **无 `env` 要求** — 不需要 API Key（直接用 web_fetch 爬取公开搜索页面）

### 13.4 调用流程示例

```
用户：帮我搜索 Python 异步编程的最新教程

模型扫描 available_skills:
  - multi-search-engine: "17 search engines for web crawling..."  ← 匹配！

模型调用：
  read({ path: "~/skills/multi-search-engine/SKILL.md" })

读取到 SKILL.md 内容后：
  web_fetch({ url: "https://www.google.com/search?q=python+async+programming+tutorial" })

处理搜索结果，返回摘要给用户
```

---

## 14. 核心源码文件速查

| 文件 | 职责 |
|------|------|
| `src/agents/skills/workspace.ts` | 核心：加载、合并、过滤、构建 Snapshot、Prompt、斜杠命令规格 |
| `src/agents/skills/types.ts` | 类型定义：SkillEntry、SkillSnapshot、OpenClawSkillMetadata 等 |
| `src/agents/skills/frontmatter.ts` | YAML frontmatter 解析，resolveOpenClawMetadata |
| `src/agents/skills/config.ts` | shouldIncludeSkill() 资格判定，allowBundled 白名单 |
| `src/agents/skills/filter.ts` | 技能名过滤（normalizeSkillFilter） |
| `src/agents/skills/bundled-dir.ts` | resolveBundledSkillsDir()，内置技能目录解析 |
| `src/agents/skills/bundled-context.ts` | resolveBundledSkillsContext()，内置技能名称集合缓存 |
| `src/agents/skills/plugin-skills.ts` | resolvePluginSkillDirs()，从插件 manifest 解析技能目录 |
| `src/agents/skills/tools-dir.ts` | 技能工具安装根路径 |
| `src/agents/skills/serialize.ts` | serializeByKey()，快照构建串行化锁 |
| `src/agents/skills/refresh.ts` | 文件系统 watcher，快照版本递增 |
| `src/agents/skills/env-overrides.ts` | 按技能配置注入环境变量 |
| `src/agents/skills.ts` | 对外 re-export（loadWorkspaceSkillEntries 等） |
| `src/agents/system-prompt.ts` | buildSkillsSection()，Skills 段落嵌入 system prompt |
| `src/auto-reply/skill-commands.ts` | /斜杠命令 解析与调用策略 |
| `src/auto-reply/reply/session-updates.ts` | ensureSkillSnapshot()，session 级快照管理 |
| `src/config/types.skills.ts` | SkillsConfig / SkillsLoadConfig / SkillsLimitsConfig 类型 |
| `skills/` | 内置技能包（随包分发的 SKILL.md 集合） |
| `extensions/*/skills/` | 插件自带技能目录 |

---

## 附录：关键函数调用链

```
[ 会话开始 ]
└─ ensureSkillSnapshot(session, workspaceDir, config)
   └─ buildWorkspaceSkillSnapshot(workspaceDir, opts)
      └─ resolveWorkspaceSkillPromptState(workspaceDir, opts)
         ├─ loadSkillEntries(workspaceDir, opts)
         │  ├─ loadSkillsFromDir (pi-coding-agent) × 6 sources
         │  ├─ filterLoadedSkillsInsideRoot()
         │  ├─ Map<name,Skill> 合并
         │  └─ parseFrontmatter + resolveOpenClawMetadata
         ├─ filterSkillEntries()
         │  └─ shouldIncludeSkill() × N
         ├─ applySkillsPromptLimits() (二分截断)
         ├─ compactSkillPaths() (token 压缩)
         └─ formatSkillsForPrompt() → prompt string

[ 每次 Agent 回合 ]
└─ resolveSkillsPromptForRun({ skillsSnapshot, workspaceDir })
   └─ 返回 snapshot.prompt（或重建）
      └─ buildSystemPrompt(..., { skillsPrompt })
         └─ buildSkillsSection({ skillsPrompt, readToolName })
            → "## Skills (mandatory)\n<available_skills>..."

[ 用户发送 /命令 ]
└─ resolveSkillCommandInvocation(commandName, args)
   ├─ [有 dispatch.tool] → createOpenClawTools().find(toolName).execute(args)
   └─ [无 dispatch]      → 改写消息体 → 正常 agent 流程
```
