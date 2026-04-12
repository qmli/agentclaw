import OpenAI from "openai";
import type { GatewayConfig, LLMProvider } from "../../gateway/types.ts";
import {
  DEEPSEEK_BASE_URL,
  OLLAMA_BASE_URL,
  OLLAMA_TOOL_CAPABLE_PREFIXES,
} from "./constants.js";

/** 判断 Ollama 模型是否支持工具调用 */
export function ollamaSupportsTools(model: string): boolean {
  const lower = model.toLowerCase();
  return OLLAMA_TOOL_CAPABLE_PREFIXES.some((prefix) =>
    lower.startsWith(prefix),
  );
}

/** 根据提供方配置构建 OpenAI 兼容客户端 */
export function buildClient(
  provider: LLMProvider,
  config: GatewayConfig,
): OpenAI {
  if (provider === "ollama") {
    const providerCfg = config.providers.ollama;
    const baseURL = providerCfg?.baseUrl ?? OLLAMA_BASE_URL;
    const apiKey = providerCfg?.apiKey || "ollama";
    return new OpenAI({ apiKey, baseURL });
  }

  const providerCfg = config.providers[provider];
  if (!providerCfg) {
    throw new Error(`Provider "${provider}" is not configured`);
  }

  const baseURL =
    providerCfg.baseUrl ??
    (provider === "deepseek" ? DEEPSEEK_BASE_URL : undefined);

  return new OpenAI({ apiKey: providerCfg.apiKey, baseURL });
}
