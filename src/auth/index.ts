/**
 * 统一认证契约出口
 *
 * 前端消费方从这里取类型与驱动工厂：
 * - createLocalAuthDriver  → 纯前端 IndexedDB（root-cause-analysis、personal_review_system）
 * - createRestAuthDriver   → 服务端 REST + HttpOnly Cookie（civil、ability、money、quant）
 *
 * 相对导入带显式扩展名：这样 Node ESM（node --test）也能直接
 * import 本包源码——Node 不做扩展名补全。
 */
export type {
  AuthState,
  AuthUser,
  AuthDriver,
  AuthCredential,
  AuthRegisterPayload,
  AuthResetPayload,
  AuthResetRequest,
  AuthErrorCode,
} from './types.ts';
export { AuthError, AUTH_ERROR_CODES } from './types.ts';
export { createLocalAuthDriver, getLocalCurrentAccountId, setLocalCurrentAccountId } from './localDriver.ts';
export type { LocalAccount, LocalAccountStore, LocalAuthDriverOptions, LocalHashFormat, LocalSessionMedium } from './localDriver.ts';
export { createRestAuthDriver } from './restDriver.ts';
export type { RestAuthDriverOptions } from './restDriver.ts';
export { AuthProvider, useAuth, useAuthUser, useAuthRole } from './AuthProvider.tsx';
export type { AuthContextValue, AuthProviderProps } from './AuthProvider.tsx';
