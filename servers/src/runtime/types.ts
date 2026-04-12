import type { TokenUsage, LLMProvider } from "../gateway/types.js";

export type { TokenUsage, LLMProvider };

// ====== Agent 事件类型 ======

/** 模型输出的文本片段 */
export interface AgentChunkEvent {
  type: "chunk";
  delta: string;
  /** 首包携带模型名 */
  model?: string;
}

/** 工具调用开始 */
export interface AgentToolStartEvent {
  type: "tool_start";
  toolName: string;
  args: Record<string, unknown>;
}

/** 工具调用结束 */
export interface AgentToolEndEvent {
  type: "tool_end";
  toolName: string;
  result: string;
}

/** 本轮对话正常完成 */
export interface AgentDoneEvent {
  type: "done";
  usage?: TokenUsage;
}

/** 发生错误 */
export interface AgentErrorEvent {
  type: "error";
  code: string;
  message: string;
}

export type AgentEvent =
  | AgentChunkEvent
  | AgentToolStartEvent
  | AgentToolEndEvent
  | AgentDoneEvent
  | AgentErrorEvent;

// ====== 运行选项 ======

export interface AgentRunOptions {
  /** 使用的 LLM 提供方（默认继承 runtime 配置） */
  provider?: LLMProvider;
  /** 模型名称（默认继承 provider 默认模型） */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** 额外注入的 system 提示（追加在 skills 段落之前） */
  systemPrompt?: string;
}

// ====== Runtime 配置 ======

import type { GatewayConfig } from "../gateway/types.js";

/** AgentRuntime 构造配置（GatewayConfig 子集，可直接传入 GatewayConfig） */
export interface AgentRuntimeConfig {
  providers: GatewayConfig["providers"];
  defaultProvider: LLMProvider;
  /** 工作区目录，用于加载 skills 并作为 read 工具的安全根目录 */
  workspaceDir?: string;
}
