import type { SkillSnapshot, LoadSkillsOptions } from "./types.js";
import { DEFAULT_LIMITS } from "./loader.js";
import { loadSkillEntries } from "./loader.js";
import { filterSkillEntries } from "./filter.js";
import { buildWorkspaceSkillsPrompt } from "./prompt.js";

// ====== 版本管理 ======

/**
 * 全局版本号（进程级别，重启后归零）。
 * 文件系统 watcher 检测到 SKILL.md 变更时通过 incrementSkillsSnapshotVersion() 递增。
 */
let currentVersion = 0;

/** 获取当前技能快照版本号 */
export function getSkillsSnapshotVersion(): number {
  return currentVersion;
}

/**
 * 递增版本号，触发所有后续 ensureSkillSnapshot() 调用重建快照。
 * 通常由文件系统 watcher（refresh.ts）在检测到 SKILL.md 变更时调用。
 */
export function incrementSkillsSnapshotVersion(): void {
  currentVersion++;
}

// ====== 串行化锁 ======

/**
 * 按 workspaceDir 串行化的构建锁 Map。
 * 确保同一工作区的快照不会被并发重建（防止多个 agent 回合同时触发）。
 */
const buildLocks = new Map<string, Promise<SkillSnapshot>>();

// ====== 快照选项 ======

export interface BuildSnapshotOptions extends LoadSkillsOptions {
  /** agent 级别的技能白名单（仅包含列表中的技能） */
  skillFilter?: string[];
}

// ====== 核心构建函数 ======

/**
 * 构建工作区技能快照。
 *
 * 完整流程：
 *   loadSkillEntries()
 *   → filterSkillEntries()（资格判定）
 *   → skillFilter（agent 白名单）
 *   → 剔除 disableModelInvocation=true（不注入 prompt）
 *   → buildWorkspaceSkillsPrompt()（含限额截断）
 *   → 组装 SkillSnapshot
 */
export async function buildWorkspaceSkillSnapshot(
  workspaceDir: string,
  options: BuildSnapshotOptions = {},
): Promise<SkillSnapshot> {
  const config = options.config ?? {};
  const limits = { ...DEFAULT_LIMITS, ...(config.limits ?? {}) };

  // 1. 加载所有来源的技能条目
  const allEntries = loadSkillEntries({ ...options, workspaceDir });

  // 2. 过滤：资格判定（OS / bins / env / config）
  const eligible = filterSkillEntries(allEntries, config);

  // 3. agent 级别的技能白名单过滤（可选）
  const filtered = options.skillFilter
    ? eligible.filter((e) => options.skillFilter!.includes(e.skill.name))
    : eligible;

  // 4. 排除 disableModelInvocation=true 的技能（不注入 prompt，但保留在 resolvedSkills）
  const promptEntries = filtered.filter(
    (e) => e.invocation?.disableModelInvocation !== true,
  );

  // 5. 构建 prompt 文本
  const prompt = buildWorkspaceSkillsPrompt(promptEntries, limits);

  return {
    prompt,
    skills: filtered.map((e) => ({
      name: e.skill.name,
      primaryEnv: e.metadata?.primaryEnv,
      requiredEnv: e.metadata?.requires?.env,
    })),
    skillFilter: options.skillFilter,
    resolvedSkills: filtered.map((e) => e.skill),
    version: currentVersion,
  };
}

/**
 * 确保技能快照是最新的（与当前版本一致时直接复用，否则重建）。
 * 同一 workspaceDir 的重建操作通过 Promise 锁串行化，防止并发重复构建。
 *
 * @param workspaceDir     工作区目录
 * @param currentSnapshot  session 中已有的快照（可能为 undefined）
 * @param options          构建选项
 */
export async function ensureSkillSnapshot(
  workspaceDir: string,
  currentSnapshot: SkillSnapshot | undefined,
  options: BuildSnapshotOptions = {},
): Promise<SkillSnapshot> {
  // 版本一致，直接复用
  if (currentSnapshot && currentSnapshot.version === currentVersion) {
    return currentSnapshot;
  }

  // 如果当前 workspaceDir 已有正在进行的构建，等待并复用其结果
  const existing = buildLocks.get(workspaceDir);
  if (existing) return existing;

  // 发起新的构建，注册锁，完成后自动释放
  const buildPromise = buildWorkspaceSkillSnapshot(
    workspaceDir,
    options,
  ).finally(() => buildLocks.delete(workspaceDir));

  buildLocks.set(workspaceDir, buildPromise);
  return buildPromise;
}
