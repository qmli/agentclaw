import OpenAI from "openai";

// ====== 内置工具定义（TOOL_MAP：名称 → LLM function 定义）======
//
// 新增工具时：
//   1. 在此 map 里注册 LLM function 定义
//   2. 在 tool-executor.ts 的 executeTool() 中实现执行逻辑
//   3. 把名称加入 tool-executor.ts 的 BUILT_IN_TOOL_NAMES
//
export const TOOL_MAP: Record<string, OpenAI.Chat.ChatCompletionTool> = {
  /**
   * 搜索工具（优先使用）：后端使用 DuckDuckGo Lite，无需 API Key，
   * 不会被 CAPTCHA 拦截，返回结构化的标题 + URL + 摘要列表。
   */
  web_search: {
    type: "function",
    function: {
      name: "web_search",
      description:
        "Search the web and return a structured list of results (title, URL, snippet). " +
        "Uses DuckDuckGo — works without API keys and is not blocked by CAPTCHAs. " +
        "ALWAYS prefer this over web_fetch for finding current information or news. " +
        "After getting results, use web_fetch to read specific articles if needed.",
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

  /**
   * 页面抓取工具：适合读取特定文章/新闻页面的完整内容。
   * 部分网站会拒绝服务端爬取（返回 403），此时请改用 web_search。
   */
  web_fetch: {
    type: "function",
    function: {
      name: "web_fetch",
      description:
        "Fetch the full text content of a specific URL (article, news page, etc.). " +
        "Use this AFTER web_search to read an article in depth. " +
        "Do NOT use this to search — use web_search instead. " +
        "Some sites block server-side requests; if you get a 403 error, skip that URL.",
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
} as const;
