import type { ChatMessage, GatewayConfig, WsChatRequest } from "../gateway/types.js";
import { chatCompletion } from "../agents/openais/index.js";
import { BUILT_IN_TOOL_NAMES } from "../gateway/tool-executor.js";
import { ensureSkillSnapshot } from "../agents/skills/index.js";
import type { SkillSnapshot } from "../agents/skills/index.js";
import type { AgentEvent, AgentRunOptions, AgentRuntimeConfig } from "./types.js";

/**
 * AgentRuntime —— 独立的 Agent 运行时，无需 WebSocket 即可使用。
 *
 * 用法示例：
 *
 *   const runtime = new AgentRuntime({
 *     providers: { deepseek: { apiKey: "...", defaultModel: "deepseek-chat" } },
 *     defaultProvider: "deepseek",
 *     workspaceDir: process.cwd(),
 *   });
 *
 *   for await (const event of runtime.run("帮我查一下今天的新闻")) {
 *     if (event.type === "chunk") process.stdout.write(event.delta);
 *     if (event.type === "done")  console.log("\n[完成]");
 *   }
 */
export class AgentRuntime {
  private readonly gatewayConfig: GatewayConfig;
  private skillSnapshot?: SkillSnapshot;

  constructor(config: AgentRuntimeConfig) {
    this.gatewayConfig = {
      port: 0,
      allowedOrigins: [],
      providers: config.providers,
      defaultProvider: config.defaultProvider,
      workspaceDir: config.workspaceDir,
    };
  }

  /**
   * 运行一次对话，以 AsyncGenerator 方式流式产出 AgentEvent。
   *
   * @param input   用户消息字符串，或完整的 ChatMessage 数组
   * @param options 运行选项（provider / model / systemPrompt 等）
   */
  async *run(
    input: string | ChatMessage[],
    options: AgentRunOptions = {},
  ): AsyncGenerator<AgentEvent> {
    // 组装初始消息列表
    let messages: ChatMessage[] =
      typeof input === "string"
        ? [{ role: "user", content: input }]
        : [...input];

    // 注入自定义 system prompt（置于消息最前）
    if (options.systemPrompt) {
      messages = [{ role: "system", content: options.systemPrompt }, ...messages];
    }

    // 注入 skills 快照（若配置了 workspaceDir）
    if (this.gatewayConfig.workspaceDir) {
      try {
        this.skillSnapshot = await ensureSkillSnapshot(
          this.gatewayConfig.workspaceDir,
          this.skillSnapshot,
          { availableTools: [...BUILT_IN_TOOL_NAMES] },
        );
        if (this.skillSnapshot.prompt) {
          messages = [
            { role: "system", content: this.skillSnapshot.prompt },
            ...messages,
          ];
        }
      } catch (err) {
        console.warn("[runtime] skills snapshot failed, skipping:", err);
      }
    }

    const request: WsChatRequest = {
      type: "chat",
      id: Math.random().toString(36).slice(2),
      messages,
      provider: options.provider,
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.maxTokens,
    };

    // 将回调式 chatCompletion 桥接为 AsyncGenerator
    // 使用事件队列 + Promise 信号实现背压感知的流式传递
    const queue: AgentEvent[] = [];
    let notify: (() => void) | null = null;
    let finished = false;

    const push = (event: AgentEvent) => {
      queue.push(event);
      const fn = notify;
      notify = null;
      fn?.();
    };

    const waitNext = (): Promise<void> =>
      new Promise<void>((resolve) => {
        notify = resolve;
      });

    // 启动 chatCompletion（不 await），让其在后台异步执行并通过回调推送事件
    chatCompletion(
      request,
      this.gatewayConfig,
      {
        onChunk(delta, model) {
          push({ type: "chunk", delta, ...(model ? { model } : {}) });
        },
        onDone(usage) {
          finished = true;
          push({ type: "done", usage });
        },
        onError(code, message) {
          finished = true;
          push({ type: "error", code, message });
        },
      },
      { toolNames: this.skillSnapshot?.toolNames },
    ).catch((err: unknown) => {
      finished = true;
      push({
        type: "error",
        code: "RUNTIME_ERROR",
        message: err instanceof Error ? err.message : String(err),
      });
    });

    // 消费队列，直到收到 done / error 事件
    while (true) {
      if (queue.length > 0) {
        const event = queue.shift()!;
        yield event;
        if (event.type === "done" || event.type === "error") return;
      } else if (finished) {
        return;
      } else {
        await waitNext();
      }
    }
  }

  /**
   * 强制刷新 skills 快照（通常不需要手动调用，run() 会按版本自动刷新）。
   */
  async refreshSkills(): Promise<void> {
    if (!this.gatewayConfig.workspaceDir) return;
    this.skillSnapshot = await ensureSkillSnapshot(
      this.gatewayConfig.workspaceDir,
      undefined,
      { availableTools: [...BUILT_IN_TOOL_NAMES] },
    );
  }
}
