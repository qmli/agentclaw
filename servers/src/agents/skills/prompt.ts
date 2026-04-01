import os from "node:os";
import path from "node:path";
import type {
  SkillEntry,
  SkillLimits,
  SkillSnapshot,
  SkillCommandSpec,
} from "./types.js";

// ====== 路径压缩（Token 优化） ======

/** 将绝对路径中的家目录前缀替换为 ~/（节省约 5-6 token/路径） */
function compactPath(filePath: string): string {
  const home = os.homedir();
  if (filePath.startsWith(home + path.sep) || filePath === home) {
    return "~" + filePath.slice(home.length).replace(/\\/g, "/");
  }
  // 统一使用正斜杠（跨平台一致性）
  return filePath.replace(/\\/g, "/");
}

// ====== XML 安全转义 ======

/** 转义 XML 属性中的特殊字符 */
function escapeXmlAttr(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ====== 技能列表格式化 ======

/** 将单个技能格式化为 <skill .../> XML 元素 */
function formatSkillElement(entry: SkillEntry): string {
  const name = escapeXmlAttr(entry.skill.name);
  const description = escapeXmlAttr(entry.skill.description);
  const location = escapeXmlAttr(compactPath(entry.skill.filePath));
  return `  <skill\n    name="${name}"\n    description="${description}"\n    location="${location}"\n  />`;
}

/** 将技能列表格式化为 <available_skills> XML 块 */
export function formatSkillsForPrompt(entries: SkillEntry[]): string {
  if (entries.length === 0) return "";
  const elements = entries.map(formatSkillElement).join("\n");
  return `<available_skills>\n${elements}\n</available_skills>`;
}

// ====== 限额处理 ======

/**
 * 应用数量和字符预算限额：
 *   1. 按数量截断（maxSkillsInPrompt）
 *   2. 按字符预算截断（二分查找，maxSkillsPromptChars）
 */
export function applySkillsPromptLimits(
  entries: SkillEntry[],
  limits: SkillLimits,
): SkillEntry[] {
  // 数量截断
  let candidate = entries.slice(0, limits.maxSkillsInPrompt);
  if (candidate.length < entries.length) {
    console.warn(
      `[skills] 已按数量截断: 包含 ${candidate.length} / ${entries.length} 个技能`,
    );
  }

  // 字符预算截断（二分查找找到最大可装入的前缀）
  const fits = (subset: SkillEntry[]): boolean =>
    formatSkillsForPrompt(subset).length <= limits.maxSkillsPromptChars;

  if (!fits(candidate)) {
    let lo = 0;
    let hi = candidate.length;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (fits(candidate.slice(0, mid))) lo = mid;
      else hi = mid - 1;
    }
    const before = candidate.length;
    candidate = candidate.slice(0, lo);
    console.warn(
      `[skills] 已按字符预算截断: 包含 ${candidate.length} / ${before} 个技能`,
    );
  }

  return candidate;
}

// ====== System Prompt 构建 ======

/**
 * 构建 ## Skills (mandatory) 段落文本数组，注入完整 system prompt。
 *
 * @param skillsPrompt  formatSkillsForPrompt() 输出的 available_skills 文本
 * @param readToolName  读取文件的工具名（默认 "read"）
 */
export function buildSkillsSection(
  skillsPrompt: string,
  readToolName = "read",
): string[] {
  if (!skillsPrompt.trim()) return [];

  return [
    "## Skills (mandatory)",
    "Before replying: scan <available_skills> <description> entries.",
    `- If exactly one skill clearly applies: read its SKILL.md at <location> with \`${readToolName}\`, then follow it.`,
    "- If multiple could apply: choose the most specific one, then read/follow it.",
    "- If none clearly apply: do not read any SKILL.md.",
    "Constraints: never read more than one skill up front; only read after selecting.",
    "- When a skill drives external API writes, assume rate limits: prefer fewer larger writes, avoid tight loops.",
    skillsPrompt,
    "",
  ];
}

/**
 * 从 SkillSnapshot 中取技能段落文本（无快照时返回空字符串）。
 * 用于每次 agent 回合构建 system prompt。
 */
export function resolveSkillsPromptForRun(snapshot?: SkillSnapshot): string {
  return snapshot?.prompt ?? "";
}

/**
 * 将过滤后的技能条目构建为可注入 system prompt 的文本（含限额处理）。
 * 即 loadSkillEntries → filterSkillEntries → buildWorkspaceSkillsPrompt 管线的最后一步。
 */
export function buildWorkspaceSkillsPrompt(
  entries: SkillEntry[],
  limits: SkillLimits,
): string {
  const limited = applySkillsPromptLimits(entries, limits);
  return formatSkillsForPrompt(limited);
}

// ====== 斜杠命令规格构建 ======

/** 将技能名 sanitize 为合法的斜杠命令名（小写字母、数字、连字符） */
function sanitizeCommandName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** 截断描述到 ≤100 个字符（Discord / Slash command 规格） */
function truncateDescription(desc: string, maxLen = 100): string {
  if (desc.length <= maxLen) return desc;
  return desc.slice(0, maxLen - 1) + "…";
}

/**
 * 从技能条目列表构建斜杠命令规格列表。
 * 仅处理 invocation.userInvocable = true 的技能。
 */
export function buildWorkspaceSkillCommandSpecs(
  entries: SkillEntry[],
): SkillCommandSpec[] {
  const specs: SkillCommandSpec[] = [];

  for (const entry of entries) {
    if (entry.invocation?.userInvocable === false) continue;

    const fm = entry.frontmatter;
    const spec: SkillCommandSpec = {
      name: sanitizeCommandName(entry.skill.name),
      skillName: entry.skill.name,
      description: truncateDescription(entry.skill.description),
    };

    // 斜杠命令直接派发到 tool
    if (fm["command-dispatch"] === "tool" && fm["command-tool"]) {
      spec.dispatch = {
        kind: "tool",
        toolName: fm["command-tool"],
        ...(fm["command-arg-mode"] ? { argMode: fm["command-arg-mode"] } : {}),
      };
    }

    specs.push(spec);
  }

  return specs;
}
