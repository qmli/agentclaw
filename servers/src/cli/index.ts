#!/usr/bin/env node
/**
 * openclaw CLI
 *
 * 用法：
 *   openclaw serve   [--port <n>]    [--workspace <dir>]
 *   openclaw run     <message>       [--provider <p>] [--model <m>] [--workspace <dir>]
 *   openclaw skills  list            [--workspace <dir>]
 *   openclaw --help
 */

import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import process from "node:process";

import { createGateway } from "../gateway/ws-server.js";
import type { GatewayConfig, LLMProvider } from "../gateway/types.js";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import { loadSkillEntries } from "../agents/skills/index.js";

// ====== 参数解析工具 ======

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx !== -1 && idx + 1 < args.length) return args[idx + 1];
  const prefixed = args.find((a) => a.startsWith(`${flag}=`));
  if (prefixed) return prefixed.slice(flag.length + 1);
  return undefined;
}

function hasFlag(args: string[], ...flags: string[]): boolean {
  return flags.some((f) => args.includes(f));
}

// ====== 工作区目录解析 ======

function resolveWorkspaceDir(fromArg?: string): string {
  if (fromArg) return path.resolve(fromArg);
  const fromEnv = process.env["WORKSPACE_DIR"]?.trim();
  if (fromEnv) return fromEnv;
  const cwd = process.cwd();
  if (fs.existsSync(path.join(cwd, "skills"))) return cwd;
  const parent = path.resolve(cwd, "..");
  if (fs.existsSync(path.join(parent, "skills"))) return parent;
  return cwd;
}

// ====== GatewayConfig 工厂 ======

function buildGatewayConfig(opts: {
  port?: number;
  workspaceDir?: string;
}): GatewayConfig {
  return {
    port: opts.port ?? Number(process.env["GATEWAY_PORT"] ?? 8080),
    allowedOrigins: process.env["ALLOWED_ORIGINS"]
      ? process.env["ALLOWED_ORIGINS"].split(",").map((o) => o.trim())
      : [],
    defaultProvider: (process.env["DEFAULT_PROVIDER"] as LLMProvider) ?? "deepseek",
    workspaceDir: opts.workspaceDir ?? resolveWorkspaceDir(),
    providers: {
      openai: process.env["OPENAI_API_KEY"]
        ? {
            apiKey: process.env["OPENAI_API_KEY"],
            baseUrl: process.env["OPENAI_BASE_URL"],
            defaultModel: process.env["OPENAI_DEFAULT_MODEL"] ?? "gpt-4o",
          }
        : undefined,
      deepseek: process.env["DEEPSEEK_API_KEY"]
        ? {
            apiKey: process.env["DEEPSEEK_API_KEY"],
            baseUrl: process.env["DEEPSEEK_BASE_URL"],
            defaultModel: process.env["DEEPSEEK_DEFAULT_MODEL"] ?? "deepseek-chat",
          }
        : undefined,
      ollama: {
        apiKey: process.env["OLLAMA_API_KEY"] ?? "ollama",
        baseUrl: process.env["OLLAMA_BASE_URL"],
        defaultModel: process.env["OLLAMA_DEFAULT_MODEL"] ?? "llama3.2",
      },
      custom: process.env["CUSTOM_API_KEY"]
        ? {
            apiKey: process.env["CUSTOM_API_KEY"],
            baseUrl: process.env["CUSTOM_BASE_URL"],
            defaultModel: process.env["CUSTOM_DEFAULT_MODEL"] ?? "gpt-4o",
          }
        : undefined,
    },
  };
}

// ====== 命令：serve ======

function cmdServe(args: string[]): void {
  const port = parseFlag(args, "--port")
    ? Number(parseFlag(args, "--port"))
    : undefined;
  const workspaceDir = resolveWorkspaceDir(parseFlag(args, "--workspace"));
  const config = buildGatewayConfig({ port, workspaceDir });

  console.log(`[openclaw] workspace: ${config.workspaceDir}`);
  createGateway(config);
}

// ====== 命令：run ======

async function cmdRun(args: string[]): Promise<void> {
  // 收集非 flag 的位置参数作为消息
  const positional = args.filter(
    (a) => !a.startsWith("--") && a !== args[args.indexOf(a) - 1]?.replace(/^--/, "") ,
  );

  // 简单地取第一个非 flag token 作为消息（支持带引号的单个字符串）
  const flagNames = new Set(["--provider", "--model", "--workspace", "--system"]);
  const messageTokens: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (flagNames.has(args[i]!)) { i++; continue; }
    if (args[i]!.startsWith("--")) continue;
    messageTokens.push(args[i]!);
  }
  const message = messageTokens.join(" ").trim();

  if (!message) {
    console.error("[openclaw] run: 请提供消息。用法: openclaw run <message>");
    process.exit(1);
  }

  const provider = parseFlag(args, "--provider") as LLMProvider | undefined;
  const model = parseFlag(args, "--model");
  const systemPrompt = parseFlag(args, "--system");
  const workspaceDir = resolveWorkspaceDir(parseFlag(args, "--workspace"));
  const config = buildGatewayConfig({ workspaceDir });

  const runtime = new AgentRuntime({
    providers: config.providers,
    defaultProvider: config.defaultProvider,
    workspaceDir: config.workspaceDir,
  });

  console.error(`[openclaw] run › provider=${provider ?? config.defaultProvider}${model ? ` model=${model}` : ""}`);
  console.error(`[openclaw] workspace: ${config.workspaceDir}\n`);

  let hasOutput = false;
  for await (const event of runtime.run(message, { provider, model, systemPrompt })) {
    switch (event.type) {
      case "chunk":
        process.stdout.write(event.delta);
        hasOutput = true;
        break;
      case "done":
        if (hasOutput) process.stdout.write("\n");
        if (event.usage) {
          console.error(
            `\n[openclaw] tokens: prompt=${event.usage.prompt_tokens} completion=${event.usage.completion_tokens} total=${event.usage.total_tokens}`,
          );
        }
        break;
      case "error":
        console.error(`\n[openclaw] error [${event.code}]: ${event.message}`);
        process.exit(1);
    }
  }
}

// ====== 命令：skills list ======

function cmdSkillsList(args: string[]): void {
  const workspaceDir = resolveWorkspaceDir(parseFlag(args, "--workspace"));
  console.log(`[openclaw] 加载 skills，workspace: ${workspaceDir}\n`);

  const entries = loadSkillEntries({ workspaceDir });

  if (entries.length === 0) {
    console.log("  (未找到任何技能)");
    return;
  }

  const bySource = new Map<string, typeof entries>();
  for (const e of entries) {
    const src = e.skill.source;
    if (!bySource.has(src)) bySource.set(src, []);
    bySource.get(src)!.push(e);
  }

  for (const [source, list] of bySource) {
    console.log(`── ${source} (${list.length})`);
    for (const e of list) {
      const flags: string[] = [];
      if (e.invocation?.userInvocable) flags.push("invocable");
      if (e.invocation?.disableModelInvocation) flags.push("no-model");
      if (e.metadata?.always) flags.push("always");
      const flagStr = flags.length ? `  [${flags.join(", ")}]` : "";
      const desc = e.skill.description.length > 72
        ? e.skill.description.slice(0, 72) + "…"
        : e.skill.description;
      console.log(`   • ${e.skill.name.padEnd(28)} ${desc}${flagStr}`);
    }
    console.log();
  }

  console.log(`共 ${entries.length} 个技能`);
}

// ====== 帮助文本 ======

function printHelp(): void {
  console.log(`
openclaw CLI — AgentClaw 命令行工具

用法:
  openclaw serve  [--port <n>] [--workspace <dir>]
      启动 WebSocket 网关服务器

  openclaw run <message> [选项]
      以单次对话方式运行 Agent
      --provider <p>    LLM 提供方 (openai|deepseek|ollama|custom)
      --model <m>       模型名称
      --workspace <dir> 工作区目录
      --system <prompt> 额外 system 提示

  openclaw skills list [--workspace <dir>]
      列出当前工作区所有可用技能

  openclaw --help
      显示此帮助

环境变量:
  OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_DEFAULT_MODEL
  DEEPSEEK_API_KEY / DEEPSEEK_BASE_URL / DEEPSEEK_DEFAULT_MODEL
  OLLAMA_BASE_URL / OLLAMA_DEFAULT_MODEL
  CUSTOM_API_KEY / CUSTOM_BASE_URL / CUSTOM_DEFAULT_MODEL
  DEFAULT_PROVIDER   默认提供方 (deepseek)
  GATEWAY_PORT       WebSocket 端口 (8080)
  WORKSPACE_DIR      工作区目录
`.trim());
}

// ====== 主入口 ======

async function main(): Promise<void> {
  const argv = process.argv.slice(2);

  if (argv.length === 0 || hasFlag(argv, "--help", "-h")) {
    printHelp();
    return;
  }

  const cmd = argv[0];
  const rest = argv.slice(1);

  switch (cmd) {
    case "serve":
      cmdServe(rest);
      break;

    case "run":
      await cmdRun(rest);
      break;

    case "skills": {
      const sub = rest[0];
      if (sub === "list") {
        cmdSkillsList(rest.slice(1));
      } else {
        console.error(`[openclaw] 未知 skills 子命令: ${sub ?? "(空)"}\n可用: list`);
        process.exit(1);
      }
      break;
    }

    default:
      console.error(`[openclaw] 未知命令: ${cmd}\n运行 openclaw --help 查看帮助`);
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("[openclaw] 致命错误:", err instanceof Error ? err.message : err);
  process.exit(1);
});
