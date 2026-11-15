/**
 * 统一认证契约出口
 *
 * 前端消费方从这里取类型与驱动工厂：
 * - createLocalAuthDriver  → 纯前端 IndexedDB（root-cause-analysis、personal_review_system）
 * - createRestAuthDriver   → 服务端 REST + HttpOnly Cookie（civil、ability、money、quant）
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
} from './types';
export { AuthError, AUTH_ERROR_CODES } from './types';
export { createLocalAuthDriver, getLocalCurrentAccountId, setLocalCurrentAccountId } from './localDriver';
export type { LocalAccount, LocalAccountStore, LocalAuthDriverOptions, LocalHashFormat, LocalSessionMedium } from './localDriver';
export { createRestAuthDriver } from './restDriver';
export type { RestAuthDriverOptions } from './restDriver';
export { AuthProvider, useAuth, useAuthUser, useAuthRole } from './AuthProvider';
export type { AuthContextValue, AuthProviderProps } from './AuthProvider';
