import { useState, useRef, useEffect, KeyboardEvent, useCallback } from "react";
import "./Chat.css";

// 单条消息模型：用于渲染气泡和时间。
interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

type ConnectionState = "connecting" | "open" | "closed" | "error";

interface WsChunkMessage {
  type: "chunk";
  id: string;
  delta: string;
  model?: string;
}

interface WsDoneMessage {
  type: "done";
  id: string;
}

interface WsErrorMessage {
  type: "error";
  id: string;
  code: string;
  message: string;
}

interface WsPongMessage {
  type: "pong";
  ts: number;
}

type WsServerMessage =
  | WsChunkMessage
  | WsDoneMessage
  | WsErrorMessage
  | WsPongMessage;

interface PendingRequest {
  conversationId: number;
  assistantMessageId: number;
}

// 对话模型：每个会话有标题和一组消息。
interface Conversation {
  id: number;
  title: string;
  messages: Message[];
}

// 新对话默认欢迎语。进入新会话后会先展示这条消息。
const WELCOME_MESSAGE: Message = {
  id: 0,
  role: "assistant",
  content: "你好！我是其明打造的 AgentClaw，有什么可以帮你的吗？",
  timestamp: new Date(),
};

function getGatewayUrl(): string {
  const fromEnv = import.meta.env.VITE_GATEWAY_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) return fromEnv.trim();
  return `ws://${window.location.hostname}:8080`;
}

export default function Chat() {
  // conversations: 左侧会话列表的完整数据源。
  const [conversations, setConversations] = useState<Conversation[]>([
    { id: 1, title: "新对话", messages: [WELCOME_MESSAGE] },
  ]);

  // activeId: 当前激活会话 id，决定右侧主区域展示哪一组消息。
  const [activeId, setActiveId] = useState(1);

  // input: 输入框实时内容。
  const [input, setInput] = useState("");

  // loading: 发送中状态，用于禁用按钮和显示“正在输入”动画。
  const [loading, setLoading] = useState(false);

  // connection: WebSocket 连接状态。
  const [connection, setConnection] = useState<ConnectionState>("connecting");

  // lastError: 最近一次连接或请求错误，用于页面提示。
  const [lastError, setLastError] = useState("");

  // 消息列表底部锚点：每次消息变化后自动滚动到底。
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // 文本域引用：用于根据内容动态调整输入框高度。
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // WebSocket 连接对象。
  const wsRef = useRef<WebSocket | null>(null);

  // 当前请求映射：requestId -> 对应会话和助手消息。
  const pendingRef = useRef<Map<string, PendingRequest>>(new Map());

  // 当前激活请求 id，用于控制单请求发送状态。
  const activeRequestIdRef = useRef<string | null>(null);

  // 标记是否允许自动重连（组件卸载时关闭）。
  const shouldReconnectRef = useRef(true);

  // 自动重连计时器。
  const reconnectTimerRef = useRef<number | null>(null);

  // 当前会话（理论上始终存在，初始化和删除逻辑已保证）。
  const activeConv = conversations.find((c) => c.id === activeId)!;

  // 当前会话的消息列表，便于下方直接渲染。
  const messages = activeConv?.messages ?? [];

  const closeSocket = useCallback(() => {
    if (reconnectTimerRef.current !== null) {
      window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  const connectGateway = useCallback(() => {
    closeSocket();
    setConnection("connecting");

    const ws = new WebSocket(getGatewayUrl());
    wsRef.current = ws;

    ws.onopen = () => {
      setConnection("open");
      setLastError("");
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: WsServerMessage;
      try {
        msg = JSON.parse(event.data) as WsServerMessage;
      } catch {
        return;
      }

      if (msg.type === "chunk") {
        const pending = pendingRef.current.get(msg.id);
        if (!pending) return;
        setConversations((prev) =>
          prev.map((c) =>
            c.id === pending.conversationId
              ? {
                  ...c,
                  messages: c.messages.map((m) =>
                    m.id === pending.assistantMessageId
                      ? { ...m, content: m.content + msg.delta }
                      : m,
                  ),
                }
              : c,
          ),
        );
        return;
      }

      if (msg.type === "done") {
        pendingRef.current.delete(msg.id);
        if (activeRequestIdRef.current === msg.id) {
          activeRequestIdRef.current = null;
          setLoading(false);
        }
        return;
      }

      if (msg.type === "error") {
        const pending = pendingRef.current.get(msg.id);
        debugger;
        pendingRef.current.delete(msg.id);
        if (pending) {
          setConversations((prev) =>
            prev.map((c) =>
              c.id === pending.conversationId
                ? {
                    ...c,
                    messages: c.messages.map((m) =>
                      m.id === pending.assistantMessageId
                        ? {
                            ...m,
                            content: `请求失败：${msg.code} - ${msg.message}`,
                          }
                        : m,
                    ),
                  }
                : c,
            ),
          );
        }
        if (activeRequestIdRef.current === msg.id) {
          activeRequestIdRef.current = null;
          setLoading(false);
        }
        setLastError(`${msg.code}: ${msg.message}`);
      }
    };

    ws.onerror = () => {
      setConnection("error");
      setLastError("WebSocket 连接异常");
    };

    ws.onclose = () => {
      setConnection("closed");
      if (activeRequestIdRef.current) {
        activeRequestIdRef.current = null;
        setLoading(false);
      }

      if (shouldReconnectRef.current) {
        reconnectTimerRef.current = window.setTimeout(() => {
          connectGateway();
        }, 1500);
      }
    };
  }, [closeSocket]);

  // 当消息变化时，将视图滚动到最底部，保证最新消息可见。
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  useEffect(() => {
    shouldReconnectRef.current = true;
    connectGateway();

    return () => {
      shouldReconnectRef.current = false;
      closeSocket();
    };
  }, [closeSocket, connectGateway]);

  // 输入内容变更时自适应高度，避免滚动条过早出现。
  // 最大高度限制为 200px，超过后改为内部滚动。
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height =
        Math.min(textareaRef.current.scrollHeight, 200) + "px";
    }
  }, [input]);

  // 新建会话：创建新 id，插入默认欢迎语并切换到该会话。
  function newConversation() {
    const id = Date.now();
    setConversations((prev) => [
      ...prev,
      {
        id,
        title: "新对话",
        messages: [
          { ...WELCOME_MESSAGE, id: Date.now(), timestamp: new Date() },
        ],
      },
    ]);
    setActiveId(id);
    setInput("");
  }

  // 删除会话：
  // 1) 若删完为空，则自动创建一个新的默认会话。
  // 2) 若删除的是当前会话，则切换到最后一个会话。
  function deleteConversation(id: number) {
    setConversations((prev) => {
      const next = prev.filter((c) => c.id !== id);
      if (next.length === 0) {
        const newId = Date.now();
        setActiveId(newId);
        return [
          {
            id: newId,
            title: "新对话",
            messages: [
              { ...WELCOME_MESSAGE, id: Date.now(), timestamp: new Date() },
            ],
          },
        ];
      }
      if (id === activeId) setActiveId(next[next.length - 1].id);
      return next;
    });
  }

  // 发送消息主流程：
  // 1) 校验输入；2) 追加用户消息；3) 模拟请求；4) 追加助手消息。
  async function sendMessage() {
    const text = input.trim();
    if (!text || loading) return;
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setLastError("服务端未连接，请稍后重试");
      return;
    }

    const convId = activeId;

    // 先生成并落库用户消息，确保界面立即反馈。
    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      content: text,
      timestamp: new Date(),
    };
    const assistantMsg: Message = {
      id: Date.now() + 1,
      role: "assistant",
      content: "",
      timestamp: new Date(),
    };

    const history = (activeConv?.messages ?? [])
      .filter((m) => m.content.trim().length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

    setConversations((prev) =>
      prev.map((c) =>
        c.id === convId
          ? {
              ...c,
              // 第一轮用户输入可自动作为会话标题，便于在侧边栏识别。
              title: c.messages.length <= 1 ? text.slice(0, 20) : c.title,
              messages: [...c.messages, userMsg, assistantMsg],
            }
          : c,
      ),
    );
    setInput("");
    setLoading(true);

    const requestId =
      typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    activeRequestIdRef.current = requestId;
    pendingRef.current.set(requestId, {
      conversationId: convId,
      assistantMessageId: assistantMsg.id,
    });

    const payload = {
      type: "chat" as const,
      id: requestId,
      stream: true,
      messages: [...history, { role: "user" as const, content: text }],
    };

    try {
      wsRef.current.send(JSON.stringify(payload));
    } catch {
      pendingRef.current.delete(requestId);
      activeRequestIdRef.current = null;
      setLoading(false);
      setLastError("发送失败，请检查服务端连接");
      setConversations((prev) =>
        prev.map((c) =>
          c.id === convId
            ? {
                ...c,
                messages: c.messages.map((m) =>
                  m.id === assistantMsg.id
                    ? { ...m, content: "发送失败，请重试。" }
                    : m,
                ),
              }
            : c,
        ),
      );
    }
  }

  // 键盘行为：Enter 发送，Shift+Enter 换行。
  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  }

  // 时间格式化（中文环境下仅显示时分）。
  function formatTime(date: Date) {
    return date.toLocaleTimeString("zh-CN", {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return (
    <div className="chat-layout">
      {/* 左侧：会话列表区域 */}
      <aside className="chat-sidebar">
        <div className="sidebar-header">
          <span className="sidebar-logo">🦀 AgentClaw</span>
          <button
            className="new-chat-btn"
            onClick={newConversation}
            title="新建对话"
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
        <nav className="sidebar-nav">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`conv-item ${conv.id === activeId ? "active" : ""}`}
              onClick={() => setActiveId(conv.id)}
            >
              <svg
                className="conv-icon"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              <span className="conv-title">{conv.title}</span>
              <button
                className="conv-delete"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(conv.id);
                }}
                title="删除"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          ))}
        </nav>
      </aside>

      {/* 右侧：主聊天区域 */}
      <main className="chat-main">
        <header className="chat-header">
          <span>{activeConv?.title}</span>
          <div className="conn-status-wrap">
            <span className={`conn-status ${connection}`}>{connection}</span>
            {connection !== "open" && (
              <button className="reconnect-btn" onClick={connectGateway}>
                重连
              </button>
            )}
          </div>
        </header>

        {/* 消息流：根据 role 渲染不同对齐和样式 */}
        <div className="chat-messages">
          {messages.map((msg) => (
            <div key={msg.id} className={`message-row ${msg.role}`}>
              <div className="message-avatar">
                {msg.role === "assistant" ? "🦀" : "👤"}
              </div>
              <div className="message-bubble">
                {msg.role === "assistant" && msg.content.length === 0 ? (
                  <div className="typing-dots">
                    <span />
                    <span />
                    <span />
                  </div>
                ) : (
                  <div className="message-content">{msg.content}</div>
                )}
                <div className="message-time">{formatTime(msg.timestamp)}</div>
              </div>
            </div>
          ))}

          {/* 底部锚点：配合 useEffect 做自动滚动 */}
          <div ref={messagesEndRef} />
        </div>

        {/* 输入区：文本域 + 发送按钮 */}
        <div className="chat-input-area">
          <div className="chat-input-box">
            <textarea
              ref={textareaRef}
              className="chat-textarea"
              placeholder="发送消息... (Enter 发送，Shift+Enter 换行)"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              rows={1}
            />
            <button
              className={`send-btn ${input.trim() && !loading ? "active" : ""}`}
              onClick={sendMessage}
              disabled={!input.trim() || loading}
              title="发送"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            </button>
          </div>
          <p className="chat-hint">
            {lastError || "AgentClaw 可能会出错，请核实重要信息。"}
          </p>
        </div>
      </main>
    </div>
  );
}
