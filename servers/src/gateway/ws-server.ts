import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "http";
import type {
  GatewayConfig,
  WsClientMessage,
  WsServerMessage,
  WsChatRequest,
} from "./types.js";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import type { AgentEvent } from "../runtime/types.js";

/** 每个连接维护的上下文 */
interface ConnectionContext {
  /** 正在运行的请求：requestId → AsyncGenerator */
  pending: Map<string, AsyncGenerator<AgentEvent>>;
}

/** 向客户端安全发送 JSON 消息 */
function send(ws: WebSocket, msg: WsServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

/** 校验来源（简单白名单，防止未授权跨域连接） */
function isOriginAllowed(
  req: IncomingMessage,
  allowedOrigins: string[],
): boolean {
  if (allowedOrigins.length === 0) return true;
  const origin = req.headers.origin ?? "";
  return allowedOrigins.includes(origin);
}

/** 处理单条聊天请求 */
/**
 * 处理传入的 WebSocket 聊天请求，并将响应实时发送回客户端。
 *
 * 通过代理运行时执行聊天请求，并将实时事件（如内容片段、完成或错误）发送回 WebSocket 连接。
 *
 * @param ws - 用于发送响应的 WebSocket 连接
 * @param ctx - 包含待处理请求追踪信息的连接上下文
 * @param request - 包含消息和模型参数的传入聊天请求
 * @param runtime - 用于执行聊天逻辑的代理运行时实例
 *
 * @returns 当聊天流完成或发生错误时解析的 Promise
 *
 * @remarks
 * - 将生成器存储在 ctx.pending 中，以跟踪活动请求
 * - 支持多种事件类型的流式传输："chunk"（令牌更新）、"done"（完成及使用情况）、"error"（失败）
 * - 无论结果如何，都会在 finally 块中自动清理待处理请求
 * - 支持扩展以增加其他事件类型，如 "tool_start" 和 "tool_end"
 */
async function handleChat(
  ws: WebSocket,
  ctx: ConnectionContext,
  request: WsChatRequest,
  runtime: AgentRuntime,
): Promise<void> {
  const { id } = request;

  const gen = runtime.run(request.messages, {
    provider: request.provider,
    model: request.model,
    temperature: request.temperature,
    maxTokens: request.max_tokens,
  });

  ctx.pending.set(id, gen);

  try {
    for await (const event of gen) {
      switch (event.type) {
        case "chunk":
          send(ws, {
            type: "chunk",
            id,
            delta: event.delta,
            ...(event.model ? { model: event.model } : {}),
          });
          break;
        case "done":
          send(ws, { type: "done", id, usage: event.usage });
          break;
        case "error":
          send(ws, {
            type: "error",
            id,
            code: event.code,
            message: event.message,
          });
          break;
        // tool_start / tool_end 可按需扩展为新消息类型
      }
    }
  } finally {
    ctx.pending.delete(id);
  }
}

/** 处理客户端消息 */
function handleMessage(
  ws: WebSocket,
  ctx: ConnectionContext,
  raw: string,
  runtime: AgentRuntime,
): void {
  let msg: WsClientMessage;
  try {
    msg = JSON.parse(raw) as WsClientMessage;
  } catch {
    send(ws, {
      type: "error",
      id: "",
      code: "PARSE_ERROR",
      message: "Invalid JSON message",
    });
    return;
  }

  switch (msg.type) {
    case "chat":
      handleChat(ws, ctx, msg, runtime).catch(() => {
        // handleChat 内部已处理错误，此处忽略
      });
      break;

    case "cancel": {
      const gen = ctx.pending.get(msg.id);
      if (gen) {
        gen.return(undefined).catch(() => {});
        ctx.pending.delete(msg.id);
      }
      break;
    }

    default:
      send(ws, {
        type: "error",
        id: "",
        code: "UNKNOWN_MESSAGE_TYPE",
        message: `Unknown message type`,
      });
  }
}

/** 创建并启动 WebSocket 网关服务 */
export function createGateway(config: GatewayConfig): WebSocketServer {
  // 单实例 AgentRuntime，skill 快照按版本缓存，所有连接共享
  const runtime = new AgentRuntime({
    providers: config.providers,
    defaultProvider: config.defaultProvider,
    workspaceDir: config.workspaceDir,
  });

  const wss = new WebSocketServer({ port: config.port });

  wss.on("listening", () => {
    console.log(
      `[gateway] WebSocket server listening on ws://localhost:${config.port}`,
    );
  });

  wss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    // 来源校验
    if (!isOriginAllowed(req, config.allowedOrigins)) {
      ws.close(1008, "Origin not allowed");
      return;
    }

    const ctx: ConnectionContext = { pending: new Map() };
    console.log(`[gateway] Client connected  ip=${req.socket.remoteAddress}`);

    ws.on("message", (data) => {
      const raw = data.toString();
      // 客户端文本心跳（type: ping）在路由到 handleMessage 之前先处理
      try {
        const parsed = JSON.parse(raw) as { type: string };
        if (parsed.type === "ping") {
          send(ws, { type: "pong", ts: Date.now() });
          return;
        }
      } catch {
        // 非 JSON，交由 handleMessage 报告解析错误
      }
      handleMessage(ws, ctx, raw, runtime);
    });

    ws.on("ping", () => {
      ws.pong();
    });

    ws.on("close", () => {
      // 连接关闭时终止所有挂起的 generator
      for (const gen of ctx.pending.values()) {
        gen.return(undefined).catch(() => {});
      }
      ctx.pending.clear();
      console.log(
        `[gateway] Client disconnected ip=${req.socket.remoteAddress}`,
      );
    });

    ws.on("error", (err) => {
      console.error(`[gateway] Connection error: ${err.message}`);
    });
  });

  wss.on("error", (err) => {
    console.error(`[gateway] Server error: ${err.message}`);
  });

  return wss;
}
