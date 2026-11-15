/**
 * 认证 Hook + Provider（向后兼容入口）
 *
 * 实现已下沉到 `@shared/core/auth`（统一认证基座）。本文件保留旧路径
 * `@shared/core/hooks/useAuth`，让既有消费方无需改 import 即可用上新实现。
 *
 * 与旧版的差异：
 * - 认证算法与状态机由 shared-core 的 `AuthProvider` 提供
 * - `account` 字段保留（旧消费方在用），值为统一的 `AuthUser`
 * - 新增 `user` / `errorCode` / `registerWith` / `driver`
 *
 * 不传 `driver` 时自动使用包内本地 IndexedDB 驱动（与旧版行为一致）：
 * - 账户存 `${getDBPrefix()}` 库的 accounts 表
 * - 登录态存 localStorage `${getDBPrefix()}-current-account`
 * - 哈希格式 hex（盐与哈希分列），与历史数据兼容
 */
import React, { useMemo } from 'react';
import {
  AuthProvider as SharedAuthProvider,
  createLocalAuthDriver,
  useAuth as useSharedAuth,
  type AuthDriver,
} from '../auth';
import { listAccounts, getAccountByUsername, createAccount, getDBPrefix } from '../services/db';
import type { Account } from '../types';

/** 状态机四态 */
export type AuthState = 'loading' | 'firstTime' | 'login' | 'authenticated';

/**
 * 上下文结构：与 shared-core 的统一上下文一致。
 * 额外保留 `account` 别名（旧消费方在用）。
 */
export type AuthContextType = ReturnType<typeof useSharedAuth>;

/** 包内本地驱动：接 shared-core 自己的 IndexedDB 数据层 */
function createPackageLocalDriver(): AuthDriver {
  return createLocalAuthDriver({
    store: {
      list: async () =>
        (await listAccounts()).map((account: Account) => ({
          id: account.id,
          username: account.username,
          passwordHash: account.passwordHash,
          salt: account.salt,
          createdAt: account.createdAt,
        })),
      findByUsername: async (username) => {
        const found = await getAccountByUsername(username);
        if (!found) return undefined;
        return {
          id: found.id,
          username: found.username,
          passwordHash: found.passwordHash,
          salt: found.salt,
          createdAt: found.createdAt,
        };
      },
      put: async (account) => {
        await createAccount(account as Account);
      },
    },
    hashFormat: 'hex',
    sessionMedium: 'localStorage',
    storageKey: `${getDBPrefix()}-current-account`,
  });
}

/**
 * 认证 Provider。
 * @param driver 可选的认证驱动；不传则用包内本地 IndexedDB 驱动（旧版行为）
 */
export function AuthProvider({
  children,
  driver,
}: {
  children: React.ReactNode;
  driver?: AuthDriver;
}) {
  const resolved = useMemo(() => driver ?? createPackageLocalDriver(), [driver]);
  return (
    <SharedAuthProvider driver={resolved} errorMode="boolean">
      {children}
    </SharedAuthProvider>
  );
}

/**
 * 取用认证数据的 hook。必须在 <AuthProvider> 内部使用。
 */
export function useAuth(): AuthContextType {
  return useSharedAuth();
}
