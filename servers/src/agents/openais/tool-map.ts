import OpenAI from "openai";

// ====== 内置工具定义 ======
//
// 新增工具时：
//   1. 在 TOOL_MAP（Chat Completions 格式）和 RESPONSES_TOOL_MAP（Responses API 格式）中同步注册
//   2. 在 tool-executor.ts 的 executeTool() 中实现执行逻辑
//   3. 把名称加入 tool-executor.ts 的 BUILT_IN_TOOL_NAMES
//

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

/** Chat Completions API 格式（Ollama / DeepSeek / Custom 使用） */
export const TOOL_MAP: Record<string, OpenAI.Chat.ChatCompletionTool> = {
  web_search: {
    type: "function",
    function: {
      name: "web_search",
      description: WEB_SEARCH_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The search query. Include date context for time-sensitive queries.",
          },
        },
        required: ["query"],
      },
    },
  },

  web_fetch: {
    type: "function",
    function: {
      name: "web_fetch",
      description: WEB_FETCH_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Fully-qualified http/https URL to fetch.",
          },
        },
        required: ["url"],
      },
    },
  },

  read: {
    type: "function",
    function: {
      name: "read",
      description: READ_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Absolute or ~/-prefixed path to the file to read.",
          },
        },
        required: ["path"],
      },
    },
  },
} as const;

/** Responses API 格式（OpenAI 原生接口使用） */
export const RESPONSES_TOOL_MAP: Record<string, OpenAI.Responses.FunctionTool> =
  {
    web_search: {
      type: "function",
      name: "web_search",
      description: WEB_SEARCH_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The search query. Include date context for time-sensitive queries.",
          },
        },
        required: ["query"],
      },
      strict: null,
    },

    web_fetch: {
      type: "function",
      name: "web_fetch",
      description: WEB_FETCH_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          url: {
            type: "string",
            description: "Fully-qualified http/https URL to fetch.",
          },
        },
        required: ["url"],
      },
      strict: null,
    },

    read: {
      type: "function",
      name: "read",
      description: READ_DESCRIPTION,
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description:
              "Absolute or ~/-prefixed path to the file to read.",
          },
        },
        required: ["path"],
      },
      strict: null,
    },
  } as const;
