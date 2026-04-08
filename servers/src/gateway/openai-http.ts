import OpenAI from "openai";
import type {
  ChatMessage,
  GatewayConfig,
  LLMProvider,
  TokenUsage,
  WsChatRequest,
} from "./types.ts";
import { executeTool } from "./tool-executor.js";

/** 流式块回调 */
export type OnChunk = (delta: string, model: string) => void;
/** 完成回调 */
export type OnDone = (usage?: TokenUsage) => void;
/** 错误回调 */
export type OnError = (code: string, message: string) => void;

/** DeepSeek 官方 API Base URL */
const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

/** 最多连续调用工具的轮次，防止无限循环 */
const MAX_TOOL_ITERATIONS = 10;

// ====== 内置工具定义（TOOL_MAP：名称 → LLM function 定义）======
//
// 新增工具时：
//   1. 在此 map 里注册 LLM function 定义
//   2. 在 tool-executor.ts 的 executeTool() 中实现执行逻辑
//   3. 把名称加入 tool-executor.ts 的 BUILT_IN_TOOL_NAMES
//
const TOOL_MAP: Record<string, OpenAI.Chat.ChatCompletionTool> = {
  /**
   * 搜索工具（优先使用）：后端使用 DuckDuckGo Lite，无需 API Key，
   * 不会被 CAPTCHA 拦截，返回结构化的标题 + URL + 摘要列表。
   */
  web_search: {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web and return a structured list of results (title, URL, snippet). " +
        "Uses DuckDuckGo — works without API keys and is not blocked by CAPTCHAs. " +
        "ALWAYS prefer this over web_fetch for finding current information or news. " +
        "After getting results, use web_fetch to read specific articles if needed.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The search query. Include date context for time-sensitive queries (e.g. '伊朗新闻 2024-04').",
          },
        },
        required: ["query"],
      },
    },
  },

  /**
   * 页面抓取工具：适合读取特定文章/新闻页面的完整内容。
   * 部分网站会拒绝服务端爬取（返回 403），此时请改用 web_search。
   */
  web_fetch: {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch the full text content of a specific URL (article, news page, etc.). " +
        "Use this AFTER web_search to read an article in depth. " +
        "Do NOT use this to search — use web_search instead. " +
        "Some sites block server-side requests; if you get a 403 error, skip that URL.",
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Fully-qualified http/https URL to fetch.",
          },
        },
        required: ["url"],
      },
    },
  },
} as const;

// ====== 辅助函数 ======

/** 根据提供方配置构建 OpenAI 兼容客户端 */
function buildClient(provider: LLMProvider, config: GatewayConfig): OpenAI {
  const providerCfg = config.providers[provider];
  if (!providerCfg) {
    throw new Error(`Provider "${provider}" is not configured`);
  }

  const baseURL =
    providerCfg.baseUrl ??
    (provider === "deepseek" ? DEEPSEEK_BASE_URL : undefined);

  return new OpenAI({ apiKey: providerCfg.apiKey, baseURL });
}

/** 解析流式 chunk 中的 content delta */
function extractContentDelta(chunk: OpenAI.Chat.ChatCompletionChunk): string {
  return chunk.choices[0]?.delta?.content ?? "";
}

/** 安全解析工具调用参数 */
function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

// ====== 累积工具调用结构 ======

interface PendingToolCall {
  id: string;
  name: string;
  argsRaw: string;
}

/**
 * 从 streaming chunk 的 delta.tool_calls 中累积工具调用数据。
 * 返回 true 表示有更新（方便调试）。
 */
function accumulateToolCalls(
  delta: OpenAI.Chat.ChatCompletionChunk.Choice.Delta,
  pending: Map<number, PendingToolCall>,
): boolean {
  if (!delta.tool_calls?.length) return false;
  for (const tc of delta.tool_calls) {
    const entry = pending.get(tc.index) ?? { id: "", name: "", argsRaw: "" };
    if (tc.id) entry.id = tc.id;
    if (tc.function?.name) entry.name += tc.function.name;
    if (tc.function?.arguments) entry.argsRaw += tc.function.arguments;
    pending.set(tc.index, entry);
  }
  return true;
}

// ====== 核心聊天函数 ======

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

  if (!providerCfg) {
    onError(
      "PROVIDER_NOT_CONFIGURED",
      `Provider "${provider}" is not configured`,
    );
    return ac;
  }

  const model = request.model ?? providerCfg.defaultModel;
  const client = buildClient(provider, config);

  // 构建初始消息列表（类型安全转换）
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

  // 根据 options.toolNames 动态选取 LLM function 定义：
  //   - undefined  → 启用全部内置工具（开发 fallback）
  //   - []         → 不启用工具（纯文本）
  //   - [...names] → 仅启用指定工具
  const toolsToUse: OpenAI.Chat.ChatCompletionTool[] =
    options.toolNames === undefined
      ? Object.values(TOOL_MAP)
      : options.toolNames
          .map((n) => TOOL_MAP[n])
          .filter((t): t is OpenAI.Chat.ChatCompletionTool => t !== undefined);

  // 首次 onChunk 时携带模型名
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

      // 累积本轮的工具调用 delta
      const pendingToolCalls = new Map<number, PendingToolCall>();
      let finishReason: string | null = null;

      for await (const chunk of streamResp) {
        if (ac.signal.aborted) break;

        const choice = chunk.choices[0];
        if (!choice) continue;

        finishReason = choice.finish_reason ?? finishReason;

        const delta = choice.delta;

        // 实时推送 content 给客户端
        sendChunk(extractContentDelta(chunk));

        // 后台累积工具调用参数
        accumulateToolCalls(delta, pendingToolCalls);
      }

      if (ac.signal.aborted) break;

      // ── 无工具调用：正常结束 ──
      if (finishReason !== "tool_calls" || pendingToolCalls.size === 0) {
        onDone();
        return ac;
      }

      // ── 有工具调用：执行后继续循环 ──
      // （toolsToUse 非空时才会走到这里）

      // 按 index 排序，确保顺序一致
      const toolCallsOrdered = [...pendingToolCalls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, v]) => v);

      // 将助手的工具调用消息追加到历史
      const assistantMsg: OpenAI.Chat.ChatCompletionAssistantMessageParam = {
        role: "assistant",
        tool_calls: toolCallsOrdered.map((tc) => ({
          id: tc.id,
          type: "function" as const,
          function: { name: tc.name, arguments: tc.argsRaw },
        })),
      };
      currentMessages = [...currentMessages, assistantMsg];

      // 逐个执行工具，将结果追加为 tool 消息
      for (const tc of toolCallsOrdered) {
        if (ac.signal.aborted) break;

        const args = parseToolArgs(tc.argsRaw);

        // 向客户端发送工具执行状态提示
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

      // 进入下一轮，让模型基于工具结果继续生成
    }

    // 超过最大迭代次数时，兜底完成
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
