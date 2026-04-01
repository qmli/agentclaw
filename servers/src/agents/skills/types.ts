// ====== Skills 系统核心类型定义 ======

/** 技能来源（优先级从低到高） */
export type SkillSource =
  | "openclaw-extra" // 配置文件指定的额外目录 / 插件目录（最低优先级）
  | "openclaw-bundled" // 随包内置技能
  | "openclaw-managed" // openclaw skills install 安装的技能
  | "agents-skills-personal" // 用户个人技能 (~/.agents/skills)
  | "agents-skills-project" // 项目级技能 (<workspace>/.agents/skills)
  | "openclaw-workspace"; // 工作区技能（最高优先级）

/** 技能基础对象 */
export interface Skill {
  /** 技能唯一标识名 */
  name: string;
  /** 技能描述（出现在 available_skills 列表） */
  description: string;
  /** SKILL.md 文件绝对路径 */
  filePath: string;
  /** 技能目录 */
  baseDir: string;
  /** 来源标识 */
  source: SkillSource;
}

// ====== 安装规范 ======

export type SkillInstallKind = "brew" | "node" | "go" | "uv" | "download";

export interface SkillInstallSpec {
  kind: SkillInstallKind;
  /** brew: 包名 */
  formula?: string;
  /** node / uv: 包名 */
  package?: string;
  /** go: module 路径 */
  module?: string;
  /** download: 下载地址 */
  url?: string;
  archive?: string;
  extract?: boolean;
  stripComponents?: number;
  targetDir?: string;
}

// ====== OpenClaw 专属元数据 ======

export interface OpenClawSkillMetadata {
  /** true = 始终包含，跳过 OS / env / bin 检查 */
  always?: boolean;
  /** 配置文件 key（默认等于 name） */
  skillKey?: string;
  /** 主环境变量名（配置 apiKey 时自动注入） */
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  /** 限定操作系统：["darwin", "linux", "win32"] */
  os?: string[];
  requires?: {
    /** 必须全部存在的可执行文件 */
    bins?: string[];
    /** 任一存在即可 */
    anyBins?: string[];
    /** 必须存在的环境变量 */
    env?: string[];
    /** 必须为 truthy 的配置路径（dot notation） */
    config?: string[];
    /** 依赖的 agent 工具（声明用，不做运行时检查） */
    tools?: string[];
  };
  install?: SkillInstallSpec[];
  /** 调用示例（文档用） */
  examples?: string[];
}

// ====== Frontmatter ======

/** 解析后的 SKILL.md YAML frontmatter */
export interface ParsedSkillFrontmatter {
  /** 技能唯一名称（必须） */
  name: string;
  /** 技能描述（必须） */
  description: string;
  /** 是否可通过 /命令名 调用（默认 true） */
  "user-invocable"?: boolean;
  /** 禁止模型主动调用（默认 false） */
  "disable-model-invocation"?: boolean;
  /** 斜杠命令派发模式 */
  "command-dispatch"?: "tool";
  /** 斜杠命令派发目标工具名 */
  "command-tool"?: string;
  /** 斜杠命令参数传递模式 */
  "command-arg-mode"?: "raw";
  metadata?: {
    openclaw?: OpenClawSkillMetadata;
  };
}

// ====== 策略 & 条目 ======

/** 技能调用策略 */
export interface SkillInvocationPolicy {
  userInvocable: boolean;
  disableModelInvocation: boolean;
}

/** 斜杠命令规格 */
export interface SkillCommandSpec {
  /** 斜杠命令名（sanitize 后的 skill.name） */
  name: string;
  /** 原始技能名 */
  skillName: string;
  /** 命令描述（≤100 个字符） */
  description: string;
  dispatch?: {
    kind: "tool";
    toolName: string;
    argMode?: "raw";
  };
}

/** 完整技能条目（内部数据结构） */
export interface SkillEntry {
  skill: Skill;
  frontmatter: ParsedSkillFrontmatter;
  /** OpenClaw 专属元数据（来自 frontmatter.metadata.openclaw） */
  metadata?: OpenClawSkillMetadata;
  /** 调用策略 */
  invocation?: SkillInvocationPolicy;
}

// ====== 快照 ======

/** 技能快照（存入 session，避免每次请求重新扫描文件系统） */
export interface SkillSnapshot {
  /** 格式化后的 available_skills 文本，直接注入 system prompt */
  prompt: string;
  skills: Array<{
    name: string;
    primaryEnv?: string;
    requiredEnv?: string[];
  }>;
  /** agent 级别的技能白名单过滤 */
  skillFilter?: string[];
  /** 完整 Skill 对象列表（含被 disableModelInvocation 排除的） */
  resolvedSkills?: Skill[];
  /** 快照版本号（用于缓存失效） */
  version: number;
}

// ====== 配置 ======

/** 技能限额配置 */
export interface SkillLimits {
  /** 每个来源目录最多扫描的子目录数 */
  maxCandidatesPerRoot: number;
  /** 每个来源最多加载的技能数 */
  maxSkillsLoadedPerSource: number;
  /** 注入 system prompt 的最大技能数 */
  maxSkillsInPrompt: number;
  /** skills 段落最大字符数 */
  maxSkillsPromptChars: number;
  /** 单个 SKILL.md 最大字节数（256 KB） */
  maxSkillFileBytes: number;
}

/** 单个技能配置条目（来自 openclaw.json） */
export interface SkillEntryConfig {
  enabled?: boolean;
  /** 自动注入到 primaryEnv 指定的环境变量 */
  apiKey?: string;
  /** 注入技能运行时所需的额外环境变量 */
  env?: Record<string, string>;
}

/** 技能系统総配置（对应 openclaw.json 的 skills 字段） */
export interface SkillsConfig {
  /** 内置技能白名单（未配置 = 全部允许） */
  allowBundled?: string[];
  load?: {
    extraDirs?: string[];
  };
  limits?: Partial<SkillLimits>;
  entries?: Record<string, SkillEntryConfig>;
}

/** loadSkillEntries 的选项 */
export interface LoadSkillsOptions {
  config?: SkillsConfig;
  workspaceDir?: string;
  /** 额外的技能目录（如插件目录 extensions/{plugin}/skills） */
  extraDirs?: string[];
}
