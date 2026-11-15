/**
 * 服务端认证路由（框架无关）
 *
 * 收归各项目后端重复的 6 个认证端点：
 *   POST /auth/register        注册
 *   POST /auth/login           登录
 *   POST /auth/logout          登出
 *   GET  /auth/me              当前用户
 *   POST /auth/password/forgot 发起密码重置
 *   POST /auth/password/reset  重置密码
 *
 * 本模块**不绑定路由框架**：调用方传入一个 `handle` 函数，
 * 由它决定怎么把 (method, path, body, request) 映射到自己的路由。
 * Hono、裸 Pages Functions、Express 都能接。
 *
 * @example 裸 Pages Functions
 * const auth = createAuthRoutes({ db: env.DB, sessionCookie: 'my_session' });
 * if (req.method === 'POST' && url.pathname === '/api/auth/login') {
 *   return Response.json(await auth.handle(req));
 * }
 *
 * @example Hono
 * app.post('/api/auth/login', async (c) => c.json(await auth.handle(c.req.raw)));
 */

/** 路由配置 */
export interface AuthRoutesOptions {
  /** D1 兼容的数据库句柄 */
  db: import('./authDb').D1Like;
  /** 会话 Cookie 名，默认 'app_session' */
  sessionCookie?: string;
  /** 会话有效期天数，默认 30 */
  sessionDays?: number;
  /** 每用户保留会话数上限，默认 20 */
  maxSessionsPerUser?: number;
  /** users 表额外列（如 role / email），查询时一并带出 */
  userExtraColumns?: string[];
  /** 登录名归一化方式，默认小写 */
  normalizeUsername?: (username: string) => string;
  /**
   * 注册时生成用户 id，默认 `usr_<uuid>`。
   * 已存在的用户表 id 格式各项目不同（usr_ / usr / uuid），必须保持原样。
   */
  createUserId?: () => string;
  /** 注册时写入 users 表的额外列 */
  userExtra?: (payload: RegisterInput) => Record<string, unknown>;
  /**
   * 校验注册入参。返回错误消息表示拒绝，null 表示通过。
   * 默认校验：用户名 3-32 位、密码 8-72 位。
   */
  validateRegister?: (payload: RegisterInput) => string | null;
  /** 校验登录入参 */
  validateLogin?: (payload: LoginInput) => string | null;
  /** 限流：注册窗口内允许次数，默认 8 */
  registerRateLimit?: number;
  /** 限流：登录窗口内失败次数上限，默认 10 */
  loginRateLimit?: number;
  /** 限流窗口（毫秒），默认 10 分钟 */
  rateLimitWindowMs?: number;
  /** 从请求取客户端标识（通常为 IP），默认取 CF-Connecting-IP */
  clientKey?: (request: Request) => string;
  /**
   * 密码重置：生成重置链接。返回 null 表示该环境不支持邮件重置。
   * 各项目的邮件发送方式不同（Resend / SMTP），由项目自己实现。
   */
  createPasswordResetLink?: (input: {
    request: Request;
    user: { id: string; username: string };
    token: string;
  }) => Promise<string | null>;
  /** 重置令牌有效期（分钟），默认 30 */
  resetTokenMinutes?: number;
}

export interface RegisterInput {
  username: string;
  password: string;
  displayName?: string;
  email?: string;
  [key: string]: unknown;
}

export interface LoginInput {
  username: string;
  password: string;
}

/** 处理结果 */
export interface AuthRouteResult {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

import {
  AUTH_CODES,
  authFail,
  authOk,
  buildClearCookie,
  buildCookie,
  generateSessionToken,
  getDummyPasswordHash,
  hashPassword,
  isSecureRequest,
  readCookie,
  sha256Hex,
  verifyPassword,
} from './authCore';
import {
  authAttemptsExceeded,
  createSession,
  deleteSession,
  findUserByUsername,
  insertUser,
  recordAuthAttempt,
  resolveSession,
  touchLastLogin,
  type AuthUserRow,
  type D1Like,
} from './authDb';

/** 默认注册校验 */
function defaultValidateRegister(payload: RegisterInput): string | null {
  const username = String(payload.username ?? '').trim();
  if (username.length < 3) return '用户名至少 3 位';
  if (username.length > 32) return '用户名最多 32 位';
  const password = String(payload.password ?? '');
  if (password.length < 8) return '密码至少 8 位';
  if (password.length > 72) return '密码最多 72 位';
  return null;
}

/** 生成密码重置 token（base64url，32 字节） */
function resetToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text).split('+').join('-').split('/').join('_').split('=').join('');
}

/**
 * 创建认证路由处理器。
 *
 * 返回的 `handle(request, path?)` 接收一个 Request，返回结果对象；
 * 调用方自行决定如何包装成 Response。
 */
export function createAuthRoutes(options: AuthRoutesOptions) {
  const {
    db,
    sessionCookie = 'app_session',
    sessionDays = 30,
    maxSessionsPerUser = 20,
    userExtraColumns,
    normalizeUsername = (value: string) => value.toLocaleLowerCase('en-US'),
    createUserId = () => `usr_${crypto.randomUUID()}`,
    validateRegister = defaultValidateRegister,
    validateLogin,
    registerRateLimit = 8,
    loginRateLimit = 10,
    rateLimitWindowMs = 10 * 60_000,
    clientKey = (request: Request) => request.headers.get('CF-Connecting-IP') ?? 'local',
    createPasswordResetLink,
    resetTokenMinutes = 30,
  } = options;

  const sessionOptions = {
    sessionDays,
    maxSessionsPerUser,
    userExtraColumns,
  };

  async function readBody(request: Request): Promise<Record<string, unknown>> {
    try {
      const text = await request.text();
      if (!text) return {};
      const parsed = JSON.parse(text);
      return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }

  /** 组装 Set-Cookie */
  function sessionCookieHeader(token: string, request: Request): string {
    return buildCookie(sessionCookie, token, {
      httpOnly: true,
      secure: isSecureRequest(request),
      sameSite: 'Strict',
      path: '/',
      maxAge: sessionDays * 86400,
    });
  }

  /** 用户载荷（对外暴露的字段，不含 password_hash） */
  function publicUser(row: AuthUserRow): Record<string, unknown> {
    const out: Record<string, unknown> = {
      id: row.id,
      username: row.username,
    };
    if (row.nickname !== undefined) out.nickname = row.nickname;
    if (row.email !== undefined) out.email = row.email;
    if (row.role !== undefined) out.role = row.role;
    if (row.status !== undefined) out.status = row.status;
    return out;
  }

  /** 注册 */
  async function handleRegister(request: Request): Promise<AuthRouteResult> {
    const body = await readBody(request);
    const key = await sha256Hex(clientKey(request));

    if (await authAttemptsExceeded(db, 'register', key, registerRateLimit, rateLimitWindowMs)) {
      return { status: 429, body: authFail(AUTH_CODES.RATE_LIMITED, '注册过于频繁，请稍后再试') };
    }

    const payload = body as unknown as RegisterInput;
    const invalid = validateRegister(payload);
    if (invalid) {
      return { status: 400, body: authFail(AUTH_CODES.INVALID_REQUEST, invalid) };
    }

    const username = String(payload.username).trim();
    const normalized = normalizeUsername(username);
    const existing = await findUserByUsername(db, username, { userExtraColumns });
    if (existing) {
      await recordAuthAttempt(db, 'register', key, false);
      return {
        status: 409,
        body: authFail(AUTH_CODES.EMAIL_TAKEN, '该账号已注册，请直接登录'),
      };
    }

    const passwordHash = await hashPassword(String(payload.password));
    const extra = {
      ...(payload.email ? { email: String(payload.email) } : {}),
      ...(payload.displayName ? { nickname: String(payload.displayName) } : {}),
      ...(options.userExtra ? options.userExtra(payload) : {}),
    };

    const userId = createUserId();
    try {
      await insertUser(db, {
        id: userId,
        username,
        passwordHash,
        extra,
      });
    } catch {
      await recordAuthAttempt(db, 'register', key, false);
      return {
        status: 409,
        body: authFail(AUTH_CODES.EMAIL_TAKEN, '该账号已注册，请直接登录'),
      };
    }

    await recordAuthAttempt(db, 'register', key, true);
    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    const { expiresAt } = await createSession(db, userId, token, tokenHash, sessionOptions);
    const row = await findUserByUsername(db, username, { userExtraColumns });

    return {
      status: 201,
      body: authOk({
        user: row ? publicUser(row) : { id: userId, username },
        expiresAt,
      }),
      headers: { 'Set-Cookie': sessionCookieHeader(token, request) },
    };
  }

  /** 登录 */
  async function handleLogin(request: Request): Promise<AuthRouteResult> {
    const body = await readBody(request);
    const key = await sha256Hex(clientKey(request));

    if (await authAttemptsExceeded(db, 'login', key, loginRateLimit, rateLimitWindowMs)) {
      return { status: 429, body: authFail(AUTH_CODES.RATE_LIMITED, '登录尝试过于频繁，请稍后再试') };
    }

    const payload = body as unknown as LoginInput;
    const invalid = validateLogin?.(payload);
    if (invalid) {
      return { status: 400, body: authFail(AUTH_CODES.INVALID_REQUEST, invalid) };
    }

    const username = String(payload.username ?? '').trim();
    const password = String(payload.password ?? '');
    const user = await findUserByUsername(db, username, { userExtraColumns });

    // 用户不存在时也跑一次 PBKDF2，让响应耗时接近，避免用户名枚举
    const valid = await verifyPassword(password, user?.password_hash ?? (await getDummyPasswordHash()));
    if (!user || !valid) {
      await recordAuthAttempt(db, 'login', key, false);
      return {
        status: 401,
        body: authFail(AUTH_CODES.INVALID_CREDENTIALS, '账号或密码不正确'),
      };
    }

    await recordAuthAttempt(db, 'login', key, true);
    await touchLastLogin(db, user.id);
    const token = generateSessionToken();
    const tokenHash = await sha256Hex(token);
    const { expiresAt } = await createSession(db, user.id, token, tokenHash, sessionOptions);

    return {
      status: 200,
      body: authOk({ user: publicUser(user), expiresAt }),
      headers: { 'Set-Cookie': sessionCookieHeader(token, request) },
    };
  }

  /** 登出 */
  async function handleLogout(request: Request): Promise<AuthRouteResult> {
    const token = readCookie(request, sessionCookie);
    if (token) {
      const tokenHash = await sha256Hex(token);
      await deleteSession(db, tokenHash);
    }
    return {
      status: 200,
      body: authOk({ loggedOut: true }),
      headers: {
        'Set-Cookie': buildClearCookie(sessionCookie, {
          httpOnly: true,
          secure: isSecureRequest(request),
          sameSite: 'Strict',
          path: '/',
        }),
      },
    };
  }

  /** 当前用户 */
  async function handleMe(request: Request): Promise<AuthRouteResult> {
    const token = readCookie(request, sessionCookie);
    const tokenHash = await sha256Hex(token ?? '');
    const session = await resolveSession(db, token, tokenHash, sessionOptions);
    if (!session) {
      return { status: 401, body: authFail(AUTH_CODES.UNAUTHORIZED, '请先登录') };
    }
    return {
      status: 200,
      body: authOk({ user: publicUser(session.user), expiresAt: session.expiresAt }),
    };
  }

  /** 发起密码重置 */
  async function handleForgot(request: Request): Promise<AuthRouteResult> {
    if (!createPasswordResetLink) {
      return {
        status: 400,
        body: authFail(AUTH_CODES.INVALID_REQUEST, '当前环境未启用密码重置'),
      };
    }
    const body = await readBody(request);
    const username = String(body.username ?? body.email ?? '').trim();
    const user = username ? await findUserByUsername(db, username, { userExtraColumns }) : null;

    // 无论用户是否存在都返回相同响应，避免账号枚举
    if (user) {
      const token = resetToken();
      const tokenHash = await sha256Hex(token);
      const expiresAt = new Date(Date.now() + resetTokenMinutes * 60_000).toISOString();
      await db
        .prepare(
          'INSERT INTO password_resets (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)',
        )
        .bind(
          `prs_${crypto.randomUUID()}`,
          user.id,
          tokenHash,
          expiresAt,
          new Date().toISOString(),
        )
        .run();
      await createPasswordResetLink({
        request,
        user: { id: user.id, username: user.username },
        token,
      });
    }

    return { status: 200, body: authOk({ sent: true }) };
  }

  /** 重置密码 */
  async function handleReset(request: Request): Promise<AuthRouteResult> {
    const body = await readBody(request);
    const token = String(body.token ?? '');
    const password = String(body.password ?? '');
    if (!token || password.length < 8) {
      return {
        status: 400,
        body: authFail(AUTH_CODES.INVALID_REQUEST, '密码至少 8 位'),
      };
    }

    const tokenHash = await sha256Hex(token);
    const row = await db
      .prepare('SELECT id,user_id,expires_at,used_at FROM password_resets WHERE token_hash = ?')
      .bind(tokenHash)
      .first<{ id: string; user_id: string; expires_at: string; used_at: string | null }>();

    if (!row || row.used_at || Date.parse(row.expires_at) <= Date.now()) {
      return {
        status: 400,
        body: authFail(AUTH_CODES.INVALID_REQUEST, '重置链接无效或已过期'),
      };
    }

    const passwordHash = await hashPassword(password);
    await db
      .prepare('UPDATE users SET password_hash = ? WHERE id = ?')
      .bind(passwordHash, row.user_id)
      .run();
    await db.prepare('UPDATE password_resets SET used_at = ? WHERE id = ?').bind(new Date().toISOString(), row.id).run();
    // 重置密码后使所有旧会话失效
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(row.user_id).run();

    return { status: 200, body: authOk({ reset: true }) };
  }

  /**
   * 统一分发。
   * @param request 原始请求
   * @param path 去掉 basePath 的端点路径，如 '/auth/login'
   */
  async function handle(request: Request, path?: string): Promise<AuthRouteResult> {
    const url = new URL(request.url);
    const fullPath = path ?? url.pathname;
    const method = request.method.toUpperCase();

    if (method === 'POST' && fullPath.endsWith('/auth/register')) return handleRegister(request);
    if (method === 'POST' && fullPath.endsWith('/auth/login')) return handleLogin(request);
    if (method === 'POST' && fullPath.endsWith('/auth/logout')) return handleLogout(request);
    if (method === 'GET' && fullPath.endsWith('/auth/me')) return handleMe(request);
    if (method === 'POST' && fullPath.endsWith('/auth/password/forgot')) return handleForgot(request);
    if (method === 'POST' && fullPath.endsWith('/auth/password/reset')) return handleReset(request);

    return { status: 404, body: authFail(AUTH_CODES.INVALID_REQUEST, '未知认证端点') };
  }

  return {
    handle,
    /** 供中间件使用：解析当前会话 */
    async resolveSession(request: Request) {
      const token = readCookie(request, sessionCookie);
      const tokenHash = await sha256Hex(token ?? '');
      return resolveSession(db, token, tokenHash, sessionOptions);
    },
    sessionCookie,
    db: db as D1Like,
  };
}
