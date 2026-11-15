/**
 * 服务端认证核心（Cloudflare Workers / Pages Functions 运行时）
 *
 * 收归各项目后端重复的认证实现：
 * - civil-exam-drill   functions/api/[[path]].ts
 * - ability-growth-system functions/api/[[path]].ts
 * - money-growth-system backend/routes/auth.ts
 * - quant-trading-system server/
 *
 * 统一后的契约：
 * - 密码哈希：`pbkdf2-sha256$<iterations>$<base64 salt>$<base64 hash>`（与 ability/civil 现有格式一致，可直接校验历史数据）
 * - 会话：随机 64 位 hex token，**库里只存 sha256(token)**，Cookie 走 HttpOnly
 * - 错误：统一 `{ success: false, error: { code, message } }` 信封
 *
 * 本模块只依赖 Web Crypto，**不依赖 Hono / 任何框架**，
 * 各项目可自由选择自己的路由层（Hono、裸 Pages Functions 均可）。
 */

/** 密码哈希迭代次数：Workers WebCrypto 上限 100000，浏览器同值，跨端兼容 */
export const PASSWORD_ITERATIONS = 100_000;

/** 密码哈希方案标识 */
export const PASSWORD_SCHEME = 'pbkdf2-sha256';

/** 默认会话有效期（天） */
export const SESSION_DAYS = 30;

/** 默认每用户保留的会话数上限 */
export const MAX_SESSIONS_PER_USER = 20;

const encoder = new TextEncoder();

/** 通用响应信封 */
export interface AuthOk<T> {
  success: true;
  data: T;
}

export interface AuthFail {
  success: false;
  error: { code: string; message: string };
}

export type AuthEnvelope<T> = AuthOk<T> | AuthFail;

export function authOk<T>(data: T): AuthOk<T> {
  return { success: true, data };
}

export function authFail(code: string, message: string): AuthFail {
  return { success: false, error: { code, message } };
}

/** 标准错误码 */
export const AUTH_CODES = {
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  EMAIL_TAKEN: 'EMAIL_TAKEN',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_REQUEST: 'INVALID_REQUEST',
  UNAUTHORIZED: 'UNAUTHORIZED',
  SERVER_ERROR: 'SERVER_ERROR',
} as const;

// ===== 编码工具 =====

export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

export function fromBase64(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

export function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(view)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return toHex(bytes);
}

/**
 * 生成会话 token：两个 UUID 拼接去横线，64 位 hex。
 * 各项目历史实现一致（ability / civil / money-growth 均为此格式）。
 *
 * 用 split/join 而不是 replaceAll —— 部分消费方的 tsconfig lib 仍是
 * ES2020，而 replaceAll 要 ES2021 才有。
 */
export function generateSessionToken(): string {
  return `${crypto.randomUUID()}${crypto.randomUUID()}`.split('-').join('');
}

/**
 * 生成会话 id。
 */
export function generateSessionId(): string {
  return `ses_${crypto.randomUUID()}`;
}

// ===== 密码哈希 =====

/**
 * 盐的处理方式。
 *
 * - 'bytes'    —— 盐是随机字节，直接作为 PBKDF2 的 salt（civil / ability / money-growth）
 * - 'utf8'     —— 盐是字符串，按其 UTF-8 字节作为 salt（quant-trading-agent/journal：
 *                 盐用 randomToken 生成的是 base64url 字符串，再取其 UTF-8 字节）
 *
 * 两种方式的派生结果不同，写错一个字符老用户就登不进来，因此必须由调用方声明。
 */
export type SaltHandling = 'bytes' | 'utf8';

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/**
 * 生成密码哈希。
 * 格式：`pbkdf2-sha256$100000$<base64 salt>$<base64 hash>`
 * 与 ability-growth / civil-exam-drill 现有格式完全一致，历史用户无需重置密码。
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derivePassword(password, salt, PASSWORD_ITERATIONS);
  return `${PASSWORD_SCHEME}$${PASSWORD_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

/** 历史哈希格式：盐独立成列，存裸 hex 摘要（money-growth-system） */
export interface LegacyHashInput {
  /** 裸 hex 摘要 */
  hash: string;
  /** hex 盐 */
  salt?: string;
}

/**
 * 识别并校验历史哈希格式。
 *
 * 收口时各项目历史用户的密码哈希有四种形态，全部要能校验，
 * 否则迁移当天所有老用户会被锁在门外：
 * 1. `pbkdf2-sha256$<iter>$<b64 salt>$<b64 hash>` —— civil / ability（当前统一格式）
 * 2. 裸 hex 摘要 + 独立 salt 列             —— money-growth-system
 * 3. `<b64 salt>:<b64 hash>`                —— personal_review_system（本地）
 * 4. base64url 摘要 + 独立 salt 列           —— quant-trading-agent/journal
 *
 * @param stored 主存储值（格式 1 时是整串，格式 2/4 时是裸摘要，格式 3 时是组合串）
 * @param legacySalt 格式 2/4 的独立盐列
 * @param legacySaltEncoding 独立盐列的编码，默认 'hex'；格式 4 用 'base64url'
 * @param legacyIterations 独立盐列格式的迭代次数，默认 100000；
 *        若项目把迭代次数存进独立列（用户注册时的值可能不是默认值），必须传这个值
 * @param legacySaltHandling 独立盐列的字节处理方式，默认 'bytes'；
 *        盐是字符串并按其 UTF-8 字节参与派生的项目传 'utf8'
 */
export async function verifyPassword(
  password: string,
  stored: string | null,
  legacySalt?: string | null,
  legacySaltEncoding: 'hex' | 'base64url' = 'hex',
  legacyIterations?: number,
  legacySaltHandling: SaltHandling = 'bytes',
): Promise<boolean> {
  if (!stored) return false;

  // 格式 1：统一格式
  if (stored.includes('$')) {
    const [scheme, iterationsRaw, saltBase64, hashBase64] = stored.split('$');
    const iterations = Number(iterationsRaw);
    if (
      scheme !== PASSWORD_SCHEME ||
      !Number.isInteger(iterations) ||
      iterations < 1000 ||
      !saltBase64 ||
      !hashBase64
    ) {
      return false;
    }
    const expected = fromBase64(hashBase64);
    const actual = await derivePassword(password, fromBase64(saltBase64), iterations);
    return constantTimeEqual(actual, expected);
  }

  // 格式 3：base64 盐哈希组合串（personal_review_system）
  if (stored.includes(':')) {
    const separator = stored.indexOf(':');
    const salt = fromBase64(stored.slice(0, separator));
    const expected = stored.slice(separator + 1);
    const actual = await derivePassword(password, salt, PASSWORD_ITERATIONS);
    return toBase64(actual) === expected;
  }

  // 格式 2/4：裸摘要 + 独立盐列（money-growth / journal）
  if (legacySalt) {
    const salt =
      legacySaltEncoding === 'base64url'
        ? // 'utf8' 模式下盐是字符串，取其 UTF-8 字节；'bytes' 模式下是 base64url 解码后的字节
          (legacySaltHandling === 'utf8'
            ? encoder.encode(legacySalt)
            : fromBase64Url(legacySalt))
        : fromHex(legacySalt);
    // 迭代次数可由调用方指定——有些项目把迭代次数存进独立列
    // （用户注册时的值可能是非默认值），写死 100000 会导致校验失败。
    const actual = await derivePassword(password, salt, legacyIterations ?? PASSWORD_ITERATIONS);
    return legacySaltEncoding === 'base64url'
      ? toBase64Url(actual) === stored
      : toHex(actual) === stored;
  }

  return false;
}

/** base64url → bytes */
export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const withPadding = padded + '='.repeat((4 - (padded.length % 4)) % 4);
  return fromBase64(withPadding);
}

/** bytes → base64url（无 padding） */
export function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** 常量时间比较，避免时序侧信道 */
export function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a[index] ^ b[index];
  }
  return diff === 0;
}

/** hex → bytes */
export function fromHex(hex: string): Uint8Array {
  const bytes = hex.match(/.{2}/g) ?? [];
  return Uint8Array.from(bytes.map((b) => parseInt(b, 16)));
}

/**
 * 哑元哈希：用户不存在时也跑一次 PBKDF2，
 * 让"用户不存在"和"密码错误"的响应耗时接近，降低用户名枚举价值。
 */
let dummyPasswordHash: Promise<string> | null = null;

export function getDummyPasswordHash(): Promise<string> {
  dummyPasswordHash ??= hashPassword('dummy-password-not-used');
  return dummyPasswordHash;
}

// ===== 会话 =====

/** 会话记录 */
export interface AuthSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: string;
  createdAt: string;
}

// ===== Cookie =====

export interface CookieOptions {
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Strict' | 'Lax' | 'None';
  maxAge?: number;
}

/** 拼 Set-Cookie 头的值 */
export function buildCookie(name: string, value: string, options: CookieOptions = {}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Strict'}`);
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  return parts.join('; ');
}

/** 拼清除 Cookie 的值 */
export function buildClearCookie(name: string, options: CookieOptions = {}): string {
  return buildCookie(name, '', { ...options, maxAge: 0 });
}

/** 从 Request 读 Cookie */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index === -1) continue;
    if (part.slice(0, index).trim() === name) {
      return decodeURIComponent(part.slice(index + 1).trim());
    }
  }
  return undefined;
}

/** 判断请求是否 https（用于决定 Cookie 是否加 Secure） */
export function isSecureRequest(request: Request): boolean {
  const url = new URL(request.url);
  if (url.protocol === 'https:') return true;
  // Cloudflare 转发时原始协议在 X-Forwarded-Proto
  const forwarded = request.headers.get('X-Forwarded-Proto');
  return forwarded === 'https';
}
