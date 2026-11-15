/**
 * 服务端认证 DB 层（Cloudflare D1）
 *
 * 收归各项目后端重复的会话/用户表操作。
 * 只依赖 D1 的 `prepare().bind().run()/first()/all()` 接口，不依赖任何框架。
 *
 * ## 统一表结构
 *
 * 所有服务端项目迁移到这一套 schema（migration 文件由各项目仓库提供）：
 * ```sql
 * CREATE TABLE users (
 *   id TEXT PRIMARY KEY,
 *   username TEXT NOT NULL,
 *   username_normalized TEXT NOT NULL UNIQUE,
 *   password_hash TEXT NOT NULL,   -- pbkdf2-sha256$100000$<b64salt>$<b64hash>
 *   created_at TEXT NOT NULL,
 *   last_login_at TEXT NOT NULL
 * );
 * CREATE TABLE sessions (
 *   id TEXT PRIMARY KEY,
 *   user_id TEXT NOT NULL,
 *   token_hash TEXT NOT NULL UNIQUE,  -- 只存 sha256(token)，Cookie 里才是明文 token
 *   expires_at TEXT NOT NULL,
 *   created_at TEXT NOT NULL,
 *   FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
 * );
 * CREATE TABLE auth_attempts (
 *   id INTEGER PRIMARY KEY AUTOINCREMENT,
 *   client_key TEXT NOT NULL,
 *   succeeded INTEGER NOT NULL,
 *   created_at TEXT NOT NULL
 * );
 * ```
 * 项目特有列（role / email / nickname / grade_level 等）通过 `userExtraColumns` 参与读写，
 * 但**不改变本模块的核心契约**：id 是 TEXT、token 只存哈希、登录名有归一化列。
 */

/** D1 的最小接口子集（避免依赖 @cloudflare/workers-types 类型） */
export interface D1Like {
  prepare(query: string): {
    bind(...values: unknown[]): {
      run(): Promise<{ success?: boolean }>;
      first<T = unknown>(): Promise<T | null>;
      all<T = unknown>(): Promise<{ results: T[] }>;
    };
  };
}

/** 用户行（标准字段 + 项目特有列） */
export interface AuthUserRow {
  id: string;
  username: string;
  username_normalized: string;
  password_hash: string;
  created_at: string;
  last_login_at: string;
  [key: string]: unknown;
}

/** 会话行 */
export interface AuthSessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
}

/** 会话解析结果 */
export interface ResolvedSession {
  userId: string;
  username: string;
  tokenHash: string;
  expiresAt: string;
  /** 用户整行（含项目特有列） */
  user: AuthUserRow;
}

/** 会话选项 */
export interface SessionOptions {
  /** 会话有效期天数，默认 30 */
  sessionDays?: number;
  /** 每用户保留会话数上限，默认 20 */
  maxSessionsPerUser?: number;
  /** 登录时是否顺带清理全库过期会话，默认 true */
  pruneExpiredGlobally?: boolean;
  /** users 表额外列（SELECT 时一并带出） */
  userExtraColumns?: string[];
}

function nowIso(): string {
  return new Date().toISOString();
}

/** users 表 SELECT 列 */
function userColumns(extra?: string[]): string {
  const base = 'id,username,username_normalized,password_hash,created_at,last_login_at';
  return extra && extra.length > 0 ? `${base},${extra.join(',')}` : base;
}

/**
 * 创建会话：插入会话行。
 *
 * @param token 原始 token（只在这里出现一次，库里只存哈希）
 * @param tokenHash sha256(token)
 */
export async function createSession(
  db: D1Like,
  userId: string,
  token: string,
  tokenHash: string,
  options: SessionOptions = {},
): Promise<{ expiresAt: string }> {
  const sessionDays = options.sessionDays ?? 30;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionDays * 86_400_000).toISOString();

  if (options.pruneExpiredGlobally !== false) {
    // 登录/注册是低频写，顺手清掉过期会话
    await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()).run();
  }

  await db
    .prepare(
      'INSERT INTO sessions (id,user_id,token_hash,expires_at,created_at) VALUES (?,?,?,?,?)',
    )
    .bind(`ses_${crypto.randomUUID()}`, userId, tokenHash, expiresAt, now.toISOString())
    .run();

  await pruneSessionsForUser(db, userId, options.maxSessionsPerUser ?? 20);
  return { expiresAt };
}

/**
 * 每用户只保留最新 N 个会话，超出的按创建时间删除最旧的。
 */
export async function pruneSessionsForUser(
  db: D1Like,
  userId: string,
  maxSessions: number,
): Promise<void> {
  await db
    .prepare(
      'DELETE FROM sessions WHERE id IN (SELECT id FROM sessions WHERE user_id = ? ORDER BY created_at DESC LIMIT -1 OFFSET ?)',
    )
    .bind(userId, maxSessions)
    .run();
}

/**
 * 解析会话 token → 会话与用户。
 *
 * - token 哈希后查表
 * - 过期则删行并返回 null
 * - 返回用户整行（含项目特有列）
 */
export async function resolveSession(
  db: D1Like,
  token: string | undefined,
  tokenHash: string,
  options: SessionOptions = {},
): Promise<ResolvedSession | null> {
  if (!token) return null;
  const row = await db
    .prepare(
      `SELECT s.id AS session_id, s.user_id, s.token_hash, s.expires_at,
              ${userColumns(options.userExtraColumns)}
         FROM sessions s
         JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = ?`,
    )
    .bind(tokenHash)
    .first<Record<string, unknown>>();

  if (!row) return null;

  const expiresAt = String(row.expires_at ?? '');
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    await db.prepare('DELETE FROM sessions WHERE id = ?').bind(String(row.session_id)).run();
    return null;
  }

  const user: AuthUserRow = {
    id: String(row.id),
    username: String(row.username),
    username_normalized: String(row.username_normalized ?? row.username),
    password_hash: String(row.password_hash),
    created_at: String(row.created_at ?? ''),
    last_login_at: String(row.last_login_at ?? ''),
  };
  // 带出项目特有列
  for (const [key, value] of Object.entries(row)) {
    if (key in user) continue;
    if (key.startsWith('session_')) continue;
    user[key] = value;
  }

  return {
    userId: String(row.user_id),
    username: String(row.username),
    tokenHash: String(row.token_hash),
    expiresAt,
    user,
  };
}

/** 删除单个会话（登出） */
export async function deleteSession(db: D1Like, tokenHash: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
}

/** 按用户名查用户（按 username_normalized 精确匹配） */
export async function findUserByUsername(
  db: D1Like,
  username: string,
  options: SessionOptions = {},
): Promise<AuthUserRow | null> {
  const row = await db
    .prepare(`SELECT ${userColumns(options.userExtraColumns)} FROM users WHERE username_normalized = ?`)
    .bind(username.toLocaleLowerCase('en-US'))
    .first<AuthUserRow>();
  return row ?? null;
}

/** 按 id 查用户 */
export async function findUserById(
  db: D1Like,
  id: string,
  options: SessionOptions = {},
): Promise<AuthUserRow | null> {
  const row = await db
    .prepare(`SELECT ${userColumns(options.userExtraColumns)} FROM users WHERE id = ?`)
    .bind(id)
    .first<AuthUserRow>();
  return row ?? null;
}

/** 插入用户 */
export async function insertUser(
  db: D1Like,
  user: {
    id: string;
    username: string;
    passwordHash: string;
    /** 项目特有列，如 { email, nickname, status, role, grade_level } */
    extra?: Record<string, unknown>;
  },
  options: SessionOptions = {},
): Promise<void> {
  const extraEntries = Object.entries(user.extra ?? {});
  const columns = ['id', 'username', 'username_normalized', 'password_hash', 'created_at', 'last_login_at'];
  const values: unknown[] = [
    user.id,
    user.username,
    user.username.toLocaleLowerCase('en-US'),
    user.passwordHash,
    nowIso(),
    nowIso(),
  ];
  for (const [key, value] of extraEntries) {
    columns.push(key);
    values.push(value);
  }
  const placeholders = columns.map(() => '?').join(',');
  await db
    .prepare(`INSERT INTO users (${columns.join(',')}) VALUES (${placeholders})`)
    .bind(...values)
    .run();
}

/** 更新最后登录时间 */
export async function touchLastLogin(db: D1Like, userId: string): Promise<void> {
  await db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').bind(nowIso(), userId).run();
}

/**
 * 认证限流：检查是否超过阈值（只统计失败）。
 *
 * @param scope 限流维度（如 'register' / 'login'）
 * @param clientKey 客户端标识（通常为 IP 的 sha256）
 * @param limit 窗口内允许的失败次数
 * @param windowMs 窗口长度（毫秒）
 */
export async function authAttemptsExceeded(
  db: D1Like,
  scope: string,
  clientKey: string,
  limit: number,
  windowMs: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowMs).toISOString();
  const row = await db
    .prepare(
      'SELECT COUNT(*) AS cnt FROM auth_attempts WHERE client_key = ? AND succeeded = 0 AND created_at > ?',
    )
    .bind(`${scope}:${clientKey}`, since)
    .first<{ cnt: number }>();
  return Number(row?.cnt ?? 0) >= limit;
}

/** 记录一次认证尝试 */
export async function recordAuthAttempt(
  db: D1Like,
  scope: string,
  clientKey: string,
  succeeded: boolean,
): Promise<void> {
  await db
    .prepare('INSERT INTO auth_attempts (id,client_key,succeeded,created_at) VALUES (?,?,?,?)')
    .bind(
      `att_${crypto.randomUUID()}`,
      `${scope}:${clientKey}`,
      succeeded ? 1 : 0,
      nowIso(),
    )
    .run();
}

/** 清理过期的认证尝试记录 */
export async function pruneAuthAttempts(db: D1Like, retentionMs: number): Promise<void> {
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  await db.prepare('DELETE FROM auth_attempts WHERE created_at < ?').bind(cutoff).run();
}
