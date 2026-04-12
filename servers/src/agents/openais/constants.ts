/** DeepSeek 官方 API Base URL */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

/** Ollama 本地默认 Base URL（OpenAI 兼容接口） */
export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * Ollama 中已知支持 function calling 的模型名前缀。
 * 不在列表中的模型一律视为不支持工具，发送请求时自动剔除 tools 字段。
 * 参考：https://ollama.com/search?c=tools
 */
export const OLLAMA_TOOL_CAPABLE_PREFIXES = [
  "llama3.1",
  "llama3.2",
  "llama3.3",
  "qwen2.5",
  "qwen2.5-coder",
  "mistral",
  "mixtral",
  "command-r",
  "hermes3",
  "firefunction",
  "nexusraven",
  "aya-expanse",
] as const;

/** 最多连续调用工具的轮次，防止无限循环 */
export const MAX_TOOL_ITERATIONS = 10;
