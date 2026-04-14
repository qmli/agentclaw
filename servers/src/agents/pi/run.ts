import { Agent } from "@mariozechner/pi-agent-core";
import type { AgentMessage as PiAgentMessage } from "@mariozechner/pi-agent-core";
import type {
  ChatMessage,
  GatewayConfig,
  LLMProvider,
  TokenUsage,
  WsChatRequest,
} from "../../gateway/types.js";
import { BUILT_IN_TOOL_NAMES } from "../../gateway/tool-executor.js";
import type { ToolExecutionContext } from "../../gateway/tool-executor.js";
import { buildModel } from "./model.js";
import { buildTools } from "./tools.js";

/** 流式块回调 */
export type OnChunk = (delta: string, model: string) => void;
/** 完成回调 */
export type OnDone = (usage?: TokenUsage) => void;
/** 错误回调 */
export type OnError = (code: string, message: string) => void;
/** 工具调用开始回调 */
export type OnToolStart = (
  toolName: string,
  args: Record<string, unknown>,
) => void;
/** 工具调用结束回调 */
export type OnToolEnd = (toolName: string, result: string) => void;

/**
 * 将 ChatMessage 转换为 pi AgentMessage。
 * - system 消息由 Agent.initialState.systemPrompt 承载，跳过
 * - tool   消息由 pi Agent 工具循环内部管理，跳过
 *
 * 重要：pi-ai 的 AssistantMessage.content 必须是 TextContent[] 数组，
 * 而 UserMessage.content 可以是 string 或数组。
 * ChatMessage.content 始终是字符串，需要按角色做不同处理。
 */
function toPiMessage(m: ChatMessage): PiAgentMessage | null {
  if (m.role === "system" || m.role === "tool") return null;

  if (m.role === "assistant") {
    // AssistantMessage.content 必须是 TextContent 数组
    return {
      role: "assistant",
      content: m.content ? [{ type: "text" as const, text: m.content }] : [],
      // pi-ai 的 AssistantMessage 还需要以下必填字段
      api: "openai-completions",
      provider: "unknown",
      model: "unknown",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    } as PiAgentMessage;
  }

  // user 消息：content 可以是字符串
  return {
    role: "user",
    content: m.content,
    timestamp: Date.now(),
  } as PiAgentMessage;
}

/**
 * 发起 Agent 对话请求（流式，含工具调用循环）。
 *
 * 内部使用 @mariozechner/pi-agent-core 的 Agent 驱动多轮工具调用，
 * 替代原先基于 openai SDK 的手动循环。
 *
 * @returns 调用后立即中止当前 agent 运行的函数
 */
export function runAgent(
  request: WsChatRequest,
  config: GatewayConfig,
  callbacks: {
    onChunk: OnChunk;
    onDone: OnDone;
    onError: OnError;
    onToolStart?: OnToolStart;
    onToolEnd?: OnToolEnd;
  },
  options: { toolNames?: string[] } = {},
): () => void {
  const { onChunk, onDone, onError, onToolStart, onToolEnd } = callbacks;

  const provider: LLMProvider = request.provider ?? config.defaultProvider;
  const providerCfg = config.providers[provider];
  const modelId = request.model ?? providerCfg?.defaultModel ?? "gpt-4o";

  const toolCtx: ToolExecutionContext = { workspaceDir: config.workspaceDir };
  const piModel = buildModel(provider, modelId, config);

  const toolNames = options.toolNames ?? [...BUILT_IN_TOOL_NAMES];
  const piTools = buildTools(toolNames, toolCtx);

  // system 消息合并为 systemPrompt
  const systemPrompt = request.messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");

  const agent = new Agent({
    initialState: {
      systemPrompt,
      model: piModel,
      tools: piTools,
    },
    getApiKey: (prov: string) => {
      const cfg = config.providers[prov as LLMProvider];
      return cfg?.apiKey;
    },
  });

  let modelSent = false;

  agent.subscribe((piEvent) => {
    switch (piEvent.type) {
      case "message_update": {
        const ae = piEvent.assistantMessageEvent;
        if (ae.type === "text_delta") {
          onChunk(ae.delta, modelSent ? "" : modelId);
          modelSent = true;
        }
        break;
      }
      case "tool_execution_start": {
        onToolStart?.(
          piEvent.toolName,
          piEvent.args as Record<string, unknown>,
        );
        break;
      }
      case "tool_execution_end": {
        const res = piEvent.result as
          | { content?: Array<{ text?: string }> }
          | undefined;
        onToolEnd?.(piEvent.toolName, res?.content?.[0]?.text ?? "");
        break;
      }
      case "agent_end": {
        // 检查 agent 是否因错误结束（如 API 鉴权失败、网络错误等）
        const messages = piEvent.messages;
        const lastAssistant = [...messages].reverse().find(
          (
            m,
          ): m is typeof m & {
            role: "assistant";
            stopReason: string;
            errorMessage?: string;
          } => m.role === "assistant",
        ) as { stopReason?: string; errorMessage?: string } | undefined;

        if (lastAssistant?.stopReason === "error") {
          const errMsg =
            lastAssistant.errorMessage || "Agent encountered an error";
          console.error(`[run] agent_end with error: ${errMsg}`);
          onError("AGENT_ERROR", errMsg);
        } else {
          onDone();
        }
        break;
      }
    }
  });

  // 分离历史消息与当前用户消息
  const nonSystem = request.messages.filter((m) => m.role !== "system");
  const lastMsg = nonSystem[nonSystem.length - 1];
  const history = nonSystem.slice(0, -1);

  if (history.length > 0) {
    agent.state.messages = history
      .map(toPiMessage)
      .filter((m): m is PiAgentMessage => m !== null);
  }

  // 启动 agent（后台运行）
  const promptText = lastMsg?.content ?? "";
  agent.prompt(promptText).catch((err: unknown) => {
    onError("RUNTIME_ERROR", err instanceof Error ? err.message : String(err));
  });

  return () => agent.abort();
}
