/** DeepSeek 官方 API Base URL */
export const DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";

/** Ollama 本地默认 Base URL（OpenAI 兼容接口） */
export const OLLAMA_BASE_URL = "http://localhost:11434/v1";

/**
 * Ollama 中已知支持 function calling 的模型名前缀。
 * 不在列表中的模型会禁用 tools，避免 API 报错。
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
