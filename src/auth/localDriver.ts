/**
 * 本地认证驱动（IndexedDB）
 *
 * 适用于纯前端项目：root-cause-analysis、personal_review_system。
 * 密码用 PBKDF2-SHA256 + 16 字节随机盐哈希，账号存在 IndexedDB，
 * 登录态存 localStorage。与 shared-core 原 services/auth.ts 行为一致，
 * 但改为实现 AuthDriver 接口，从而与 REST 驱动可互换。
 */
import { v4 as uuidv4 } from 'uuid';
import type { AuthDriver, AuthCredential, AuthRegisterPayload, AuthResetPayload, AuthUser } from './types';
import { AuthError, AUTH_ERROR_CODES } from './types';

/**
 * PBKDF2 迭代次数。
 * 100000 是 Workers WebCrypto 与浏览器 SubtleCrypto 的共同兼容上限。
 */
const PBKDF2_ITERATIONS = 100_000;

/**
 * 本地密码哈希的存储格式。
 *
 * 历史项目有两种格式，收口时必须都支持，否则老用户会全部无法登录：
 * - `hex`   —— 盐与哈希分开存：`salt` 字段（hex）+ `passwordHash` 字段（hex）
 *              —— root-cause-analysis、shared-core 原实现
 * - `base64`—— 盐与哈希拼在一个字段：`"<base64salt>:<base64hash>"`
 *              —— personal_review_system
 */
export type LocalHashFormat = 'hex' | 'base64';

/** 两种格式共用的账户结构：字段存在与否取决于 hashFormat */
export interface LocalAccount {
  id: string;
  username: string;
  /** hex 格式下为哈希值；base64 格式下为 `saltB64:hashB64` 组合串 */
  passwordHash: string;
  /** hex 格式下为盐；base64 格式下为空（盐在 passwordHash 里） */
  salt?: string;
  createdAt: string;
  /** 昵称 */
  displayName?: string;
  /** 项目特有字段 */
  extra?: Record<string, unknown>;
}

/** 会话存储介质 */
export type LocalSessionMedium = 'localStorage' | 'sessionStorage';

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): ArrayBuffer {
  const bytes = hex.match(/.{2}/g) ?? [];
  return new Uint8Array(bytes.map((b) => parseInt(b, 16))).buffer;
}

function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function fromBase64(value: string): Uint8Array {
  const raw = atob(value);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

function randomSaltHex(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return toHex(bytes.buffer);
}

async function derivePasswordHash(password: string, salt: ArrayBuffer | Uint8Array): Promise<ArrayBuffer> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256,
  );
  return derivedBits;
}

/** 存储适配器：把账户读写接到具体项目的 IndexedDB 实现上 */
export interface LocalAccountStore {
  list(): Promise<LocalAccount[]>;
  findByUsername(username: string): Promise<LocalAccount | undefined>;
  put(account: LocalAccount): Promise<void>;
}

/** 会话存储：默认 localStorage，键名可配 */
export interface LocalSessionStore {
  get(): string | null;
  set(accountId: string): void;
  clear(): void;
}

function defaultSessionStore(storageKey: string, medium: LocalSessionMedium): LocalSessionStore {
  const storage =
    medium === 'sessionStorage'
      ? typeof sessionStorage !== 'undefined'
        ? sessionStorage
        : null
      : typeof localStorage !== 'undefined'
        ? localStorage
        : null;
  return {
    get: () => {
      try {
        return storage?.getItem(storageKey) ?? null;
      } catch {
        return null;
      }
    },
    set: (accountId) => {
      try {
        storage?.setItem(storageKey, accountId);
      } catch {
        /* 隐私模式下写入失败：登录态退化为仅内存 */
      }
    },
    clear: () => {
      try {
        storage?.removeItem(storageKey);
      } catch {
        /* ignore */
      }
    },
  };
}

/** 当前登录账户 id 的内存镜像（供业务数据层做账户隔离） */
let currentAccountId: string | undefined;

export function getLocalCurrentAccountId(): string | undefined {
  return currentAccountId;
}

export function setLocalCurrentAccountId(accountId: string | undefined): void {
  currentAccountId = accountId;
}

function toUser(account: LocalAccount): AuthUser {
  return {
    id: account.id,
    username: account.username,
    displayName: account.displayName,
    extra: account.extra,
  };
}

export interface LocalAuthDriverOptions {
  /** 账户存储（由项目提供，接自己的 IndexedDB 实现） */
  store: LocalAccountStore;
  /** 会话存储键名，默认 `${prefix}-current-account` */
  storageKey?: string;
  /** 账户存储前缀，用于生成默认 storageKey */
  prefix?: string;
  /**
   * 密码哈希的存储格式，默认 'hex'。
   * - 'hex'    —— salt 字段(hex) + passwordHash 字段(hex)，root-cause-analysis 格式
   * - 'base64' —— passwordHash 字段为 "<base64salt>:<base64hash>"，personal_review_system 格式
   */
  hashFormat?: LocalHashFormat;
  /** 会话存储介质，默认 'localStorage'；personal_review_system 用 'sessionStorage' */
  sessionMedium?: LocalSessionMedium;
  /** 账户 id 生成方式，默认 uuid；personal_review_system 历史上用 username 当 id */
  accountIdStrategy?: 'uuid' | 'username';
}

/** 按配置的格式计算密码哈希 */
async function computeLocalHash(
  password: string,
  format: LocalHashFormat,
  saltHex?: string,
): Promise<{ passwordHash: string; salt?: string }> {
  if (format === 'base64') {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const bits = await derivePasswordHash(password, salt);
    return { passwordHash: `${toBase64(salt)}:${toBase64(new Uint8Array(bits))}` };
  }
  const salt = saltHex ?? randomSaltHex();
  const bits = await derivePasswordHash(password, fromHex(salt));
  return { passwordHash: toHex(bits), salt };
}

/** 校验本地密码：按配置的格式解析盐并比对 */
async function checkLocalHash(
  password: string,
  format: LocalHashFormat,
  account: LocalAccount,
): Promise<boolean> {
  if (format === 'base64') {
    const separator = account.passwordHash.indexOf(':');
    if (separator === -1) return false;
    const salt = fromBase64(account.passwordHash.slice(0, separator));
    const expected = account.passwordHash.slice(separator + 1);
    const bits = await derivePasswordHash(password, salt);
    return toBase64(new Uint8Array(bits)) === expected;
  }
  if (!account.salt) return false;
  const bits = await derivePasswordHash(password, fromHex(account.salt));
  return toHex(bits) === account.passwordHash;
}

/**
 * 创建本地认证驱动。
 *
 * @example hex 格式（root-cause-analysis）
 * createLocalAuthDriver({ store, prefix: 'rca-app', hashFormat: 'hex' })
 *
 * @example base64 格式（personal_review_system）
 * createLocalAuthDriver({
 *   store,
 *   sessionMedium: 'sessionStorage',
 *   storageKey: 'review-app-auth-account',
 *   hashFormat: 'base64',
 *   accountIdStrategy: 'username',
 * })
 */
export function createLocalAuthDriver(options: LocalAuthDriverOptions): AuthDriver {
  const { store } = options;
  const hashFormat = options.hashFormat ?? 'hex';
  const idStrategy = options.accountIdStrategy ?? 'uuid';
  const storageKey = options.storageKey ?? `${options.prefix ?? 'shared-app'}-current-account`;
  const session = defaultSessionStore(storageKey, options.sessionMedium ?? 'localStorage');

  return {
    async restore(): Promise<AuthUser | null> {
      const accounts = await store.list();
      const savedId = session.get();
      if (!savedId) return null;
      const found = accounts.find((a) => a.id === savedId);
      if (!found) {
        session.clear();
        return null;
      }
      setLocalCurrentAccountId(found.id);
      return toUser(found);
    },

    async isFirstTime(): Promise<boolean> {
      const accounts = await store.list();
      return accounts.length === 0;
    },

    async login(credential: AuthCredential): Promise<AuthUser> {
      const account = await store.findByUsername(credential.username);
      if (!account) {
        throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, '用户名或密码不正确');
      }
      if (!(await checkLocalHash(credential.password, hashFormat, account))) {
        throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, '用户名或密码不正确');
      }
      setLocalCurrentAccountId(account.id);
      session.set(account.id);
      return toUser(account);
    },

    async register(payload: AuthRegisterPayload): Promise<AuthUser> {
      const existing = await store.findByUsername(payload.username);
      if (existing) {
        throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, '用户名已存在');
      }
      const { passwordHash, salt } = await computeLocalHash(payload.password, hashFormat);
      const account: LocalAccount = {
        id: idStrategy === 'username' ? payload.username : uuidv4(),
        username: payload.username,
        passwordHash,
        salt,
        createdAt: new Date().toISOString(),
        displayName: payload.displayName,
        extra: payload.extra,
      };
      await store.put(account);
      setLocalCurrentAccountId(account.id);
      session.set(account.id);
      return toUser(account);
    },

    async logout(): Promise<void> {
      setLocalCurrentAccountId(undefined);
      session.clear();
    },

    async resetPassword(payload: AuthResetPayload): Promise<void> {
      const account = await store.findByUsername(payload.username);
      if (!account) {
        throw new AuthError(AUTH_ERROR_CODES.INVALID_CREDENTIALS, '用户名不存在');
      }
      const { passwordHash, salt } = await computeLocalHash(payload.newPassword, hashFormat);
      await store.put({ ...account, salt, passwordHash });
    },
  };
}
