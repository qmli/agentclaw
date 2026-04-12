import OpenAI from "openai";
import type {
  ChatMessage,
  GatewayConfig,
  LLMProvider,
  TokenUsage,
  WsChatRequest,
} from "../../gateway/types.js";
import { executeTool } from "../../gateway/tool-executor.js";
import { buildClient, ollamaSupportsTools } from "./client.js";
import { MAX_TOOL_ITERATIONS } from "./constants.js";
import { TOOL_MAP } from "./tool-map.js";
import {
  accumulateToolCalls,
  extractContentDelta,
  parseToolArgs,
  type PendingToolCall,
} from "./stream-utils.js";

/** 流式块回调 */
export type OnChunk = (delta: string, model: string) => void;
/** 完成回调 */
export type OnDone = (usage?: TokenUsage) => void;
/** 错误回调 */
export type OnError = (code: string, message: string) => void;

/**
 * 发起聊天请求（流式优先，含 function calling 循环）。
 *
 * 流程：
 *   1. 按 options.toolNames 从 TOOL_MAP 组装 tools 数组，发起 streaming 请求
 *   2. 同时流式推送 content delta 给客户端，并在后台累积 tool_calls delta
 *   3. 若 finish_reason = 'tool_calls'：执行工具 → 追加 messages → 回到步骤 1
 *   4. 若 finish_reason = 'stop'：发送 done 通知，结束
 *
 * @param options.toolNames  本次请求需要启用的工具名列表（来自 SkillSnapshot.toolNames）。
 *   - 未提供：启用 TOOL_MAP 中全部工具（开发友好的 fallback）
 *   - 空数组：不启用任何工具（纯文本对话）
 *   - 非空数组：仅启用指定工具
 *
 * @returns AbortController，可用于取消请求
 */
export async function chatCompletion(
  request: WsChatRequest,
  config: GatewayConfig,
  callbacks: { onChunk: OnChunk; onDone: OnDone; onError: OnError },
  options: { toolNames?: string[] } = {},
): Promise<AbortController> {
  const { onChunk, onDone, onError } = callbacks;
  const ac = new AbortController();

  const provider: LLMProvider = request.provider ?? config.defaultProvider;
  const providerCfg = config.providers[provider];

  if (!providerCfg && provider !== "ollama") {
    onError(
      "PROVIDER_NOT_CONFIGURED",
      `Provider "${provider}" is not configured`,
    );
    return ac;
  }

  const defaultModel =
    provider === "ollama"
      ? (providerCfg?.defaultModel ?? "llama3.2")
      : (providerCfg?.defaultModel ?? "");
  const model = request.model ?? defaultModel;
  const client = buildClient(provider, config);

  let currentMessages: OpenAI.Chat.ChatCompletionMessageParam[] =
    request.messages.map((m: ChatMessage) => {
      const base = {
        role: m.role as OpenAI.Chat.ChatCompletionMessageParam["role"],
        content: m.content,
      };
      return (
        m.name ? { ...base, name: m.name } : base
      ) as OpenAI.Chat.ChatCompletionMessageParam;
    });

  const ollamaToolsBlocked =
    provider === "ollama" && !ollamaSupportsTools(model);

  const toolsToUse: OpenAI.Chat.ChatCompletionTool[] = ollamaToolsBlocked
    ? []
    : options.toolNames === undefined
      ? Object.values(TOOL_MAP)
      : options.toolNames
          .map((n) => TOOL_MAP[n])
          .filter((t): t is OpenAI.Chat.ChatCompletionTool => t !== undefined);

  let modelSent = false;
  const sendChunk = (delta: string) => {
    if (!delta) return;
    onChunk(delta, modelSent ? "" : model);
    modelSent = true;
  };

  try {
    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      if (ac.signal.aborted) break;

      const streamResp = await client.chat.completions.create(
        {
          model,
          messages: currentMessages,
          ...(toolsToUse.length > 0
            ? { tools: toolsToUse, tool_choice: "auto" as const }
            : {}),
          stream: true,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          ...(request.extra ?? {}),
        } satisfies OpenAI.Chat.ChatCompletionCreateParamsStreaming,
        { signal: ac.signal },
      );

      const pendingToolCalls = new Map<number, PendingToolCall>();
      let finishReason: string | null = null;

      for await (const chunk of streamResp) {
        if (ac.signal.aborted) break;

        const choice = chunk.choices[0];
        if (!choice) continue;

        finishReason = choice.finish_reason ?? finishReason;

        const delta = choice.delta;

        sendChunk(extractContentDelta(chunk));

        accumulateToolCalls(delta, pendingToolCalls);
      }

      if (ac.signal.aborted) break;

      if (finishReason !== "tool_calls" || pendingToolCalls.size === 0) {
        onDone();
        return ac;
      }

      const toolCallsOrdered = [...pendingToolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, v]) => v);

      const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        tool_calls: toolCallsOrdered.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.argsRaw },
        })),
      };
      currentMessages = [...currentMessages, assistantMsg];

      for (const tc of toolCallsOrdered) {
        if (ac.signal.aborted) break;

        const args = parseToolArgs(tc.argsRaw);

        if (tc.name === "web_fetch") {
          sendChunk(`\n> 正在获取: ${String(args["url"] ?? "")}\n\n`);
        } else if (tc.name === "web_search") {
          sendChunk(`\n> 正在搜索: ${String(args["query"] ?? "")}\n\n`);
        }

        const result = await executeTool(tc.name, args);

        const toolMsg: OpenAI.Chat.ChatCompletionToolMessageParam = {
          role: "tool",
          tool_call_id: tc.id,
          content: result,
        };
        currentMessages = [...currentMessages, toolMsg];
      }
    }

    if (!ac.signal.aborted) onDone();
  } catch (err: unknown) {
    if (ac.signal.aborted) return ac;

    if (err instanceof OpenAI.APIError) {
      onError(String(err.status ?? "API_ERROR"), err.message);
    } else {
      onError(
        "UNKNOWN_ERROR",
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return ac;
}
