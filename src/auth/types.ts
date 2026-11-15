/**
 * 统一认证契约（前后端共用）
 *
 * 所有项目的注册登录最终都收敛到这一组类型：
 * - 前端：@shared/core/auth  → AuthDriver 抽象 + AuthProvider/useAuth 状态机
 * - 后端：@shared/core/server/auth → 密码哈希 / 会话 / Cookie 助手
 *
 * 设计要点：
 * 1. **能力用可选字段表达，不用子类**。不同项目的差异（角色、邀请码、邮箱验证、
 *    教师-学生模型）统一塞进 `AuthUser.extra` 与 `AuthDriverOptions`，
 *    共享包只认标准字段，项目特有字段走 extra，迁移时不会丢语义。
 * 2. **传输层不绑定具体实现**。前端只认 `AuthDriver` 接口，
 *    本地模式（IndexedDB）与服务端模式（REST + Cookie）都实现同一个接口。
 * 3. **端点路径可配置**。服务端模式的项目（CF Pages Functions / Hono）
 *    路由前缀不同，通过 `basePath` 配置，共享包内置一套默认契约。
 */

/** 认证状态机：与各项目现有四态保持一致 */
export type AuthState = 'loading' | 'firstTime' | 'login' | 'authenticated';

/**
 * 统一的登录用户。
 *
 * 标准字段是所有项目共有的最小集；`extra` 承载项目特有信息
 * （如 money-growth 的 role、ability 的教师角色、quant 的 verify 状态）。
 */
export interface AuthUser {
  /** 稳定用户标识（服务端为 users.id，本地为 uuid） */
  id: string;
  /** 主登录名。服务端若走邮箱注册登录，这里放邮箱 */
  username: string;
  /** 显示名 / 昵称（服务端可为空，前端回落到 username） */
  displayName?: string;
  /** 邮箱（仅服务端模式有值） */
  email?: string;
  /** 项目特有字段：role / permissions / verified 等 */
  extra?: Record<string, unknown>;
}

/**
 * 认证驱动接口 —— 前端与具体认证后端之间的唯一接缝。
 *
 * 实现方：
 * - `createLocalAuthDriver`  → 纯前端 IndexedDB（root-cause-analysis / personal_review_system）
 * - `createRestAuthDriver`   → 服务端 REST + HttpOnly Cookie（civil / ability / money / quant）
 */
export interface AuthDriver {
  /** 启动时探测已有会话，返回当前用户；无会话返回 null */
  restore(): Promise<AuthUser | null>;
  /** 是否为「首次使用」——没有任何账户，需要走注册流程 */
  isFirstTime(): Promise<boolean>;
  /** 登录；失败时抛出 AuthError */
  login(credential: AuthCredential): Promise<AuthUser>;
  /**
   * 注册。
   *
   * **可选**：并非所有系统都开放自助注册——
   * 管理员预置账号、邀请码准入、一次性初始化双账号等场景都不提供注册入口。
   * 驱动不提供时，AuthProvider 的 register/registerWith 会返回 false 并
   * 在 error 字段给出说明。
   */
  register?(payload: AuthRegisterPayload): Promise<AuthUser>;
  /** 登出；后端清 Cookie，前端清本地态 */
  logout(): Promise<void>;
  /** 重置密码（可选实现） */
  resetPassword?(payload: AuthResetPayload): Promise<void>;
  /** 发送重置邮件 / 验证码（可选实现，服务端模式用） */
  requestPasswordReset?(payload: AuthResetRequest): Promise<void>;
}

/** 登录凭据 */
export interface AuthCredential {
  username: string;
  password: string;
}

/** 注册入参 */
export interface AuthRegisterPayload {
  username: string;
  password: string;
  /** 昵称（可选） */
  displayName?: string;
  /** 邮箱（服务端模式可选） */
  email?: string;
  /** 项目特有字段，原样透传给后端 */
  extra?: Record<string, unknown>;
}

/** 重置密码入参 */
export interface AuthResetPayload {
  username: string;
  newPassword: string;
  /** 服务端模式：邮件重置需要 token */
  token?: string;
}

/** 发起密码重置 */
export interface AuthResetRequest {
  username: string;
  email?: string;
}

/**
 * 统一错误类型。
 *
 * 保留 `code` 以便前端做分支处理（如 RATE_LIMITED / EMAIL_TAKEN / INVALID_CREDENTIALS），
 * 同时保证 message 是可直接展示给用户的中文文案。
 */
export class AuthError extends Error {
  readonly code: string;
  readonly status?: number;

  constructor(code: string, message: string, status?: number) {
    super(message);
    this.name = 'AuthError';
    this.code = code;
    this.status = status;
  }
}

/** 标准错误码 —— 与各项目现有后端返回码对齐 */
export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SERVER_ERROR: 'SERVER_ERROR',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
