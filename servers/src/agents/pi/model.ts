import type { Model } from "@mariozechner/pi-ai";
import type { GatewayConfig, LLMProvider } from "../../gateway/types.js";
import { DEEPSEEK_BASE_URL, OLLAMA_BASE_URL, OLLAMA_TOOL_CAPABLE_PREFIXES } from "./constants.js";

/**
 * 判断 Ollama 模型是否支持工具调用（function calling）。
 * 不支持的模型发请求时需自动剔除 tools 字段。
 */
export function ollamaSupportsTools(model: string): boolean {
  const lower = model.toLowerCase();
  return OLLAMA_TOOL_CAPABLE_PREFIXES.some((prefix) => lower.startsWith(prefix));
}

/**
 * 根据 provider 和模型 ID，从 GatewayConfig 构造 pi-ai Model 对象。
 *
 * 所有 provider 均使用 openai-completions API（Chat Completions 格式），
 * pi-ai 会根据 baseUrl 自动识别 DeepSeek 等兼容性差异。
 *
 * | provider | API 端点 |
 * |----------|---------|
 * | openai   | https://api.openai.com/v1 |
 * | deepseek | https://api.deepseek.com/v1 |
 * | ollama   | http://localhost:11434/v1 |
 * | custom   | 由配置的 baseUrl 决定 |
 */
export function buildModel(
  provider: LLMProvider,
  modelId: string,
  config: GatewayConfig,
): Model<"openai-completions"> {
  const cfg = config.providers[provider];

  switch (provider) {
    case "ollama":
      return {
        id: modelId,
        name: `Ollama / ${modelId}`,
        api: "openai-completions",
        provider: "ollama",
        baseUrl: cfg?.baseUrl ?? OLLAMA_BASE_URL,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 32_000,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStore: false,
          supportsStrictMode: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens",
        },
      };

    case "deepseek":
      return {
        id: modelId,
        name: `DeepSeek / ${modelId}`,
        api: "openai-completions",
        provider: "deepseek",
        baseUrl: cfg?.baseUrl ?? DEEPSEEK_BASE_URL,
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 64_000,
        maxTokens: 8_192,
        compat: {
          supportsDeveloperRole: false,
          supportsReasoningEffort: false,
          supportsStore: false,
          supportsStrictMode: false,
          supportsUsageInStreaming: false,
          maxTokensField: "max_tokens" as const,
        },
      };

    case "custom":
      return {
        id: modelId,
        name: `Custom / ${modelId}`,
        api: "openai-completions",
        provider: "custom",
        baseUrl: cfg?.baseUrl ?? "",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      };

    case "openai":
    default:
      return {
        id: modelId,
        name: `OpenAI / ${modelId}`,
        api: "openai-completions",
        provider: "openai",
        baseUrl: cfg?.baseUrl ?? "https://api.openai.com/v1",
        reasoning: false,
        input: ["text", "image"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 128_000,
        maxTokens: 16_384,
      };
  }
}
