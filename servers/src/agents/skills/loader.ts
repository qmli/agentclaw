import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type {
  Skill,
  SkillEntry,
  SkillSource,
  ParsedSkillFrontmatter,
  OpenClawSkillMetadata,
  SkillInvocationPolicy,
  SkillLimits,
  LoadSkillsOptions,
  SkillsConfig,
} from "./types.js";

// ====== 默认限额 ======

export const DEFAULT_LIMITS: SkillLimits = {
  maxCandidatesPerRoot: 300,
  maxSkillsLoadedPerSource: 200,
  maxSkillsInPrompt: 150,
  maxSkillsPromptChars: 30_000,
  maxSkillFileBytes: 256_000,
};

// ====== Frontmatter 解析 ======

/**
 * 解析 SKILL.md 的 YAML frontmatter。
 * 仅支持技能文件中实际使用的常见格式，不追求通用性。
 */
export function parseFrontmatter(
  content: string,
): ParsedSkillFrontmatter | null {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return null;
  return parseYamlLike(match[1]) as unknown as ParsedSkillFrontmatter;
}

/** 简单的 YAML-like 解析器（对技能 frontmatter 格式定制） */
function parseYamlLike(yaml: string): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const lines = yaml.split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const keyMatch = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)/);
    if (!keyMatch) {
      i++;
      continue;
    }

    const key = keyMatch[1];
    const rest = keyMatch[2].trim();

    // 多行折叠字符串（| 字面块）
    if (rest === "|") {
      const baseIndent = (line.match(/^(\s*)/)?.[1].length ?? 0) + 2;
      const bodyLines: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === "" || next.startsWith(" ".repeat(baseIndent))) {
          bodyLines.push(next.slice(baseIndent));
          i++;
        } else {
          break;
        }
      }
      result[key] = bodyLines.join("\n").trimEnd();
      continue;
    }

    // 内联 JSON 对象 { ... }
    if (rest.startsWith("{")) {
      try {
        result[key] = JSON.parse(rest);
      } catch {
        result[key] = rest;
      }
      i++;
      continue;
    }

    // 内联数组 [a, b]
    if (rest.startsWith("[")) {
      try {
        result[key] = JSON.parse(rest.replace(/'/g, '"'));
      } catch {
        result[key] = rest
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      }
      i++;
      continue;
    }

    // 缩进子块（值为空）
    if (rest === "") {
      const baseIndent = (line.match(/^(\s*)/)?.[1].length ?? 0) + 2;
      const nested: string[] = [];
      i++;
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim() === "" || next.startsWith(" ".repeat(baseIndent))) {
          nested.push(next);
          i++;
        } else {
          break;
        }
      }
      if (nested.length > 0) {
        result[key] = parseYamlBlock(nested);
      }
      continue;
    }

    // Boolean
    if (rest === "true") {
      result[key] = true;
      i++;
      continue;
    }
    if (rest === "false") {
      result[key] = false;
      i++;
      continue;
    }
    if (rest === "null") {
      result[key] = null;
      i++;
      continue;
    }

    // 数字
    const num = Number(rest);
    if (rest !== "" && !isNaN(num)) {
      result[key] = num;
      i++;
      continue;
    }

    // 普通字符串（可能跨行折叠）
    let value = rest.replace(/^['"]|['"]$/g, "");
    while (i + 1 < lines.length) {
      const next = lines[i + 1];
      // 缩进延续行（无冒号 key）
      if (next.match(/^\s+\S/) && !next.match(/^\s+[a-zA-Z0-9_-]+:/)) {
        value += " " + next.trim();
        i++;
      } else {
        break;
      }
    }
    result[key] = value;
    i++;
  }

  return result;
}

/** 解析缩进块（列表或对象） */
function parseYamlBlock(lines: string[]): unknown {
  const nonempty = lines.filter((l) => l.trim() !== "");
  if (nonempty.length === 0) return null;

  const firstIndent = nonempty[0].match(/^(\s*)/)?.[1].length ?? 0;
  const firstTrimmed = nonempty[0].trimStart();

  // 列表块
  if (firstTrimmed.startsWith("- ") || firstTrimmed === "-") {
    const items: unknown[] = [];
    let currentItem: Record<string, unknown> | null = null;

    for (const line of nonempty) {
      const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0;
      const content = line.trimStart();

      if (lineIndent === firstIndent && content.startsWith("- ")) {
        if (currentItem) items.push(currentItem);
        currentItem = null;
        const inner = content.slice(2).trim();
        if (inner.includes(":")) {
          currentItem = {};
          const colonIdx = inner.indexOf(":");
          const k = inner.slice(0, colonIdx).trim();
          const v = inner
            .slice(colonIdx + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          (currentItem as Record<string, unknown>)[k] = v === "" ? true : v;
        } else {
          items.push(inner.replace(/^['"]|['"]$/g, ""));
        }
      } else if (currentItem && content.includes(":")) {
        const colonIdx = content.indexOf(":");
        const k = content.slice(0, colonIdx).trim();
        const v = content
          .slice(colonIdx + 1)
          .trim()
          .replace(/^['"]|['"]$/g, "");
        (currentItem as Record<string, unknown>)[k] =
          v === "true" ? true : v === "false" ? false : v === "" ? true : v;
      }
    }
    if (currentItem) items.push(currentItem);
    return items;
  }

  // 对象块
  const obj: Record<string, unknown> = {};
  for (const line of nonempty) {
    const content = line.trimStart();
    if (content.startsWith("#")) continue;
    const colonIdx = content.indexOf(":");
    if (colonIdx === -1) continue;
    const k = content.slice(0, colonIdx).trim();
    const v = content.slice(colonIdx + 1).trim();

    if (v.startsWith("[")) {
      try {
        obj[k] = JSON.parse(v.replace(/'/g, '"'));
      } catch {
        obj[k] = v
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((s) => s.trim().replace(/^['"]|['"]$/g, ""));
      }
    } else if (v === "true") {
      obj[k] = true;
    } else if (v === "false") {
      obj[k] = false;
    } else {
      obj[k] = v.replace(/^['"]|['"]$/g, "");
    }
  }
  return obj;
}

// ====== 元数据 & 策略解析 ======

/** 从 frontmatter 提取 OpenClawSkillMetadata */
export function resolveOpenClawMetadata(
  frontmatter: ParsedSkillFrontmatter,
): OpenClawSkillMetadata | undefined {
  return frontmatter.metadata?.openclaw;
}

/** 解析调用策略 */
export function resolveSkillInvocationPolicy(
  frontmatter: ParsedSkillFrontmatter,
): SkillInvocationPolicy {
  return {
    userInvocable: frontmatter["user-invocable"] !== false,
    disableModelInvocation: frontmatter["disable-model-invocation"] === true,
  };
}

// ====== 文件系统工具 ======

/** 列出目录的直接子目录 */
export function listChildDirectories(dir: string): string[] {
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => path.join(dir, d.name));
  } catch {
    return [];
  }
}

/** 检查单个 SKILL.md 文件大小是否在限额内 */
function isFileSizeAllowed(filePath: string, maxBytes: number): boolean {
  try {
    return fs.statSync(filePath).size <= maxBytes;
  } catch {
    return false;
  }
}

/**
 * 安全性检查：防止符号链接逃逸。
 * 使用 realpathSync 解析真实路径后验证 targetPath 必须在 root 内部。
 */
export function isPathInsideRoot(targetPath: string, root: string): boolean {
  try {
    const realTarget = fs.realpathSync(targetPath);
    const realRoot = fs.realpathSync(root);
    return (
      realTarget === realRoot || realTarget.startsWith(realRoot + path.sep)
    );
  } catch {
    return false;
  }
}

// ====== 核心加载函数 ======

/**
 * 从单个目录加载技能列表（每个子目录对应一个技能）。
 * 应用文件大小检查、符号链接安全检查和数量限额。
 */
export function loadSkillsFromDir(
  dir: string,
  source: SkillSource,
  limits: SkillLimits,
): Skill[] {
  const skills: Skill[] = [];
  let dirs = listChildDirectories(dir).sort(); // 字母排序保证截断的一致性
  dirs = dirs.slice(0, limits.maxCandidatesPerRoot);

  for (const skillDir of dirs) {
    const skillFile = path.join(skillDir, "SKILL.md");

    if (!fs.existsSync(skillFile)) continue;

    if (!isFileSizeAllowed(skillFile, limits.maxSkillFileBytes)) {
      console.warn(`[skills] SKILL.md 文件过大，跳过: ${skillFile}`);
      continue;
    }

    if (!isPathInsideRoot(skillDir, dir)) {
      console.warn(`[skills] 检测到符号链接逃逸，跳过: ${skillDir}`);
      continue;
    }

    let content: string;
    try {
      content = fs.readFileSync(skillFile, "utf-8");
    } catch {
      continue;
    }

    const fm = parseFrontmatter(content);
    if (!fm?.name || !fm?.description) {
      console.warn(
        `[skills] frontmatter 缺少 name/description，跳过: ${skillFile}`,
      );
      continue;
    }

    skills.push({
      name: fm.name,
      description: fm.description,
      filePath: skillFile,
      baseDir: skillDir,
      source,
    });

    if (skills.length >= limits.maxSkillsLoadedPerSource) {
      console.warn(
        `[skills] 来源 "${source}" 达到最大技能数 (${limits.maxSkillsLoadedPerSource})，已截断`,
      );
      break;
    }
  }

  return skills;
}

/**
 * 启发式检测嵌套 skills 根目录。
 * 若 dir/skills/xxx/SKILL.md 存在，则真正的根是 dir/skills/。
 */
export function resolveNestedSkillsRoot(dir: string): string {
  const nested = path.join(dir, "skills");
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    const subDirs = listChildDirectories(nested);
    if (subDirs.some((sub) => fs.existsSync(path.join(sub, "SKILL.md")))) {
      return nested;
    }
  }
  return dir;
}

/** 将 Skill 包装成完整的 SkillEntry（重新读取并解析 frontmatter） */
function toSkillEntry(skill: Skill): SkillEntry | null {
  let content: string;
  try {
    content = fs.readFileSync(skill.filePath, "utf-8");
  } catch {
    return null;
  }

  const frontmatter = parseFrontmatter(content);
  if (!frontmatter) return null;

  return {
    skill,
    frontmatter,
    metadata: resolveOpenClawMetadata(frontmatter),
    invocation: resolveSkillInvocationPolicy(frontmatter),
  };
}

/**
 * 按优先级加载并合并所有来源的技能，返回 SkillEntry 列表。
 *
 * 优先级（低 → 高）：
 *   extra < bundled < managed < personal < project < workspace
 *
 * 同名技能后加载的来源覆盖先加载的（Map.set 策略）。
 */
export function loadSkillEntries(options: LoadSkillsOptions): SkillEntry[] {
  const config: SkillsConfig = options.config ?? {};
  const limits: SkillLimits = { ...DEFAULT_LIMITS, ...(config.limits ?? {}) };

  const sources: Array<{ dir: string; source: SkillSource }> = [];

  // 优先级 1 (最低)：配置文件指定的额外目录
  for (const dir of config.load?.extraDirs ?? []) {
    sources.push({ dir, source: "openclaw-extra" });
  }

  // 优先级 1：调用方传入的额外目录（如插件目录 extensions/*/skills）
  for (const dir of options.extraDirs ?? []) {
    sources.push({ dir, source: "openclaw-extra" });
  }

  // 优先级 2：内置技能目录（可通过环境变量覆盖，方便开发测试）
  const bundledDir =
    process.env["OPENCLAW_BUNDLED_SKILLS_DIR"] ??
    path.resolve(process.cwd(), "skills");
  sources.push({ dir: bundledDir, source: "openclaw-bundled" });

  // 优先级 3：managed 技能 (~/.openclaw/skills)
  sources.push({
    dir: path.join(os.homedir(), ".openclaw", "skills"),
    source: "openclaw-managed",
  });

  // 优先级 4：个人 agents 技能 (~/.agents/skills)
  sources.push({
    dir: path.join(os.homedir(), ".agents", "skills"),
    source: "agents-skills-personal",
  });

  if (options.workspaceDir) {
    // 优先级 5：项目级 agents 技能 (<workspace>/.agents/skills)
    sources.push({
      dir: path.join(options.workspaceDir, ".agents", "skills"),
      source: "agents-skills-project",
    });

    // 优先级 6 (最高)：工作区技能 (<workspace>/skills 或 <workspace>)
    const wsSkillsDir = resolveNestedSkillsRoot(options.workspaceDir);
    sources.push({ dir: wsSkillsDir, source: "openclaw-workspace" });
  }

  // 按优先级依次合并，同名技能后者覆盖前者
  const merged = new Map<string, Skill>();
  for (const { dir, source } of sources) {
    for (const skill of loadSkillsFromDir(dir, source, limits)) {
      merged.set(skill.name, skill);
    }
  }

  // 转换为 SkillEntry[]（二次读取解析 frontmatter）
  const entries: SkillEntry[] = [];
  for (const skill of merged.values()) {
    const entry = toSkillEntry(skill);
    if (entry) entries.push(entry);
  }

  return entries;
}
