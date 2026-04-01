// ====== 消息协议类型 ======

/** 支持的 LLM 提供方 */
export type LLMProvider = "openai" | "deepseek" | "custom";

/** 聊天角色 */
export type ChatRole = "system" | "user" | "assistant" | "tool";

/** 单条聊天消息 */
export interface ChatMessage {
  role: ChatRole;
  content: string;
  name?: string;
}

/** Token 用量 */
export interface TokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

// ====== WebSocket 客户端 → 服务端 消息 ======

/** 发起聊天请求 */
export interface WsChatRequest {
  type: "chat";
  /** 请求唯一 ID，用于关联响应 */
  id: string;
  messages: ChatMessage[];
  /** 模型名称，如 deepseek-chat / gpt-4o */
  model?: string;
  /** 提供方，默认 openai */
  provider?: LLMProvider;
  /** 是否流式响应，默认 true */
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  /** 透传给 API 的额外参数 */
  extra?: Record<string, unknown>;
}

/** 取消正在进行的请求 */
export interface WsCancelRequest {
  type: "cancel";
  id: string;
}

export type WsClientMessage = WsChatRequest | WsCancelRequest;

// ====== 服务端 → WebSocket 客户端 消息 ======

/** 流式文本块 */
export interface WsChunkMessage {
  type: "chunk";
  id: string;
  delta: string;
  /** 模型名（首包携带） */
  model?: string;
}

/** 请求完成 */
export interface WsDoneMessage {
  type: "done";
  id: string;
  usage?: TokenUsage;
}

/** 错误 */
export interface WsErrorMessage {
  type: "error";
  id: string;
  code: string;
  message: string;
}

/** 心跳响应 */
export interface WsPongMessage {
  type: "pong";
  ts: number;
}

export type WsServerMessage =
  | WsChunkMessage
  | WsDoneMessage
  | WsErrorMessage
  | WsPongMessage;

// ====== LLM 提供方配置 ======

export interface ProviderConfig {
  /** API Key */
  apiKey: string;
  /** Base URL，默认使用官方地址 */
  baseUrl?: string;
  /** 默认模型 */
  defaultModel: string;
}

export interface GatewayConfig {
  /** WebSocket 监听端口 */
  port: number;
  /** 允许的来源（CORS），空数组表示允许全部 */
  allowedOrigins: string[];
  providers: {
    openai?: ProviderConfig;
    deepseek?: ProviderConfig;
    custom?: ProviderConfig;
  };
  /** 默认使用的提供方 */
  defaultProvider: LLMProvider;
  /** 工作区目录，用于加载 skills；未设置时跳过 skills 注入 */
  workspaceDir?: string;
}
