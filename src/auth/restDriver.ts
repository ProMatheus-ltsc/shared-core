/**
 * REST 认证驱动（服务端权威认证）
 *
 * 适用于有后端的项目：civil-exam-drill、ability-growth-system、
 * money-growth-system、quant-trading-system。
 *
 * 约定（各项目后端按同一契约实现即可互换）：
 * - 登录态走 HttpOnly Cookie，**前端不接触 token**（这是相对现状最大的安全改进）
 * - 统一响应信封 `{ success, data, error }`，与各项目现有 `api/client.ts` 一致
 *
 * 端点路径通过 `basePath` 配置，默认 `/api/auth`，各项目可覆盖。
 */
import type {
  AuthDriver,
  AuthCredential,
  AuthRegisterPayload,
  AuthResetPayload,
  AuthResetRequest,
  AuthUser,
} from './types.ts';
import { AuthError, AUTH_ERROR_CODES } from './types.ts';

/** 后端返回的用户载荷 */
interface AuthUserPayload {
  id: string;
  username?: string;
  nickname?: string;
  displayName?: string;
  email?: string;
  role?: string;
  [key: string]: unknown;
}

export interface RestAuthDriverOptions {
  /** 认证端点前缀，默认 '/api/auth' */
  basePath?: string;
  /**
   * 请求函数。默认用 fetch + credentials:'include'。
   * 传入自定义实现以适配各项目已有的 api/client（如统一错误信封、统一 baseURL）。
   */
  request?: <T>(path: string, init?: RequestInit) => Promise<T>;
  /** 从响应载荷里取用户字段的映射，覆盖默认映射 */
  mapUser?: (raw: AuthUserPayload) => AuthUser;
  /** 首次使用探测端点；缺省时用 register 探测 */
  firstTimePath?: string;
}

/** 默认映射：兼容各项目现有的 user 字段命名 */
function defaultMapUser(raw: AuthUserPayload): AuthUser {
  const extra: Record<string, unknown> = {};
  // 除标准字段外的键一律进 extra，保证项目特有信息不丢
  for (const [key, value] of Object.entries(raw)) {
    if (['id', 'username', 'nickname', 'displayName', 'email'].includes(key)) continue;
    extra[key] = value;
  }
  return {
    id: raw.id,
    username: raw.username ?? raw.email ?? raw.nickname ?? raw.id,
    displayName: raw.displayName ?? raw.nickname ?? raw.username,
    email: raw.email,
    extra: Object.keys(extra).length > 0 ? extra : undefined,
  };
}

/** 统一解析后端错误为 AuthError */
function toAuthError(payload: unknown, status: number): AuthError {
  const message =
    (payload as { error?: { message?: string } } | undefined)?.error?.message ??
    (payload as { message?: string } | undefined)?.message ??
    (status === 401 ? '用户名或密码不正确' : '认证请求失败');
  const code =
    (payload as { error?: { code?: string } } | undefined)?.error?.code ??
    (status === 401 ? AUTH_ERROR_CODES.INVALID_CREDENTIALS : AUTH_ERROR_CODES.SERVER_ERROR);
  return new AuthError(code, message, status);
}

/** 默认请求实现：fetch + 同源 cookie */
async function defaultRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) throw toAuthError(payload, response.status);
  // 兼容 `{ success, data }` 信封与裸对象两种返回
  if (payload && typeof payload === 'object' && 'data' in payload) {
    const envelope = payload as { success?: boolean; data?: unknown; error?: unknown };
    if (envelope.success === false) throw toAuthError(payload, response.status);
    return envelope.data as T;
  }
  return payload as T;
}

export function createRestAuthDriver(options: RestAuthDriverOptions = {}): AuthDriver {
  const basePath = options.basePath ?? '/api/auth';
  const request = options.request ?? defaultRequest;
  const mapUser = options.mapUser ?? defaultMapUser;

  return {
    async restore(): Promise<AuthUser | null> {
      try {
        const raw = await request<AuthUserPayload>(`${basePath}/me`);
        if (!raw || !raw.id) return null;
        return mapUser(raw);
      } catch (error) {
        // 未登录是正常状态，不当错误抛
        if (error instanceof AuthError && error.status === 401) return null;
        throw error;
      }
    },

    async isFirstTime(): Promise<boolean> {
      if (!options.firstTimePath) return false;
      const raw = await request<{ firstTime?: boolean }>(options.firstTimePath);
      return Boolean(raw?.firstTime);
    },

    async login(credential: AuthCredential): Promise<AuthUser> {
      const raw = await request<AuthUserPayload>(`${basePath}/login`, {
        method: 'POST',
        body: JSON.stringify({ username: credential.username, password: credential.password }),
      });
      return mapUser(raw);
    },

    async register(payload: AuthRegisterPayload): Promise<AuthUser> {
      const raw = await request<AuthUserPayload>(`${basePath}/register`, {
        method: 'POST',
        body: JSON.stringify({
          username: payload.username,
          password: payload.password,
          email: payload.email,
          nickname: payload.displayName,
          ...(payload.extra ?? {}),
        }),
      });
      return mapUser(raw);
    },

    async logout(): Promise<void> {
      await request(`${basePath}/logout`, { method: 'POST' });
    },

    async resetPassword(payload: AuthResetPayload): Promise<void> {
      await request(`${basePath}/password/reset`, {
        method: 'POST',
        body: JSON.stringify({
          username: payload.username,
          password: payload.newPassword,
          newPassword: payload.newPassword,
          token: payload.token,
        }),
      });
    },

    async requestPasswordReset(payload: AuthResetRequest): Promise<void> {
      await request(`${basePath}/password/forgot`, {
        method: 'POST',
        body: JSON.stringify({ username: payload.username, email: payload.email }),
      });
    },
  };
}
