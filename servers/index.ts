import 'dotenv/config';
import { createGateway } from './src/gateway/ws-server.js';
import type { GatewayConfig, LLMProvider } from './src/gateway/types.js';

/** 从环境变量读取配置，未设置时使用默认值 */
const config: GatewayConfig = {
  port: Number(process.env.GATEWAY_PORT ?? 8080),
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [], // 空数组 = 允许所有

  defaultProvider: (process.env.DEFAULT_PROVIDER as LLMProvider) ?? 'deepseek',

  providers: {
    openai: process.env.OPENAI_API_KEY
      ? {
          apiKey: process.env.OPENAI_API_KEY,
          baseUrl: process.env.OPENAI_BASE_URL,
          defaultModel: process.env.OPENAI_DEFAULT_MODEL ?? 'gpt-4o',
        }
      : undefined,

    deepseek: process.env.DEEPSEEK_API_KEY
      ? {
          apiKey: process.env.DEEPSEEK_API_KEY,
          baseUrl: process.env.DEEPSEEK_BASE_URL, // 默认 https://api.deepseek.com/v1
          defaultModel: process.env.DEEPSEEK_DEFAULT_MODEL ?? 'deepseek-chat',
        }
      : undefined,

    custom: process.env.CUSTOM_API_KEY
      ? {
          apiKey: process.env.CUSTOM_API_KEY,
          baseUrl: process.env.CUSTOM_BASE_URL,
          defaultModel: process.env.CUSTOM_DEFAULT_MODEL ?? 'gpt-4o',
        }
      : undefined,
  },
};

createGateway(config);
