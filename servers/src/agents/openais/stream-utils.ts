import OpenAI from "openai";

/** 解析流式 chunk 中的 content delta */
export function extractContentDelta(
  chunk: OpenAI.Chat.ChatCompletionChunk,
): string {
  return chunk.choices[0]?.delta?.content ?? "";
}

/** 安全解析工具调用参数 */
export function parseToolArgs(raw: string): Record<string, unknown> {
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export interface PendingToolCall {
  id: string;
  name: string;
  argsRaw: string;
}

/**
 * 从 streaming chunk 的 delta.tool_calls 中累积工具调用数据。
 * 返回 true 表示有更新（方便调试）。
 */
export function accumulateToolCalls(
  delta: OpenAI.Chat.ChatCompletionChunk.Choice.Delta,
  pending: Map<number, PendingToolCall>,
): boolean {
  if (!delta.tool_calls?.length) return false;
  for (const tc of delta.tool_calls) {
    const entry = pending.get(tc.index) ?? { id: "", name: "", argsRaw: "" };
    if (tc.id) entry.id = tc.id;
    if (tc.function?.name) entry.name += tc.function.name;
    if (tc.function?.arguments) entry.argsRaw += tc.function.arguments;
    pending.set(tc.index, entry);
  }
  return true;
}
