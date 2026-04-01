import { execSync } from "node:child_process";
import type {
  SkillEntry,
  SkillsConfig,
  SkillEntryConfig,
  OpenClawSkillMetadata,
} from "./types.js";

// ====== 二进制检查（带缓存） ======

/** 缓存二进制检查结果，避免重复 PATH 查找 */
const binCheckCache = new Map<string, boolean>();

/** 检查可执行文件是否在系统 PATH 中 */
function hasBinary(bin: string): boolean {
  const cached = binCheckCache.get(bin);
  if (cached !== undefined) return cached;

  try {
    const cmd =
      process.platform === "win32" ? `where "${bin}"` : `which "${bin}"`;
    execSync(cmd, { stdio: "pipe" });
    binCheckCache.set(bin, true);
    return true;
  } catch {
    binCheckCache.set(bin, false);
    return false;
  }
}

/** 清除二进制检查缓存（测试或重新检测时使用） */
export function clearBinCheckCache(): void {
  binCheckCache.clear();
}

// ====== 运行时资格评估 ======

export interface RuntimeEligibilityOpts {
  os?: string[];
  always?: boolean;
  requires?: OpenClawSkillMetadata["requires"];
  hasBin: (bin: string) => boolean;
  hasEnv: (envName: string) => boolean;
  isConfigPathTruthy: (configPath: string) => boolean;
}

/**
 * 评估技能的运行时资格。
 *   1. OS 平台检查
 *   2. always = true 时跳过后续检查
 *   3. bins（全部必须存在）
 *   4. anyBins（任一存在即可）
 *   5. env（环境变量）
 *   6. config（配置路径 truthy）
 */
export function evaluateRuntimeEligibility(
  opts: RuntimeEligibilityOpts,
): boolean {
  const { os: requiredOs, always, requires } = opts;

  // OS 检查
  if (requiredOs && requiredOs.length > 0) {
    if (!requiredOs.includes(process.platform)) return false;
  }

  // always = true：跳过后续所有检查
  if (always) return true;

  if (!requires) return true;

  // 必须全部存在的 bins
  for (const bin of requires.bins ?? []) {
    if (!opts.hasBin(bin)) return false;
  }

  // anyBins：任一存在即可
  const anyBins = requires.anyBins ?? [];
  if (anyBins.length > 0 && !anyBins.some((bin) => opts.hasBin(bin))) {
    return false;
  }

  // 必须存在的环境变量
  for (const envName of requires.env ?? []) {
    if (!opts.hasEnv(envName)) return false;
  }

  // 必须为 truthy 的配置路径
  for (const configPath of requires.config ?? []) {
    if (!opts.isConfigPathTruthy(configPath)) return false;
  }

  return true;
}

// ====== 配置辅助函数 ======

/** 解析技能的配置 key（优先使用 metadata.skillKey，否则用 name） */
export function resolveSkillKey(entry: SkillEntry): string {
  return entry.metadata?.skillKey ?? entry.skill.name;
}

/** 从 SkillsConfig 中获取单个技能的配置条目 */
function resolveSkillConfig(
  config: SkillsConfig,
  skillKey: string,
): SkillEntryConfig | undefined {
  return config.entries?.[skillKey];
}

/**
 * 检查内置技能（openclaw-bundled）是否在 allowBundled 白名单内。
 * 非内置来源的技能不受此限制。
 * 未配置 allowBundled = 所有内置技能均可用。
 */
function isBundledSkillAllowed(
  entry: SkillEntry,
  allowBundled?: string[],
): boolean {
  if (entry.skill.source !== "openclaw-bundled") return true;
  if (!allowBundled) return true;
  return allowBundled.includes(entry.skill.name);
}

/**
 * 从 SkillsConfig 中按 dot notation 路径读取值。
 * 例如 "browser.enabled" 读取 config.browser.enabled。
 */
function getConfigValue(config: SkillsConfig, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cur: unknown = config;
  for (const part of parts) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

// ====== 过滤判定 ======

export interface ShouldIncludeSkillOpts {
  entry: SkillEntry;
  config: SkillsConfig;
}

/**
 * 判断是否应该在当前环境中包含某个技能。
 *
 * 判定顺序：
 *   1. config.entries[skillKey].enabled === false → 显式禁用
 *   2. bundled 白名单检查
 *   3. 运行时资格评估（OS / always / bins / anyBins / env / config）
 */
export function shouldIncludeSkill(opts: ShouldIncludeSkillOpts): boolean {
  const { entry, config } = opts;
  const skillKey = resolveSkillKey(entry);
  const skillConfig = resolveSkillConfig(config, skillKey);

  // 1. 显式禁用
  if (skillConfig?.enabled === false) return false;

  // 2. bundled 白名单
  if (!isBundledSkillAllowed(entry, config.allowBundled)) return false;

  // 3. 运行时资格评估
  return evaluateRuntimeEligibility({
    os: entry.metadata?.os,
    always: entry.metadata?.always,
    requires: entry.metadata?.requires,
    hasBin: hasBinary,
    hasEnv: (envName) =>
      Boolean(
        process.env[envName] ||
        skillConfig?.env?.[envName] ||
        // apiKey 配置时自动视为 primaryEnv 已注入
        (skillConfig?.apiKey && entry.metadata?.primaryEnv === envName),
      ),
    isConfigPathTruthy: (dotPath) => Boolean(getConfigValue(config, dotPath)),
  });
}

/**
 * 过滤技能列表，仅保留在当前环境中有资格运行的技能。
 */
export function filterSkillEntries(
  entries: SkillEntry[],
  config: SkillsConfig,
): SkillEntry[] {
  return entries.filter((entry) => shouldIncludeSkill({ entry, config }));
}
