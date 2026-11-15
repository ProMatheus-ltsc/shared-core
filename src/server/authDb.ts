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
import { sha256Hex } from './authCore.ts';
import type { D1DatabaseLike, D1PreparedStatementLike } from './d1.ts';

/**
 * D1 句柄类型（收归 @shared/core/server/d1）。
 *
 * 与 Cloudflare 官方 `D1Database` 结构兼容，只是换成不依赖类型包的结构化类型。
 * 保留这个别名是为了让既有调用方的类型标注不用改。
 */
export type D1Like = D1DatabaseLike;

/** D1 预编译语句类型（收归 @shared/core/server/d1） */
export type D1Statement = D1PreparedStatementLike;

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

/**
 * users 表形状。
 *
 * 统一契约的核心不变：id 是 TEXT、token 只存哈希。以下开关只覆盖
 * **项目特有的表结构差异**，由项目自己声明，共享包不硬编码任何项目。
 */
export interface UserShape {
  /** 登录名归一化列名，默认 'username_normalized' */
  usernameColumn?: string;
  /**
   * 登录名（展示用）列名，默认 'username'。
   * 设为 null 表示该表没有这一列——例如以邮箱为登录标识、
   * 另设 nickname 列作展示名的表。
   */
  usernameDisplayColumn?: string | null;
  /** 独立盐列名；为 null 表示盐内嵌在 password_hash 里 */
  saltColumn?: string | null;
  /**
   * 独立盐列里盐的编码格式，默认 'hex'。
   * 有项目把盐存成 base64url（与哈希同族），此时声明 'base64url'。
   */
  saltEncoding?: 'hex' | 'base64';
  /**
   * 登录名归一化方式，默认 'lower'（转小写后比较）。
   * 'none' 表示按原样精确匹配（该列自带 COLLATE NOCASE 时适用）。
   */
  usernameNormalization?: 'lower' | 'none';
  /** 是否有 last_login_at 列 */
  hasLastLoginAt?: boolean;
  /** 是否有 status 列（'active'/'disabled'）；有则禁用账户的会话立即失效 */
  hasStatusColumn?: boolean;
  /** id 列类型：TEXT（默认）或 INTEGER 自增 */
  idMode?: 'text' | 'autoincrement';
}

/** 默认形状：多数项目 */
export const DEFAULT_USER_SHAPE: UserShape = {
  usernameColumn: 'username_normalized',
  usernameDisplayColumn: 'username',
  saltColumn: null,
  saltEncoding: 'hex',
  usernameNormalization: 'lower',
  hasLastLoginAt: true,
  hasStatusColumn: false,
  idMode: 'text',
};

/**
 * sessions 表形状。
 *
 * 统一契约：sessions(id, user_id, token_hash, expires_at, created_at)。
 * 有的项目用 token_hash 直接作主键（没有 id 列），此时声明 hasIdColumn: false。
 */
export interface SessionShape {
  /** 是否有 id 列，默认 true */
  hasIdColumn?: boolean;
  /** sessions 表额外列（写入时一并填，如 user_agent / ip_hash） */
  extraColumns?: string[];
  /** 额外列的值来源 */
  extraValues?: Record<string, unknown>;
}

/** 默认形状 */
export const DEFAULT_SESSION_SHAPE: SessionShape = {
  hasIdColumn: true,
};

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
  /** users 表形状，默认通用契约 */
  userShape?: UserShape;
  /** sessions 表形状，默认通用契约 */
  sessionShape?: SessionShape;
  /** 生成会话 id */
  generateSessionId?: () => string;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * users 表 SELECT 列。
 *
 * @param prefix 列名前缀。JOIN 查询里必须带表别名（u.），
 *   否则 SQLite 会因为 id / created_at 等列在两张表里都存在而报
 *   "ambiguous column name"。
 * @param shape 表形状。登录名列名随项目而异（有的用 username_normalized，
 *   有的用 email_normalized），按形状取列，避免引用不存在的列。
 */
function userColumns(extra?: string[], prefix = '', shape?: UserShape): string {
  const usernameColumn = shape?.usernameColumn ?? 'username_normalized';
  const displayColumn = shape?.usernameDisplayColumn === undefined
    ? 'username'
    : shape.usernameDisplayColumn;
  const base = ['id', usernameColumn];
  if (displayColumn && displayColumn !== usernameColumn) base.push(displayColumn);
  base.push('password_hash', 'created_at');
  if (shape?.hasLastLoginAt !== false) base.push('last_login_at');
  const all = extra && extra.length > 0 ? [...base, ...extra] : base;
  return all.map((column) => `${prefix}${column}`).join(',');
}

/**
 * 创建会话：插入会话行。
 *
 * @param token 原始 token。**只在这里出现一次**，库里只存它的 sha256。
 */
export async function createSession(
  db: D1Like,
  userId: string,
  token: string,
  options: SessionOptions = {},
): Promise<{ expiresAt: string }> {
  // 签名不匹配的防御：旧版签名第 4 位是 tokenHash（字符串），新版是 options（对象）。
  // 传错时 options 会被当成字符串丢弃（sessionDays / userExtraColumns 全部失效），
  // 症状很隐蔽——会话照常建立，但用户行查不出项目特有列。
  if (typeof options !== 'object' || options === null) {
    throw new Error(
      'createSession 的第 4 个参数应为 options 对象（不是 tokenHash）——' +
        '共享包已在内部自行计算 sha256(token)，调用方不要再传哈希',
    );
  }
  const sessionDays = options.sessionDays ?? 30;
  const sessionShape = options.sessionShape ?? DEFAULT_SESSION_SHAPE;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionDays * 86_400_000).toISOString();
  const tokenHash = await sha256Hex(token);

  if (options.pruneExpiredGlobally !== false) {
    // 登录/注册是低频写，顺手清掉过期会话
    await db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now.toISOString()).run();
  }

  // sessions 表形状：多数项目有 id 列；用 token_hash 直接作主键的项目没有
  const columns: string[] = sessionShape.hasIdColumn === false
    ? ['user_id', 'token_hash', 'expires_at', 'created_at']
    : ['id', 'user_id', 'token_hash', 'expires_at', 'created_at'];
  const values: unknown[] = sessionShape.hasIdColumn === false
    ? [userId, tokenHash, expiresAt, now.toISOString()]
    : [`ses_${crypto.randomUUID()}`, userId, tokenHash, expiresAt, now.toISOString()];
  for (const [key, value] of Object.entries(sessionShape.extraValues ?? {})) {
    columns.push(key);
    values.push(value);
  }
  const placeholders = columns.map(() => '?').join(',');
  await db
    .prepare(`INSERT INTO sessions (${columns.join(',')}) VALUES (${placeholders})`)
    .bind(...values)
    .run();

  if (sessionShape.hasIdColumn !== false) {
    await pruneSessionsForUser(db, userId, options.maxSessionsPerUser ?? 20);
  }
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
 * 执行一条会引用 users 表列的查询。
 *
 * 共享包默认按 `username_normalized` 取列，但各项目的 users 表列名不同
 * （有的是 email_normalized、有的没有展示名列）。调用方漏传 userShape 时，
 * SQLite 会报 "no such column: u.username_normalized" —— 很难看出是漏传参数。
 * 这里把错误翻译成能直接定位的提示。
 */
async function queryUsers<T>(
  db: D1Like,
  sql: string,
  values: unknown[],
): Promise<T | null> {
  try {
    return await db.prepare(sql).bind(...values).first<T>();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('no such column')) {
      throw new Error(
        `users 表查询失败（${message}）——该项目的登录名列名与默认形状不同，` +
          `请在调用时传 userShape（usernameColumn / usernameDisplayColumn / hasStatusColumn）`,
      );
    }
    throw error;
  }
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
  const userShape = options.userShape ?? DEFAULT_USER_SHAPE;
  const sessionShape = options.sessionShape ?? DEFAULT_SESSION_SHAPE;
  // 被禁用（status='disabled'）的账户，其会话立即失效
  const statusFilter = userShape.hasStatusColumn
    ? " AND u.status='active'"
    : "";
  const row = await queryUsers<Record<string, unknown>>(
    db,
    `SELECT ${sessionShape.hasIdColumn === false ? 's.user_id' : 's.id AS session_id'}, s.user_id, s.token_hash, s.expires_at,
            ${userColumns(options.userExtraColumns, 'u.', userShape)}
       FROM sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = ?${statusFilter}`,
    [tokenHash],
  );

  if (!row) return null;

  const expiresAt = String(row.expires_at ?? '');
  const expiry = Date.parse(expiresAt);
  if (!Number.isFinite(expiry) || expiry <= Date.now()) {
    if (sessionShape.hasIdColumn === false) {
      await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(tokenHash).run();
    } else {
      await db.prepare('DELETE FROM sessions WHERE id = ?').bind(String(row.session_id)).run();
    }
    return null;
  }

  // 登录名列名随项目而异：username_normalized / email_normalized …
  const usernameColumn = userShape.usernameColumn ?? 'username_normalized';
  const displayColumn = userShape.usernameDisplayColumn === undefined
    ? 'username'
    : userShape.usernameDisplayColumn;
  const normalized = String(row[usernameColumn] ?? '');
  const display = displayColumn ? String(row[displayColumn] ?? normalized) : normalized;

  const user: AuthUserRow = {
    id: String(row.id),
    username: display,
    username_normalized: normalized,
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
    username: display,
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
  const userShape = options.userShape ?? DEFAULT_USER_SHAPE;
  const column = userShape.usernameColumn ?? 'username_normalized';
  const normalized =
    userShape.usernameNormalization === 'none'
      ? username
      : username.toLocaleLowerCase('en-US');
  const row = await queryUsers<AuthUserRow>(
    db,
    `SELECT ${userColumns(options.userExtraColumns, '', userShape)} FROM users WHERE ${column} = ?`,
    [normalized],
  );
  return row ?? null;
}

/** 按 id 查用户 */
export async function findUserById(
  db: D1Like,
  id: string,
  options: SessionOptions = {},
): Promise<AuthUserRow | null> {
  const userShape = options.userShape ?? DEFAULT_USER_SHAPE;
  const row = await queryUsers<AuthUserRow>(
    db,
    `SELECT ${userColumns(options.userExtraColumns, '', userShape)} FROM users WHERE id = ?`,
    [id],
  );
  return row ?? null;
}

/** 插入用户 */
export async function insertUser(
  db: D1Like,
  user: {
    id: string;
    username: string;
    passwordHash: string;
    /**
     * 登录名（展示用）的值，默认与 username 相同。
     * 当展示名单列与登录名列不同（如登录名是 email、展示名是 display_name）时，
     * 传这个字段写进展示名列。
     */
    displayName?: string;
    /** 独立盐列的值（当 userShape.saltColumn 非 null 时使用） */
    salt?: string;
    /** 项目特有列，如 { email, nickname, status, role, grade_level } */
    extra?: Record<string, unknown>;
  },
  options: SessionOptions = {},
): Promise<void> {
  const userShape = options.userShape ?? DEFAULT_USER_SHAPE;
  const usernameColumn = userShape.usernameColumn ?? 'username_normalized';
  const displayColumn = userShape.usernameDisplayColumn === undefined
    ? 'username'
    : userShape.usernameDisplayColumn;
  const extraEntries = Object.entries(user.extra ?? {});
  const columns: string[] = [];
  const values: unknown[] = [];

  if (userShape.idMode !== 'autoincrement') {
    columns.push('id');
    values.push(user.id);
  }
  if (displayColumn) {
    columns.push(displayColumn);
    // 展示名列的值：显式给了 displayName 就用它，否则回落登录名
    values.push(user.displayName ?? user.username);
  }
  if (usernameColumn !== displayColumn) {
    columns.push(usernameColumn);
    values.push(
      userShape.usernameNormalization === 'none'
        ? user.username
        : user.username.toLocaleLowerCase('en-US'),
    );
  }
  columns.push('password_hash');
  values.push(user.passwordHash);
  if (userShape.saltColumn) {
    columns.push(userShape.saltColumn);
    values.push(user.salt ?? '');
  }
  columns.push('created_at');
  values.push(nowIso());
  if (userShape.hasLastLoginAt !== false) {
    columns.push('last_login_at');
    values.push(nowIso());
  }
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

/** 更新最后登录时间（无该列的表直接跳过） */
export async function touchLastLogin(
  db: D1Like,
  userId: string,
  options: SessionOptions = {},
): Promise<void> {
  const userShape = options.userShape ?? DEFAULT_USER_SHAPE;
  if (userShape.hasLastLoginAt === false) return;
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

/**
 * 记录一次认证尝试。
 *
 * @param scope 限流维度（如 'register' / 'login'），会作为 client_key 的前缀
 * @param clientKey 客户端标识（通常为 IP 的 sha256）
 */
export async function recordAuthAttempt(
  db: D1Like,
  scope: string,
  clientKey: string,
  succeeded: boolean,
): Promise<void> {
  await recordAuthAttemptRaw(db, `${scope}:${clientKey}`, succeeded);
}

/**
 * 记录一次认证尝试（client_key 原样写入，不加 scope 前缀）。
 *
 * 供已经把 scope 拼进 key 的项目直接使用，避免出现 `register:register:xxx`
 * 这种双前缀。
 *
 * 注意：`id` 列不显式插入。auth_attempts.id 在各项目都是
 * `INTEGER PRIMARY KEY AUTOINCREMENT`（SQLite 的 rowid 别名），
 * 往里插字符串会直接报 datatype mismatch，让 id 由数据库自增。
 */
export async function recordAuthAttemptRaw(
  db: D1Like,
  clientKey: string,
  succeeded: boolean,
): Promise<void> {
  await db
    .prepare('INSERT INTO auth_attempts (client_key,succeeded,created_at) VALUES (?,?,?)')
    .bind(clientKey, succeeded ? 1 : 0, nowIso())
    .run();
}

/** 清理过期的认证尝试记录 */
export async function pruneAuthAttempts(db: D1Like, retentionMs: number): Promise<void> {
  const cutoff = new Date(Date.now() - retentionMs).toISOString();
  await db.prepare('DELETE FROM auth_attempts WHERE created_at < ?').bind(cutoff).run();
}
