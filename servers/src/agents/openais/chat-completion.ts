import OpenAI from "openai";
import type {
  ChatMessage,
  GatewayConfig,
  LLMProvider,
  TokenUsage,
  WsChatRequest,
} from "../../gateway/types.js";
import { executeTool } from "../../gateway/tool-executor.js";
import type { ToolExecutionContext } from "../../gateway/tool-executor.js";
import { buildClient, ollamaSupportsTools } from "./client.js";
import { MAX_TOOL_ITERATIONS } from "./constants.js";
import { TOOL_MAP, RESPONSES_TOOL_MAP } from "./tool-map.js";
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
 * - OpenAI 提供方：使用 Responses API（client.responses.create）
 * - 其他提供方（Ollama / DeepSeek / Custom）：使用 Chat Completions API
 *
 * @returns AbortController，可用于取消请求
 */
export async function chatCompletion(
  request: WsChatRequest,
  config: GatewayConfig,
  callbacks: { onChunk: OnChunk; onDone: OnDone; onError: OnError },
  options: { toolNames?: string[] } = {},
): Promise<AbortController> {
  const provider: LLMProvider = request.provider ?? config.defaultProvider;

  if (provider === "openai") {
    return runResponsesAPI(request, config, callbacks, options);
  }
  return runChatCompletionsAPI(request, config, callbacks, options);
}

// ─────────────────────────────────────────────
// Responses API（OpenAI 原生）
// ─────────────────────────────────────────────

/**
 * 使用 OpenAI Responses API 处理请求。
 *
 * 流程：
 *   1. 将消息转换为 ResponseInputItem 数组，system 消息提取为 instructions
 *   2. 流式接收 response.output_text.delta 事件并推送给客户端
 *   3. 收集 response.output_item.done 事件中的 function_call 项
 *   4. 若有工具调用：执行工具 → 以 function_call_output 作为下一轮 input，
 *      并通过 previous_response_id 链接上下文，回到步骤 2
 *   5. 无工具调用时发送 done，结束
 */
async function runResponsesAPI(
  request: WsChatRequest,
  config: GatewayConfig,
  callbacks: { onChunk: OnChunk; onDone: OnDone; onError: OnError },
  options: { toolNames?: string[] },
): Promise<AbortController> {
  const toolCtx: ToolExecutionContext = { workspaceDir: config.workspaceDir };
  const { onChunk, onDone, onError } = callbacks;
  const ac = new AbortController();

  const providerCfg = config.providers.openai;
  if (!providerCfg) {
    onError("PROVIDER_NOT_CONFIGURED", 'Provider "openai" is not configured');
    return ac;
  }

  const model = request.model ?? providerCfg.defaultModel;
  const client = buildClient("openai", config);

  // system 消息 → instructions 参数；其余消息 → input 数组
  const systemMsg = request.messages.find((m) => m.role === "system");
  const instructions = systemMsg?.content;

  const initialInput: OpenAI.Responses.ResponseInputItem[] = request.messages
    .filter(
      (m): m is ChatMessage & { role: "user" | "assistant" } =>
        m.role === "user" || m.role === "assistant",
    )
    .map((m) => ({
      role: m.role,
      content: m.content,
    }));

  const toolsToUse: OpenAI.Responses.FunctionTool[] =
    options.toolNames === undefined
      ? Object.values(RESPONSES_TOOL_MAP)
      : options.toolNames
          .map((n) => RESPONSES_TOOL_MAP[n])
          .filter((t): t is OpenAI.Responses.FunctionTool => t !== undefined);

  let modelSent = false;
  const sendChunk = (delta: string) => {
    if (!delta) return;
    onChunk(delta, modelSent ? "" : model);
    modelSent = true;
  };

  try {
    let previousResponseId: string | undefined;
    let currentInput: OpenAI.Responses.ResponseInputItem[] = initialInput;

    for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
      if (ac.signal.aborted) break;

      const streamResp = await client.responses.create(
        {
          model,
          input: currentInput,
          ...(instructions ? { instructions } : {}),
          ...(previousResponseId
            ? { previous_response_id: previousResponseId }
            : {}),
          ...(toolsToUse.length > 0 ? { tools: toolsToUse } : {}),
          stream: true,
          temperature: request.temperature,
          max_output_tokens: request.max_tokens,
          ...(request.extra ?? {}),
        } satisfies OpenAI.Responses.ResponseCreateParamsStreaming,
        { signal: ac.signal },
      );

      const functionCalls: OpenAI.Responses.ResponseFunctionToolCall[] = [];

      for await (const event of streamResp) {
        if (ac.signal.aborted) break;

        if (event.type === "response.output_text.delta") {
          sendChunk(event.delta);
        } else if (event.type === "response.output_item.done") {
          if (event.item.type === "function_call") {
            functionCalls.push(event.item);
          }
        } else if (event.type === "response.completed") {
          previousResponseId = event.response.id;
        }
      }

      if (ac.signal.aborted) break;

      if (functionCalls.length === 0) {
        onDone();
        return ac;
      }

      const toolResults: OpenAI.Responses.ResponseInputItem[] = [];

      for (const fc of functionCalls) {
        if (ac.signal.aborted) break;

        const args = parseToolArgs(fc.arguments);

        if (fc.name === "web_fetch") {
          sendChunk(`\n> 正在获取: ${String(args["url"] ?? "")}\n\n`);
        } else if (fc.name === "web_search") {
          sendChunk(`\n> 正在搜索: ${String(args["query"] ?? "")}\n\n`);
        } else if (fc.name === "read") {
          sendChunk(`\n> 正在读取: ${String(args["path"] ?? "")}\n\n`);
        }

        const result = await executeTool(fc.name, args, toolCtx);

        toolResults.push({
          type: "function_call_output",
          call_id: fc.call_id,
          output: result,
        } satisfies OpenAI.Responses.ResponseInputItem.FunctionCallOutput);
      }

      currentInput = toolResults;
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
// ─────────────────────────────────────────────
// Chat Completions API（Ollama / DeepSeek / Custom）
// ─────────────────────────────────────────────

/**
 * 使用 Chat Completions API 处理请求（兼容 OpenAI 格式的第三方提供方）。
 *
 * 流程：
 *   1. 按 options.toolNames 从 TOOL_MAP 组装 tools 数组，发起 streaming 请求
 *   2. 同时流式推送 content delta，并在后台累积 tool_calls delta
 *   3. 若 finish_reason = 'tool_calls'：执行工具 → 追加 messages → 回到步骤 1
 *   4. 若 finish_reason = 'stop'：发送 done 通知，结束
 */
async function runChatCompletionsAPI(
  request: WsChatRequest,
  config: GatewayConfig,
  callbacks: { onChunk: OnChunk; onDone: OnDone; onError: OnError },
  options: { toolNames?: string[] },
): Promise<AbortController> {
  const toolCtx: ToolExecutionContext = { workspaceDir: config.workspaceDir };
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
        } else if (tc.name === "read") {
          sendChunk(`\n> 正在读取: ${String(args["path"] ?? "")}\n\n`);
        }

        const result = await executeTool(tc.name, args, toolCtx);

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
