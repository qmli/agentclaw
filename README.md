# AgentClaw

> 基于 OpenClaw 协议的多模型 AI Agent 框架，支持 Skills 驱动的工具调用、WebSocket 流式网关与独立 CLI 运行时。

---

## 目录

1. [架构概览](#1-架构概览)
2. [快速开始](#2-快速开始)
3. [CLI 使用](#3-cli-使用)
4. [Agent Runtime API](#4-agent-runtime-api)
5. [Skills 系统](#5-skills-系统)
6. [内置工具](#6-内置工具)
7. [WebSocket 网关协议](#7-websocket-网关协议)
8. [目录结构](#8-目录结构)
9. [环境变量参考](#9-环境变量参考)
10. [开发指南](#10-开发指南)

---

## 1. 架构概览

```
┌──────────────────────────────────────────────────────┐
│                     用户界面层                         │
│   Web Chat UI (React)   │   CLI (openclaw run)        │
└────────────┬────────────┴──────────┬──────────────────┘
             │ WebSocket JSON               │ AgentRuntime.run()
             ▼                             ▼
┌──────────────────────────────────────────────────────┐
│               Gateway / Agent Runtime                  │
│  ws-server.ts  ←→  AgentRuntime  ←→  chatCompletion  │
│       ↓                  ↓                ↓           │
│  SkillSnapshot       SkillSnapshot    Tool Loop       │
└──────────────────────┬───────────────────┬────────────┘
                       │                   │
          ┌────────────▼──────┐   ┌────────▼──────────┐
          │   Skills 系统      │   │   内置工具执行层    │
          │  loader / filter  │   │  web_search        │
          │  snapshot / prompt│   │  web_fetch         │
          │  SKILL.md 扫描    │   │  read (本地文件)   │
          └───────────────────┘   └───────────────────-┘
                       │
          ┌────────────▼──────────────────────────────┐
          │              LLM 提供方                     │
          │  OpenAI (Responses API)                    │
          │  DeepSeek / Ollama / Custom (Chat API)     │
          └────────────────────────────────────────────┘
```

### 核心设计原则

- **技能文档驱动**：Skills 是 Markdown 文件（SKILL.md），而非代码插件，LLM 自主读取并执行
- **工具调用循环**：多轮 function calling，支持最多 10 次迭代
- **双运行模式**：WebSocket 网关（供 Web UI）+ 独立 AgentRuntime（供 CLI / 编程调用）
- **零侵入配置**：通过 `.env` 文件配置，无需修改代码

---

## 2. 快速开始

### 安装依赖

```bash
# 根目录（pnpm workspace）
pnpm install
```

### 配置环境变量

```bash
cp servers/.env.example servers/.env
# 编辑 servers/.env，填入至少一个 LLM 提供方的 API Key
```

### 启动开发服务器

```bash
# 同时启动 Web UI + WebSocket 网关
pnpm dev

# 仅启动网关
pnpm dev:server

# 仅启动 Web UI
pnpm dev:web
```

### 使用 CLI（无需 Web UI）

```bash
# 在 servers 目录下直接运行
cd servers
pnpm cli run "帮我搜索 TypeScript 5.0 的新特性"
```

---

## 3. CLI 使用

CLI 入口：`servers/src/cli/index.ts`，开发时通过 `pnpm cli <命令>` 运行，构建后通过 `openclaw` 全局命令使用。

### 3.1 `serve` — 启动网关

```bash
openclaw serve [--port <n>] [--workspace <dir>]
```

| 参数 | 默认值 | 说明 |
|------|--------|------|
| `--port` | `8080`（或 `GATEWAY_PORT`） | WebSocket 监听端口 |
| `--workspace` | 自动检测 | 工作区目录（用于加载 Skills） |

```bash
# 示例：在 9000 端口启动，工作区为 ~/myproject
openclaw serve --port 9000 --workspace ~/myproject
```

### 3.2 `run` — 单次 Agent 对话

```bash
openclaw run <message> [选项]
```

| 参数 | 说明 |
|------|------|
| `--provider` | LLM 提供方：`openai` / `deepseek` / `ollama` / `custom` |
| `--model` | 模型名称（如 `deepseek-chat`、`gpt-4o`、`llama3.2`） |
| `--workspace` | 工作区目录 |
| `--system` | 额外 system 提示（追加在 skills 段落之前） |

```bash
# 使用默认提供方
openclaw run "今天上海天气怎么样"

# 指定 DeepSeek + 特定模型
openclaw run "写一个快速排序" --provider deepseek --model deepseek-reasoner

# 使用本地 Ollama
openclaw run "解释一下什么是 RAG" --provider ollama --model llama3.2

# 注入额外系统提示
openclaw run "帮我检查这段代码" --system "你是一个专业的代码审查员，回复要简洁"
```

输出直接流式打印到 stdout，适合管道使用：

```bash
openclaw run "用 Python 写一个 hello world" > hello.py
```

### 3.3 `skills list` — 列出可用技能

```bash
openclaw skills list [--workspace <dir>]
```

输出示例：

```
[openclaw] 加载 skills，workspace: /home/user/myproject

── openclaw-workspace (2)
   • multi-search-engine          Integration of 17 search engines…  [invocable]
   • workspaceDir                 获取当前工作区目录…                  [invocable]

── openclaw-managed (1)
   • github                       GitHub API integration for issues…  [invocable]

共 3 个技能
```

### 3.4 构建后全局安装

```bash
cd servers
pnpm build
npm link   # 或 pnpm link --global
openclaw --help
```

---

## 4. Agent Runtime API

`AgentRuntime` 是无需 WebSocket 的独立运行时，可在任何 Node.js 代码中直接使用。

### 4.1 基础用法

```typescript
import { AgentRuntime } from "./servers/src/runtime/index.js";

const runtime = new AgentRuntime({
  providers: {
    deepseek: {
      apiKey: process.env.DEEPSEEK_API_KEY!,
      defaultModel: "deepseek-chat",
    },
  },
  defaultProvider: "deepseek",
  workspaceDir: process.cwd(), // 可选：启用 skills 注入
});

// 流式消费 AgentEvent
for await (const event of runtime.run("帮我搜索 Rust 异步编程")) {
  switch (event.type) {
    case "chunk":
      process.stdout.write(event.delta);
      break;
    case "done":
      console.log(`\n[完成] tokens: ${event.usage?.total_tokens}`);
      break;
    case "error":
      console.error(`[错误] ${event.code}: ${event.message}`);
      break;
  }
}
```

### 4.2 多轮对话

```typescript
import type { ChatMessage } from "./servers/src/gateway/types.js";

const history: ChatMessage[] = [];

async function chat(userInput: string): Promise<string> {
  history.push({ role: "user", content: userInput });

  let reply = "";
  for await (const event of runtime.run(history)) {
    if (event.type === "chunk") reply += event.delta;
  }

  history.push({ role: "assistant", content: reply });
  return reply;
}

await chat("你好，我叫小明");
await chat("你还记得我的名字吗？");
```

### 4.3 AgentEvent 类型

| 事件类型 | 字段 | 说明 |
|---------|------|------|
| `chunk` | `delta: string`, `model?: string` | 模型输出的文本片段，首包携带模型名 |
| `tool_start` | `toolName`, `args` | 工具调用开始（预留，当前由 chunk 提示） |
| `tool_end` | `toolName`, `result` | 工具调用结束（预留） |
| `done` | `usage?: TokenUsage` | 对话完成，携带 token 用量 |
| `error` | `code: string`, `message: string` | 发生错误 |

### 4.4 AgentRunOptions

```typescript
interface AgentRunOptions {
  provider?: "openai" | "deepseek" | "ollama" | "custom";
  model?: string;        // 覆盖 provider 默认模型
  temperature?: number;  // 0.0 ~ 2.0
  maxTokens?: number;    // 最大输出 token 数
  systemPrompt?: string; // 额外 system 提示（在 skills 段落之前注入）
}
```

---

## 5. Skills 系统

Skills 是**文档驱动**的扩展机制：每个 Skill 是一个包含 `SKILL.md` 文件的目录，LLM 自主读取并遵循其中的指令。

### 5.1 Skills 加载来源与优先级

| 优先级 | 来源标识 | 路径 | 说明 |
|--------|---------|------|------|
| 1（最低）| `openclaw-extra` | 配置 `extraDirs` | 配置文件指定的额外目录 |
| 2 | `openclaw-bundled` | `<项目根>/skills/` | 随项目内置的技能 |
| 3 | `openclaw-managed` | `~/.openclaw/skills/` | `openclaw skills install` 安装 |
| 4 | `agents-skills-personal` | `~/.agents/skills/` | 用户个人技能 |
| 5 | `agents-skills-project` | `<workspace>/.agents/skills/` | 项目级技能 |
| 6（最高）| `openclaw-workspace` | `<workspace>/skills/` | 工作区技能 |

同名技能**后加载的优先级更高**，会覆盖前面的版本。

### 5.2 SKILL.md 格式

```markdown
---
name: my-skill
description: 用一句话描述技能功能（出现在 available_skills 列表）
user-invocable: true          # 是否可用 /命令名 调用（默认 true）
disable-model-invocation: false  # 禁止模型主动调用（默认 false）

metadata:
  openclaw:
    always: false             # true = 始终加载，跳过环境检查
    os: [darwin, linux, win32]  # 限定操作系统
    requires:
      bins: [ffmpeg]          # 必须存在的可执行文件（全部）
      anyBins: [brew, apt]    # 任一存在即可
      env: [MY_API_KEY]       # 必须存在的环境变量
      tools: [web_fetch]      # 依赖的 gateway 工具
    primaryEnv: MY_API_KEY    # apiKey 配置时自动注入的环境变量名
---

## 使用场景

当用户需要… 时，使用本技能。

## 操作步骤

1. 调用 `web_fetch({ url: "..." })` 获取数据
2. 处理返回结果
3. 回复用户
```

### 5.3 模型调用技能的流程

```
模型收到含 <available_skills> 的 system prompt
    ↓
扫描技能名和描述，判断是否有匹配的技能
    ↓（匹配时）
调用 read({ path: "~/path/to/SKILL.md" })
    ↓
读取 SKILL.md 全文，按照其中的指令执行
    ↓
调用相关工具（web_fetch / web_search 等）
    ↓
整合结果，回复用户
```

### 5.4 openclaw.json 配置

在工作区根目录放置 `openclaw.json` 可控制技能加载行为：

```json
{
  "skills": {
    "allowBundled": ["github", "multi-search-engine"],
    "load": {
      "extraDirs": ["/path/to/extra/skills"]
    },
    "limits": {
      "maxSkillsInPrompt": 150,
      "maxSkillsPromptChars": 30000
    },
    "entries": {
      "my-skill": {
        "enabled": true,
        "apiKey": "sk-...",
        "env": { "EXTRA_VAR": "value" }
      }
    }
  }
}
```

---

## 6. 内置工具

Gateway 和 AgentRuntime 均提供以下内置工具，LLM 可通过 function calling 调用：

### `web_search`

```typescript
web_search({ query: "TypeScript 5.0 新特性 2024" })
```

- 中文查询 → **百度**（返回直接 URL）
- 英文/混合查询 → **Bing CN**（英文国际结果）
- 返回：标题、URL、摘要列表（最多 8 条）
- 无需 API Key，直接爬取公开搜索页面

### `web_fetch`

```typescript
web_fetch({ url: "https://example.com/article" })
```

- 抓取指定 URL 的完整文本内容
- 自动清洗 HTML（去除脚本/样式/广告）
- 内容超过 8,000 字符时自动截断
- 不支持需要登录的页面

### `read`

```typescript
read({ path: "~/path/to/SKILL.md" })
read({ path: "/absolute/path/to/file.txt" })
```

- 读取本地文件内容（支持 `~/` 展开）
- **安全限制**：只允许读取家目录（`~/`）或 `workspaceDir` 内的文件
- 文件超过 256 KB 时自动截断
- 可列出目录内容（当路径为目录时）
- **Skills 系统的核心工具**：LLM 通过此工具读取 SKILL.md

---

## 7. WebSocket 网关协议

网关默认监听 `ws://localhost:8080`。

### 客户端 → 服务端

**发起对话**

```json
{
  "type": "chat",
  "id": "req-001",
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "provider": "deepseek",
  "model": "deepseek-chat",
  "temperature": 0.7
}
```

**取消请求**

```json
{ "type": "cancel", "id": "req-001" }
```

**心跳**

```json
{ "type": "ping" }
```

### 服务端 → 客户端

| 消息类型 | 字段 | 说明 |
|---------|------|------|
| `chunk` | `id`, `delta`, `model?` | 流式文本片段，首包含模型名 |
| `done` | `id`, `usage?` | 对话完成，含 token 用量 |
| `error` | `id`, `code`, `message` | 错误信息 |
| `pong` | `ts` | 心跳响应，含服务器时间戳 |

---

## 8. 目录结构

```
agentclaw/
├── apps/
│   ├── web/                    # React 聊天 UI（Vite）
│   └── electron/               # Electron 壳（占位）
├── packages/
│   └── shared/                 # 共享类型包（占位）
├── servers/                    # Node.js 服务端（主包）
│   ├── index.ts                # 服务器入口（dotenv + createGateway）
│   ├── .env.example            # 环境变量示例
│   └── src/
│       ├── gateway/
│       │   ├── ws-server.ts    # WebSocket 网关（连接管理、消息路由）
│       │   ├── tool-executor.ts# 工具执行层（web_search / web_fetch / read）
│       │   └── types.ts        # 网关与协议类型定义
│       ├── runtime/            # ★ Agent Runtime（独立运行时）
│       │   ├── agent-runtime.ts# AgentRuntime 类（AsyncGenerator 流式接口）
│       │   ├── types.ts        # AgentEvent / AgentRunOptions 类型
│       │   └── index.ts        # 公共 API 导出
│       ├── cli/                # ★ CLI 入口
│       │   └── index.ts        # openclaw serve / run / skills list
│       └── agents/
│           ├── openais/        # LLM 调用层
│           │   ├── chat-completion.ts  # 流式调用 + 工具循环
│           │   ├── client.ts           # OpenAI 客户端工厂
│           │   ├── tool-map.ts         # LLM function calling 工具定义
│           │   ├── stream-utils.ts     # 流数据累积工具
│           │   └── constants.ts        # 模型常量
│           ├── skills/         # Skills 系统
│           │   ├── loader.ts   # 多来源加载、合并、frontmatter 解析
│           │   ├── filter.ts   # 运行时资格过滤（OS/bin/env/tools）
│           │   ├── snapshot.ts # 快照构建与版本管理
│           │   ├── prompt.ts   # system prompt 格式化与斜杠命令规格
│           │   ├── types.ts    # Skills 全量类型定义
│           │   └── index.ts    # 公共 API 导出
│           └── tools/          # 扩展工具（占位）
├── skills/                     # 内置技能包（openclaw-bundled 来源）
│   ├── multi-search-engine/    # 多搜索引擎技能
│   │   └── SKILL.md
│   └── workspaceDir/
│       └── SKILL.md
├── docs/
│   └── skills-architecture.md  # Skills 系统详细设计文档
├── extensions/                 # 插件目录（占位）
└── package.json                # 根 workspace 配置
```

> 标注 ★ 的目录为本次新增内容。

---

## 9. 环境变量参考

在 `servers/.env` 中配置（参考 `servers/.env.example`）：

### 网关配置

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `GATEWAY_PORT` | `8080` | WebSocket 监听端口 |
| `ALLOWED_ORIGINS` | `""（允许全部）` | 允许的前端来源，多个用逗号分隔 |
| `DEFAULT_PROVIDER` | `deepseek` | 默认 LLM 提供方 |
| `WORKSPACE_DIR` | 自动检测 | 工作区目录（用于加载 Skills） |

### LLM 提供方

| 变量 | 说明 |
|------|------|
| `DEEPSEEK_API_KEY` | DeepSeek API Key（必填以启用） |
| `DEEPSEEK_BASE_URL` | 默认 `https://api.deepseek.com/v1` |
| `DEEPSEEK_DEFAULT_MODEL` | 默认 `deepseek-chat` |
| `OPENAI_API_KEY` | OpenAI API Key |
| `OPENAI_BASE_URL` | 默认 OpenAI 官方地址 |
| `OPENAI_DEFAULT_MODEL` | 默认 `gpt-4o` |
| `OLLAMA_BASE_URL` | 默认 `http://localhost:11434/v1` |
| `OLLAMA_DEFAULT_MODEL` | 默认 `llama3.2` |
| `CUSTOM_API_KEY` | 自定义兼容服务 API Key |
| `CUSTOM_BASE_URL` | 自定义服务 Base URL |
| `CUSTOM_DEFAULT_MODEL` | 默认 `gpt-4o` |

### Skills 相关

| 变量 | 说明 |
|------|------|
| `OPENCLAW_BUNDLED_SKILLS_DIR` | 覆盖内置技能目录路径（开发调试用） |

---

## 10. 开发指南

### 脚本速查

```bash
# 根目录
pnpm dev              # 同时启动 web + server（热重载）
pnpm build            # 构建全部包
pnpm type-check       # TypeScript 类型检查

# servers/ 目录
pnpm dev              # tsx watch 热重载服务器
pnpm cli <命令>        # 直接运行 CLI（tsx，无需编译）
pnpm build            # tsc 编译到 dist/
pnpm start            # 运行编译后的服务器
```

### 新增工具

在 `servers/src/gateway/tool-executor.ts` 的三处同步更新：

```typescript
// 1. 加入 BUILT_IN_TOOL_NAMES
export const BUILT_IN_TOOL_NAMES = Object.freeze([
  "web_fetch", "web_search", "read",
  "my_new_tool",  // ← 新增
] as const);

// 2. 实现执行函数
export async function executeMyNewTool(args: Record<string, unknown>): Promise<string> {
  // ...
}

// 3. 在 executeTool 的 switch 中注册
case "my_new_tool":
  return executeMyNewTool(args);
```

在 `servers/src/agents/openais/tool-map.ts` 中同步注册 LLM 工具描述（`TOOL_MAP` 和 `RESPONSES_TOOL_MAP` 各一份）。

### 新增 Skill

在 `skills/` 目录（或 `~/.openclaw/skills/`）下创建子目录并添加 `SKILL.md`：

```bash
mkdir skills/my-skill
cat > skills/my-skill/SKILL.md << 'EOF'
---
name: my-skill
description: 用一句话描述技能功能
metadata:
  openclaw:
    requires:
      tools: [web_fetch]
---

## 使用场景

当用户需要… 时，使用本技能。

## 操作步骤

1. 调用 `web_fetch({ url: "..." })`
2. 处理结果并回复用户
EOF

# 验证技能是否被正确加载
pnpm cli skills list
```

### 调试

`servers/.vscode/launch.json` 中已配置 VS Code 调试器，直接按 F5 即可以断点调试模式启动服务器。

也可手动启动调试：

```bash
cd servers
pnpm debug   # tsx --inspect-brk index.ts
# 然后在 Chrome DevTools 或 VS Code 中附加到 Node.js 进程
```
