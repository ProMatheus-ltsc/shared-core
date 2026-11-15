/**
 * 统一认证 Provider / Hook
 *
 * 所有项目统一用这一套会话状态机，认证后端由 `driver` 注入：
 * - 本地模式：createLocalAuthDriver（IndexedDB）
 * - 服务端模式：createRestAuthDriver（REST + HttpOnly Cookie）
 *
 * 相比各项目原先各自实现的 useAuth，这里统一了：
 * - 状态机四态：loading / firstTime / login / authenticated
 * - 错误处理：统一 AuthError（含 code），同时保留 error 字符串便于直接展示
 * - 登出：统一 await，不同步返回
 *
 * 相比 shared-core 原 `hooks/useAuth.tsx` 的改动（向后兼容）：
 * - 原 `useAuth()` 返回 `{ state, account, login, register, logout, resetPassword, error }`，
 *   本模块保留同名同形状的字段，并额外提供 `user`（统一 AuthUser）与 `driver`。
 * - 原 `login/register/resetPassword` 返回 Promise<boolean>，本模块保持一致，
 *   同时抛出 AuthError 以便需要区分错误码的调用方使用。
 */
import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import type { AuthDriver, AuthUser, AuthState, AuthCredential, AuthRegisterPayload, AuthResetPayload } from './types';
import { AuthError } from './types';

export interface AuthContextValue {
  /** 四态状态机 */
  state: AuthState;
  /** 当前登录用户（统一 AuthUser）；未登录为 null */
  user: AuthUser | null;
  /** 兼容字段：原始账号对象（本地模式为 Account，服务端模式为后端 user 载荷） */
  account: (AuthUser & Record<string, unknown>) | null;
  /** 是否处于初始化中 */
  initializing: boolean;
  /** 最近一次错误消息 */
  error: string | null;
  /** 最近一次错误的错误码 */
  errorCode: string | null;
  login: (username: string, password: string) => Promise<boolean>;
  register: (username: string, password: string) => Promise<boolean>;
  /** 带完整载荷的注册（支持 email / displayName / extra） */
  registerWith: (payload: AuthRegisterPayload) => Promise<boolean>;
  logout: () => Promise<void>;
  resetPassword: (username: string, newPassword: string) => Promise<boolean>;
  /** 驱动实例，消费方可用于调用驱动特有的扩展能力（如发送重置邮件） */
  driver: AuthDriver;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export interface AuthProviderProps {
  /** 认证驱动；不传则用传入的 children 之外的默认（见 AuthProvider 的 driver 必填） */
  driver: AuthDriver;
  /**
   * 失败时的表达方式，默认 'boolean'。
   * - 'boolean' —— 登录/注册/重置失败时返回 false，错误信息在 `error` 字段
   * - 'throw'   —— 失败时抛出 AuthError，由调用方 try/catch 捕获
   *
   * 两种都合法：布尔式适合"表单里读 error 字段"，抛异常式适合
   * "await 之后直接导航"的写法。项目按自己的调用习惯选，不必改写业务代码。
   */
  errorMode?: 'boolean' | 'throw';
  children: React.ReactNode;
}

export function AuthProvider({ driver, errorMode = 'boolean', children }: AuthProviderProps) {
  const [state, setState] = useState<AuthState>('loading');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const clearError = useCallback(() => {
    setError(null);
    setErrorCode(null);
  }, []);

  /** 统一错误捕获：把 AuthError / Error 转成可展示文案 */
  const captureError = useCallback((e: unknown, fallback: string) => {
    if (e instanceof AuthError) {
      setError(e.message);
      setErrorCode(e.code);
      return;
    }
    setError(e instanceof Error ? e.message : fallback);
    setErrorCode('SERVER_ERROR');
  }, []);

  /**
   * 失败处理：按 errorMode 决定是抛异常还是返回 false。
   * 抛异常时把 AuthError 原样抛出（保留 code），非 AuthError 包一层。
   */
  const handleFailure = useCallback(
    (e: unknown, fallback: string): false => {
      captureError(e, fallback);
      if (errorMode === 'throw') {
        if (e instanceof AuthError) throw e;
        throw new AuthError('SERVER_ERROR', e instanceof Error ? e.message : fallback);
      }
      return false;
    },
    [captureError, errorMode],
  );

  // 启动时恢复会话
  useEffect(() => {
    let cancelled = false;
    async function init() {
      try {
        const restored = await driver.restore();
        if (cancelled) return;
        if (restored) {
          setUser(restored);
          setState('authenticated');
          return;
        }
        const firstTime = await driver.isFirstTime();
        if (cancelled) return;
        setState(firstTime ? 'firstTime' : 'login');
      } catch {
        if (cancelled) return;
        setState('login');
      }
    }
    void init();
    return () => {
      cancelled = true;
    };
  }, [driver]);

  const login = useCallback(
    async (username: string, password: string) => {
      clearError();
      try {
        const next = await driver.login({ username, password } satisfies AuthCredential);
        setUser(next);
        setState('authenticated');
        return true;
      } catch (e) {
        return handleFailure(e, '登录失败');
      }
    },
    [driver, clearError, handleFailure],
  );

  const registerWith = useCallback(
    async (payload: AuthRegisterPayload) => {
      clearError();
      try {
        const next = await driver.register(payload);
        setUser(next);
        setState('authenticated');
        return true;
      } catch (e) {
        return handleFailure(e, '注册失败');
      }
    },
    [driver, clearError, handleFailure],
  );

  const register = useCallback(
    (username: string, password: string) => registerWith({ username, password }),
    [registerWith],
  );

  const logout = useCallback(async () => {
    clearError();
    try {
      await driver.logout();
    } catch (e) {
      captureError(e, '登出失败');
    }
    setUser(null);
    setState('login');
  }, [driver, clearError, captureError]);

  const resetPassword = useCallback(
    async (username: string, newPassword: string) => {
      clearError();
      try {
        await driver.resetPassword?.({ username, newPassword } satisfies AuthResetPayload);
        return true;
      } catch (e) {
        return handleFailure(e, '重置失败');
      }
    },
    [driver, clearError, handleFailure],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      state,
      user,
      account: user as (AuthUser & Record<string, unknown>) | null,
      initializing: state === 'loading',
      error,
      errorCode,
      login,
      register,
      registerWith,
      logout,
      resetPassword,
      driver,
    }),
    [state, user, error, errorCode, login, register, registerWith, logout, resetPassword, driver],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

/** 便捷 hook：只要当前用户 */
export function useAuthUser(): AuthUser | null {
  return useAuth().user;
}

/** 便捷 hook：只要角色（项目特有字段约定放在 extra.role） */
export function useAuthRole(): string | undefined {
  const { user } = useAuth();
  const role = user?.extra?.role;
  return typeof role === 'string' ? role : undefined;
}
