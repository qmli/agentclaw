import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import { chatCompletion } from './openai-http.js';
import type {
  GatewayConfig,
  WsClientMessage,
  WsServerMessage,
  WsChatRequest,
} from './types.js';

/** 每个连接维护的上下文 */
interface ConnectionContext {
  /** 正在运行的请求：requestId → AbortController */
  pending: Map<string, AbortController>;
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
  const origin = req.headers.origin ?? '';
  return allowedOrigins.includes(origin);
}

/** 处理单条聊天请求 */
async function handleChat(
  ws: WebSocket,
  ctx: ConnectionContext,
  request: WsChatRequest,
  config: GatewayConfig,
): Promise<void> {
  const { id } = request;

  const ac = await chatCompletion(request, config, {
    onChunk(delta, model) {
      send(ws, { type: 'chunk', id, delta, ...(model ? { model } : {}) });
    },
    onDone(usage) {
      ctx.pending.delete(id);
      send(ws, { type: 'done', id, usage });
    },
    onError(code, message) {
      ctx.pending.delete(id);
      send(ws, { type: 'error', id, code, message });
    },
  });

  // 将 AbortController 注册到连接上下文，以支持 cancel 消息
  ctx.pending.set(id, ac);
}

/** 处理客户端消息 */
function handleMessage(
  ws: WebSocket,
  ctx: ConnectionContext,
  raw: string,
  config: GatewayConfig,
): void {
  let msg: WsClientMessage;
  try {
    msg = JSON.parse(raw) as WsClientMessage;
  } catch {
    send(ws, {
      type: 'error',
      id: '',
      code: 'PARSE_ERROR',
      message: 'Invalid JSON message',
    });
    return;
  }

  switch (msg.type) {
    case 'chat':
      handleChat(ws, ctx, msg, config).catch(() => {
        // handleChat 内部已处理错误，此处忽略
      });
      break;

    case 'cancel': {
      const ac = ctx.pending.get(msg.id);
      if (ac) {
        ac.abort();
        ctx.pending.delete(msg.id);
      }
      break;
    }

    default:
      send(ws, {
        type: 'error',
        id: '',
        code: 'UNKNOWN_MESSAGE_TYPE',
        message: `Unknown message type`,
      });
  }
}

/** 创建并启动 WebSocket 网关服务 */
export function createGateway(config: GatewayConfig): WebSocketServer {
  const wss = new WebSocketServer({ port: config.port });

  wss.on('listening', () => {
    console.log(`[gateway] WebSocket server listening on ws://localhost:${config.port}`);
  });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    // 来源校验
    if (!isOriginAllowed(req, config.allowedOrigins)) {
      ws.close(1008, 'Origin not allowed');
      return;
    }

    const ctx: ConnectionContext = { pending: new Map() };
    console.log(`[gateway] Client connected  ip=${req.socket.remoteAddress}`);

    ws.on('message', (data) => {
      handleMessage(ws, ctx, data.toString(), config);
    });

    ws.on('ping', () => {
      ws.pong();
    });

    // 客户端主动心跳 (type: ping 文本消息)
    ws.on('message', (data) => {
      try {
        const parsed = JSON.parse(data.toString()) as { type: string };
        if (parsed.type === 'ping') {
          send(ws, { type: 'pong', ts: Date.now() });
        }
      } catch {
        // 已在上方统一处理，忽略
      }
    });

    ws.on('close', () => {
      // 连接关闭时取消所有挂起请求
      for (const ac of ctx.pending.values()) {
        ac.abort();
      }
      ctx.pending.clear();
      console.log(`[gateway] Client disconnected ip=${req.socket.remoteAddress}`);
    });

    ws.on('error', (err) => {
      console.error(`[gateway] Connection error: ${err.message}`);
    });
  });

  wss.on('error', (err) => {
    console.error(`[gateway] Server error: ${err.message}`);
  });

  return wss;
}
