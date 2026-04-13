/** 内置工具的服务端执行层 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

/**
 * 当前 gateway 提供的所有内置工具名。
 * 作为唯一权威来源：
 *   - ws-server.ts 将其传给 ensureSkillSnapshot（availableTools 过滤）
 *   - agents/pi/tools.ts 的 PI_TOOL_MAP 中对应 key 组装 pi AgentTool 数组
 */
export const BUILT_IN_TOOL_NAMES = Object.freeze([
  "web_fetch",
  "web_search",
  "read",
] as const);
export type BuiltInToolName = (typeof BUILT_IN_TOOL_NAMES)[number];

/** 工具执行上下文（如工作区目录，用于 read 工具路径安全校验） */
export interface ToolExecutionContext {
  workspaceDir?: string;
}

const WEB_FETCH_MAX_CHARS = 8_000;
const WEB_FETCH_TIMEOUT_MS = 15_000;
const WEB_SEARCH_MAX_RESULTS = 8;

/**
 * 现代浏览器 UA —— 使用明显的机器人标识会被 Cloudflare / Google 等直接拦截。
 */
const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/124.0.0.0 Safari/537.36";

// ====== HTML 工具函数 ======

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解码 HTML 实体（用于从 HTML 属性中还原真实 URL） */
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 从 Bing 追踪重定向 URL 中提取真实目标 URL。
 * Bing 结果链接格式：`.../ck/a?!&&...&u=a1<base64url>&...`
 * `u` 参数值以 `a1` 开头，后跟目标 URL 的 base64url 编码。
 * 若提取失败，原样返回输入 URL。
 */
function extractBingRealUrl(bingUrl: string): string {
  try {
    const parsed = new URL(bingUrl);
    const u = parsed.searchParams.get("u");
    if (u?.startsWith("a1")) {
      const b64 = u.slice(2).replace(/-/g, "+").replace(/_/g, "/");
      const decoded = Buffer.from(b64, "base64").toString("utf-8");
      if (decoded.startsWith("http")) return decoded;
    }
  } catch {
    // 解析失败，fallthrough
  }
  return bingUrl;
}

// ====== 搜索结果解析器 ======

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

/**
 * 解析 Bing CN (ensearch=1) 搜索结果。
 * 结构：`<h2><a href="URL">Title</a></h2>` + `<div class="b_caption"><p...>snippet</p>`
 * href 可能包含 HTML 实体（&amp;）需要解码。
 */
function parseBingResults(html: string, max = WEB_SEARCH_MAX_RESULTS): SearchResult[] {
  const results: SearchResult[] = [];
  const titleRegex =
    /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/gi;

  let m: RegExpExecArray | null;
  while ((m = titleRegex.exec(html)) !== null && results.length < max) {
    const rawUrl = decodeHtmlEntities(m[1]);
    const title = stripHtml(m[2]).trim();
    if (!title || rawUrl.startsWith("#") || rawUrl.startsWith("javascript")) {
      continue;
    }

    // 从 Bing 追踪 URL 中提取真实目标 URL
    const realUrl = rawUrl.includes("bing.com/ck/")
      ? extractBingRealUrl(rawUrl)
      : rawUrl;

    // 摘要：在 title 后的第一个 <p>...</p>
    const afterTitle = html.slice(
      m.index + m[0].length,
      m.index + m[0].length + 800,
    );
    const pMatch = afterTitle.match(/<p[^>]*>([\s\S]*?)<\/p>/);
    const snippet = pMatch ? stripHtml(pMatch[1]).trim().slice(0, 200) : "";

    results.push({ title, url: realUrl, snippet });
  }

  return results;
}

/**
 * 解析百度搜索结果。
 * 百度 HTML 使用 `<h3 class="t"><a>` 结构，URL 是百度重定向链接（会跳转到真实页面）。
 */
function parseBaiduResults(html: string, max = WEB_SEARCH_MAX_RESULTS): SearchResult[] {
  const results: SearchResult[] = [];
  // 百度结果：<h3 class="c-title t"><a ...>Title</a></h3>
  const titleRegex =
    /<h3[^>]*class="[^"]*\bt\b[^"]*"[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;

  let m: RegExpExecArray | null;
  while ((m = titleRegex.exec(html)) !== null && results.length < max) {
    const url = decodeHtmlEntities(m[1]);
    const title = stripHtml(m[2]).trim();
    if (!title || url.startsWith("#")) continue;

    // 摘要：后续的 .c-abstract 或 .c-span9
    const afterTitle = html.slice(
      m.index + m[0].length,
      m.index + m[0].length + 1000,
    );
    const snippetMatch = afterTitle.match(
      /class="[^"]*c-abstract[^"]*"[^>]*>([\s\S]*?)<\/(?:span|div|p)>/,
    );
    const snippet = snippetMatch
      ? stripHtml(snippetMatch[1]).trim().slice(0, 200)
      : "";

    results.push({ title, url, snippet });
  }

  return results;
}

/** 格式化搜索结果为模型友好的文本 */
function formatResults(results: SearchResult[], source: string): string {
  if (results.length === 0) {
    return `[web_search] ${source} 未返回可解析的结果。请尝试用 web_fetch 直接访问新闻网站。`;
  }
  const lines = results.map(
    (r, i) =>
      `[${i + 1}] ${r.title}\n    URL: ${r.url}${r.snippet ? `\n    ${r.snippet}` : ""}`,
  );
  return `搜索来源: ${source}\n\n` + lines.join("\n\n");
}

// ====== web_search 工具 ======

/**
 * 检测字符串是否主要为中文（判断标准：中文字符占比 > 30%）。
 */
function isMostlyChinese(text: string): boolean {
  const cjkCount = (text.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjkCount / text.length > 0.3;
}

/**
 * 搜索工具入口。根据查询语言自动选择搜索后端：
 *   - 中文查询 → 百度（返回直接 URL，中文内容）
 *   - 英文/混合查询 → Bing CN ensearch=1（英文国际新闻，Bing 重定向 URL）
 *
 * 两类重定向 URL 均可被 web_fetch 跟随。
 */
export async function executeWebSearch(query: string): Promise<string> {
  if (!query.trim()) return "[web_search error] 查询关键词不能为空。";

  const q = query.trim();
  const encoded = encodeURIComponent(q);
  const useBaidu = isMostlyChinese(q);

  const [searchUrl, source, parser]: [string, string, (h: string) => SearchResult[]] =
    useBaidu
      ? [
          `https://www.baidu.com/s?wd=${encoded}&ie=utf-8`,
          "百度",
          (h) => parseBaiduResults(h),
        ]
      : [
          `https://cn.bing.com/search?q=${encoded}&mkt=zh-CN&ensearch=1`,
          "Bing",
          (h) => parseBingResults(h),
        ];

  try {
    const resp = await fetch(searchUrl, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: useBaidu ? "https://www.baidu.com/" : "https://cn.bing.com/",
      },
      signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!resp.ok) {
      return `[web_search error] ${source} HTTP ${resp.status} ${resp.statusText}。请尝试 web_fetch 直接访问新闻 URL。`;
    }

    const html = await resp.text();
    const results = parser(html);
    return formatResults(results, source);
  } catch (err: unknown) {
    return `[web_search error] ${source}: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ====== web_fetch 工具 ======

/**
 * 抓取指定 URL 的文本内容（HTML 自动清洗、长度截断）。
 * 适合读取特定文章/新闻页面的完整正文。
 * 直接搜索请优先使用 web_search。
 */
export async function executeWebFetch(
  url: string,
  maxChars = WEB_FETCH_MAX_CHARS,
): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `[web_fetch error] 无效 URL: ${url}`;
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    return `[web_fetch error] 不支持的协议: ${parsed.protocol}`;
  }

  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": BROWSER_UA,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7",
        Referer: "https://www.google.com/",
      },
      signal: AbortSignal.timeout(WEB_FETCH_TIMEOUT_MS),
      redirect: "follow",
    });

    if (!resp.ok) {
      return (
        `[web_fetch error] HTTP ${resp.status} ${resp.statusText} — ${url}\n` +
        `该网站可能拒绝服务端爬取。请跳过此 URL，改用 web_search 搜索关键词，或尝试其他可公开访问的 URL。`
      );
    }

    const contentType = resp.headers.get("content-type") ?? "";
    const raw = await resp.text();

    const text = contentType.includes("html")
      ? stripHtml(raw)
      : raw.replace(/\s+/g, " ").trim();

    if (text.length < 100) {
      return (
        `[web_fetch] 返回内容过短（${text.length} 字符），可能被重定向到验证页面。\n` +
        `内容: ${text}\n建议改用 web_search 搜索相关关键词。`
      );
    }

    return text.length > maxChars
      ? text.slice(0, maxChars) + "\n...[内容已截断]"
      : text;
  } catch (err: unknown) {
    return `[web_fetch error] ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ====== read 工具 ======

const READ_MAX_CHARS = 256_000;

/**
 * 读取本地文件内容。
 * 安全限制：只允许读取用户家目录（~/）或 workspaceDir 内的文件，
 * 防止读取系统文件。
 */
export async function executeRead(
  filePath: string,
  context?: ToolExecutionContext,
): Promise<string> {
  if (!filePath.trim()) return "[read error] 路径不能为空。";

  // 展开 ~/
  const expanded =
    filePath === "~"
      ? os.homedir()
      : filePath.startsWith("~/") || filePath.startsWith("~\\")
        ? path.join(os.homedir(), filePath.slice(2))
        : filePath;

  const normalized = path.normalize(expanded);
  const home = os.homedir();

  // 安全检查：路径必须在家目录或 workspaceDir 内
  const underHome =
    normalized === home || normalized.startsWith(home + path.sep);
  const underWorkspace = context?.workspaceDir
    ? normalized.startsWith(path.normalize(context.workspaceDir) + path.sep) ||
      normalized === path.normalize(context.workspaceDir)
    : false;

  if (!underHome && !underWorkspace) {
    return `[read error] 出于安全限制，只允许读取家目录或工作区内的文件: ${filePath}`;
  }

  // 检查路径是否存在
  let stat: fs.Stats;
  try {
    stat = fs.statSync(normalized);
  } catch {
    return `[read error] 文件不存在: ${filePath}`;
  }

  if (stat.isDirectory()) {
    // 目录：列出子项
    try {
      const entries = fs.readdirSync(normalized, { withFileTypes: true });
      const lines = entries.map(
        (e) => `${e.isDirectory() ? "d" : "f"}  ${e.name}`,
      );
      return `目录: ${normalized}\n\n${lines.join("\n")}`;
    } catch (err) {
      return `[read error] 无法列出目录: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  // 文件：读取内容
  try {
    const content = fs.readFileSync(normalized, "utf-8");
    return content.length > READ_MAX_CHARS
      ? content.slice(0, READ_MAX_CHARS) + "\n...[内容已截断]"
      : content;
  } catch (err) {
    return `[read error] ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ====== 统一工具分发 ======

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
  context?: ToolExecutionContext,
): Promise<string> {
  switch (name) {
    case "web_fetch":
      return executeWebFetch(String(args["url"] ?? ""));
    case "web_search":
      return executeWebSearch(String(args["query"] ?? ""));
    case "read":
      return executeRead(String(args["path"] ?? ""), context);
    default:
      return `[tool error] 未知工具: ${name}`;
  }
}
