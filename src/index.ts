/**
 * @shared/core - 三项目共用的公共基座包
 * 统一导出所有类型、服务、Hooks、组件和工具函数
 */

// Types
export * from './types';

// Services
export { 
  setCurrentAccountId, getCurrentAccountId,
  listAccounts, getAccountByUsername, createAccount,
  getAllRecords, getRecord, putRecord, deleteRecord, deleteRecords,
  getRecordsByTemplate, getRecordsByModule, searchRecords,
  getSetting, setSetting,
  exportAllData, importAllData, clearAllData,
  getRecordsModifiedSince,
} from './services/db';
export { registerAccount, verifyAccountPassword, resetAccountPassword } from './services/auth';
export { 
  configureSyncService, getSyncConfig, getSyncStatus,
  pushChanges, pullChanges, fullBackupToD1, restoreFromD1,
} from './services/cloudflareD1';

// Hooks
export { AuthProvider, useAuth } from './hooks/useAuth';
export { ToastProvider, useToast } from './hooks/useToast';
export type { ToastType, ToastMessage } from './hooks/useToast';
export { useRecords, useRecord, useSaveRecord, useDeleteRecord, useSearchRecords } from './hooks/useDB';
export { usePhaseLogic } from './hooks/usePhaseLogic';
export type { PhaseState } from './hooks/usePhaseLogic';

// Utils
export {
  isFieldEmpty, resolveDefaultValue, getRequiredFields,
  validateRequiredFields, calculateCompleteness,
  getPhaseSections, buildInitialValues,
} from './utils/formValidation';
