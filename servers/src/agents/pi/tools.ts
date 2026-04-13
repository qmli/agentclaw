import { Type } from "@mariozechner/pi-ai";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { executeTool } from "../../gateway/tool-executor.js";
import type { ToolExecutionContext } from "../../gateway/tool-executor.js";

// ====== 工具描述文本 ======

const WEB_SEARCH_DESCRIPTION =
  "Search the web and return a structured list of results (title, URL, snippet). " +
  "Uses Baidu (Chinese queries) or Bing (English queries) — works without API keys. " +
  "ALWAYS prefer this over web_fetch for finding current information or news. " +
  "After getting results, use web_fetch to read specific articles if needed.";

const WEB_FETCH_DESCRIPTION =
  "Fetch the full text content of a specific URL (article, news page, etc.). " +
  "Use this AFTER web_search to read an article in depth. " +
  "Do NOT use this to search — use web_search instead. " +
  "Some sites block server-side requests; if you get a 403 error, skip that URL.";

const READ_DESCRIPTION =
  "Read the contents of a local file on the user's machine. " +
  "Use this to read SKILL.md files listed in <available_skills> — supply the exact path from the location= attribute. " +
  "Supports ~/ prefix for home directory. " +
  "Only files inside the home directory or workspace are accessible.";

// ====== pi AgentTool 定义 ======
//
// 新增工具时：
//   1. 在此文件的 PI_TOOL_MAP 中注册 AgentTool 定义
//   2. 在 tool-executor.ts 的 executeTool() 中实现执行逻辑
//   3. 把名称加入 tool-executor.ts 的 BUILT_IN_TOOL_NAMES

/** 全量工具映射表，key 为工具名 */
export const PI_TOOL_MAP: Record<string, AgentTool> = {
  web_search: {
    name: "web_search",
    label: "Web Search",
    description: WEB_SEARCH_DESCRIPTION,
    parameters: Type.Object({
      query: Type.String({
        description: "The search query. Include date context for time-sensitive queries.",
      }),
    }),
    execute: async (_id, params, _signal) => {
      const text = await executeTool("web_search", params as Record<string, unknown>, { workspaceDir: undefined });
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  },

  web_fetch: {
    name: "web_fetch",
    label: "Web Fetch",
    description: WEB_FETCH_DESCRIPTION,
    parameters: Type.Object({
      url: Type.String({
        description: "Fully-qualified http/https URL to fetch.",
      }),
    }),
    execute: async (_id, params, _signal) => {
      const text = await executeTool("web_fetch", params as Record<string, unknown>, { workspaceDir: undefined });
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  },

  read: {
    name: "read",
    label: "Read File",
    description: READ_DESCRIPTION,
    parameters: Type.Object({
      path: Type.String({
        description: "Absolute or ~/-prefixed path to the file to read.",
      }),
    }),
    execute: async (_id, params, _signal) => {
      const text = await executeTool("read", params as Record<string, unknown>, { workspaceDir: undefined });
      return { content: [{ type: "text" as const, text }], details: {} };
    },
  },
};

/**
 * 根据工具名列表和执行上下文，构造 pi AgentTool 数组。
 *
 * 执行上下文（workspaceDir）在此处注入，确保 read 工具的路径安全校验正确运行。
 */
export function buildTools(
  toolNames: readonly string[],
  toolCtx: ToolExecutionContext,
): AgentTool[] {
  const result: AgentTool[] = [];

  for (const name of toolNames) {
    const def = PI_TOOL_MAP[name];
    if (!def) continue;

    // 重新绑定执行上下文（workspaceDir 在 PI_TOOL_MAP 静态定义中为 undefined）
    result.push({
      ...def,
      execute: async (_id: string, params: unknown) => {
        const text = await executeTool(name, params as Record<string, unknown>, toolCtx);
        return { content: [{ type: "text" as const, text }], details: {} };
      },
    } as AgentTool);
  }

  return result;
}
