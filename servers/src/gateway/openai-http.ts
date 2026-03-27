import OpenAI from 'openai';
import type {
  ChatMessage,
  GatewayConfig,
  LLMProvider,
  TokenUsage,
  WsChatRequest,
} from './types.js';

/** 流式块回调 */
export type OnChunk = (delta: string, model: string) => void;
/** 完成回调 */
export type OnDone = (usage?: TokenUsage) => void;
/** 错误回调 */
export type OnError = (code: string, message: string) => void;

/** DeepSeek 官方 API Base URL */
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com/v1';

/** 根据提供方配置构建 OpenAI 兼容客户端 */
function buildClient(provider: LLMProvider, config: GatewayConfig): OpenAI {
  const providerCfg = config.providers[provider];
  if (!providerCfg) {
    throw new Error(`Provider "${provider}" is not configured`);
  }

  const baseURL =
    providerCfg.baseUrl ??
    (provider === 'deepseek' ? DEEPSEEK_BASE_URL : undefined);

  return new OpenAI({
    apiKey: providerCfg.apiKey,
    baseURL,
  });
}

/** 解析流式 chunk 中的 delta 文本 */
function extractDelta(chunk: OpenAI.Chat.ChatCompletionChunk): string {
  return chunk.choices[0]?.delta?.content ?? '';
}

/**
 * 发起聊天请求（支持流式 / 非流式）。
 * 通过回调将结果推送给调用方（通常是 WebSocket 对端）。
 *
 * @returns AbortController，可用于取消请求
 */
export async function chatCompletion(
  request: WsChatRequest,
  config: GatewayConfig,
  callbacks: { onChunk: OnChunk; onDone: OnDone; onError: OnError },
): Promise<AbortController> {
  const { onChunk, onDone, onError } = callbacks;
  const ac = new AbortController();

  const provider: LLMProvider = request.provider ?? config.defaultProvider;
  const providerCfg = config.providers[provider];

  if (!providerCfg) {
    onError('PROVIDER_NOT_CONFIGURED', `Provider "${provider}" is not configured`);
    return ac;
  }

  const model = request.model ?? providerCfg.defaultModel;
  const stream = request.stream !== false; // 默认开启流式

  const messages = request.messages.map((m: ChatMessage) => {
    const base = {
      role: m.role as OpenAI.Chat.ChatCompletionMessageParam['role'],
      content: m.content,
    };
    return m.name ? { ...base, name: m.name } : base;
  }) as OpenAI.Chat.ChatCompletionMessageParam[];

  const client = buildClient(provider, config);

  try {
    if (stream) {
      const streamResp = await client.chat.completions.create(
        {
          model,
          messages,
          stream: true,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          ...(request.extra ?? {}),
        },
        { signal: ac.signal },
      );

      let firstChunk = true;
      for await (const chunk of streamResp) {
        if (ac.signal.aborted) break;
        const delta = extractDelta(chunk);
        if (delta) {
          onChunk(delta, firstChunk ? model : '');
          firstChunk = false;
        }
      }

      onDone(); // DeepSeek 流式暂不返回 usage，直接完成
    } else {
      const resp = await client.chat.completions.create(
        {
          model,
          messages,
          stream: false,
          temperature: request.temperature,
          max_tokens: request.max_tokens,
          ...(request.extra ?? {}),
        },
        { signal: ac.signal },
      );

      const content = resp.choices[0]?.message?.content ?? '';
      if (content) onChunk(content, model);

      const usage: TokenUsage | undefined = resp.usage
        ? {
            prompt_tokens: resp.usage.prompt_tokens,
            completion_tokens: resp.usage.completion_tokens,
            total_tokens: resp.usage.total_tokens,
          }
        : undefined;

      onDone(usage);
    }
  } catch (err: unknown) {
    if (ac.signal.aborted) return ac;

    if (err instanceof OpenAI.APIError) {
      onError(String(err.status ?? 'API_ERROR'), err.message);
    } else {
      onError('UNKNOWN_ERROR', err instanceof Error ? err.message : String(err));
    }
  }

  return ac;
}
