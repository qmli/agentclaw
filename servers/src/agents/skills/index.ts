// ====== OpenClaw Skills 系统公共 API ======
// 对外暴露技能系统的全部核心能力：加载 → 过滤 → 快照 → Prompt 注入

// 类型定义
export type {
  Skill,
  SkillSource,
  SkillEntry,
  SkillSnapshot,
  SkillInvocationPolicy,
  SkillCommandSpec,
  SkillInstallSpec,
  SkillInstallKind,
  OpenClawSkillMetadata,
  ParsedSkillFrontmatter,
  SkillLimits,
  SkillsConfig,
  SkillEntryConfig,
  LoadSkillsOptions,
} from "./types.js";

// 加载管线
export {
  DEFAULT_LIMITS,
  parseFrontmatter,
  resolveOpenClawMetadata,
  resolveSkillInvocationPolicy,
  listChildDirectories,
  isPathInsideRoot,
  loadSkillsFromDir,
  resolveNestedSkillsRoot,
  loadSkillEntries,
} from "./loader.js";

// 过滤 & 资格判定
export {
  evaluateRuntimeEligibility,
  resolveSkillKey,
  shouldIncludeSkill,
  filterSkillEntries,
  clearBinCheckCache,
} from "./filter.js";
export type {
  RuntimeEligibilityOpts,
  ShouldIncludeSkillOpts,
} from "./filter.js";

// System Prompt 构建
export {
  formatSkillsForPrompt,
  applySkillsPromptLimits,
  buildSkillsSection,
  resolveSkillsPromptForRun,
  buildWorkspaceSkillsPrompt,
  buildWorkspaceSkillCommandSpecs,
} from "./prompt.js";

// 快照管理
export {
  getSkillsSnapshotVersion,
  incrementSkillsSnapshotVersion,
  buildWorkspaceSkillSnapshot,
  ensureSkillSnapshot,
} from "./snapshot.js";
export type { BuildSnapshotOptions } from "./snapshot.js";
