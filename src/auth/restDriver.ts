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
  AuthRegisterResult,
  AuthResetPayload,
  AuthResetRequest,
  AuthUser,
  AuthVerifyPayload,
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

/**
 * 后端把用户包在 `{ user: {...} }` 里的响应形状。
 *
 * 共享包的 canonical 端点（`server/authRoutes.ts`）返回裸用户对象，
 * 但已有消费方（civil / ability）的后端把用户包在 `{ user }` 里，
 * 还会在同一层带上 `expiresAt` / `workspace` 等附加信息。
 */
interface AuthUserEnvelope {
  user?: AuthUserPayload;
  [key: string]: unknown;
}

/**
 * 取用户载荷：兼容「裸用户对象」与「包在 `{ user }` 里」两种响应形状。
 *
 * 为什么必须兼容：驱动的 `restore()` 靠 `raw.id` 判断「有没有登录态」。
 * 若后端返回的是 `{ user: { id } }`，直接读 `raw.id` 永远读不到 →
 * `restore()` 恒返回 null → AuthProvider 把状态机置为 `login` →
 * **用户刚登录就被弹回登录页**（症状：点开申论知识库这类新标签页后，
 * 新标签页重新探测会话失败，看起来像「被踢下线」）。
 */
function extractUserPayload(raw: unknown): AuthUserPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as AuthUserPayload & AuthUserEnvelope;
  // 顶层就有 id → 裸用户对象
  if (candidate.id) return candidate;
  // 否则看是不是 `{ user: {...} }` 信封
  const nested = candidate.user;
  if (nested && typeof nested === 'object' && nested.id) {
    return nested;
  }
  return null;
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
        const raw = await request<AuthUserPayload | AuthUserEnvelope>(
          `${basePath}/me`,
        );
        const payload = extractUserPayload(raw);
        if (!payload) return null;
        return mapUser(payload);
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
      const raw = await request<AuthUserPayload | AuthUserEnvelope>(
        `${basePath}/login`,
        {
          method: 'POST',
          body: JSON.stringify({ username: credential.username, password: credential.password }),
        },
      );
      const payload = extractUserPayload(raw);
      if (!payload)
        throw new AuthError(
          AUTH_ERROR_CODES.SERVER_ERROR,
          '登录响应缺少用户信息',
        );
      return mapUser(payload);
    },

    async register(payload: AuthRegisterPayload): Promise<AuthRegisterResult> {
      const raw = await request<AuthUserPayload | { user?: AuthUserPayload; needs_verification?: boolean; pending_id?: string; notice?: string }>(
        `${basePath}/register`,
        {
          method: 'POST',
          body: JSON.stringify({
            username: payload.username,
            password: payload.password,
            email: payload.email,
            nickname: payload.displayName,
            ...(payload.extra ?? {}),
          }),
        },
      );
      // 两阶段注册：后端返回 needs_verification 表示账号待验证
      const envelope = raw as { user?: AuthUserPayload; needs_verification?: boolean; pending_id?: string; notice?: string };
      if (envelope?.needs_verification) {
        return {
          status: 'pending',
          pendingId: envelope.pending_id ?? payload.username,
          notice: envelope.notice ?? undefined,
        };
      }
      // 用户可能在顶层，也可能在 `{ user }` 层里（见 extractUserPayload 注释）
      const user = extractUserPayload(raw);
      if (!user)
        throw new AuthError(
          AUTH_ERROR_CODES.SERVER_ERROR,
          '注册响应缺少用户信息',
        );
      return { status: 'created', user: mapUser(user) };
    },

    async verify(payload: AuthVerifyPayload): Promise<AuthUser> {
      const raw = await request<AuthUserPayload>(`${basePath}/verify`, {
        method: 'POST',
        body: JSON.stringify({ pending_id: payload.pendingId, code: payload.code }),
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
