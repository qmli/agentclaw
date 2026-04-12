import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { createGateway } from './src/gateway/ws-server.js';
import type { GatewayConfig, LLMProvider } from './src/gateway/types.js';

function resolveWorkspaceDir(): string {
  const fromEnv = process.env.WORKSPACE_DIR?.trim();
  if (fromEnv) return fromEnv;

  const cwd = process.cwd();
  const cwdHasSkills = fs.existsSync(path.join(cwd, 'skills'));
  if (cwdHasSkills) return cwd;

  const parent = path.resolve(cwd, '..');
  const parentHasSkills = fs.existsSync(path.join(parent, 'skills'));
  if (parentHasSkills) return parent;

  return cwd;
}

/** 从环境变量读取配置，未设置时使用默认值 */
const config: GatewayConfig = {
  port: Number(process.env.GATEWAY_PORT ?? 8080),
  allowedOrigins: process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((o) => o.trim())
    : [], // 空数组 = 允许所有

  defaultProvider: (process.env.DEFAULT_PROVIDER as LLMProvider) ?? 'deepseek',
  workspaceDir: resolveWorkspaceDir(),

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

    // Ollama 无需 API Key，始终启用；可通过环境变量覆盖地址和默认模型
    ollama: {
      apiKey: process.env.OLLAMA_API_KEY ?? 'ollama',
      baseUrl: process.env.OLLAMA_BASE_URL, // 未设置则在 agents/openais/constants.ts 中使用默认值
      defaultModel: process.env.OLLAMA_DEFAULT_MODEL ?? 'llama3.2',
    },

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
