/**
 * 公共基座类型定义：模板驱动表单引擎的核心类型契约
 * 三个项目（公考复盘、根因分析、个人复盘）共用此类型系统
 */

/** 表单字段类型 */
export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'date'
  | 'datetime'
  | 'select'
  | 'radio'
  | 'checkbox'
  | 'rating'
  | 'table'
  | 'custom'
  | 'hidden';

/** 选项定义 */
export interface FieldOption {
  value: string;
  label: string;
}

/** 表格列定义 */
export interface TableColumn {
  id: string;
  label: string;
  type?: 'text' | 'number' | 'select';
  options?: FieldOption[];
  placeholder?: string;
}

/** 字段校验规则 */
export interface FieldValidation {
  min?: number;
  max?: number;
  maxLength?: number;
  pattern?: RegExp;
  patternMessage?: string;
}

/** 字段显隐条件 */
export interface FieldCondition {
  dependsOn: string;
  showWhen: string | string[];
}

/** 字段计算公式 */
export interface FieldComputed {
  dependsOn: string[];
  formula: (values: Record<string, unknown>) => string | unknown;
  placeholder?: string;
  errorText?: string;
  editable?: boolean;
}

/** 表单字段定义 */
export interface FormField {
  id: string;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: FieldOption[];
  validation?: FieldValidation;
  tableColumns?: TableColumn[];
  priority?: 'required' | 'recommended' | 'optional';
  condition?: FieldCondition;
  hint?: string;
  defaultValue?: unknown;
  autocomplete?: boolean;
  emphasis?: boolean;
  computed?: FieldComputed;
  collapsedByDefault?: boolean;
  autoTimestamp?: boolean;
}

/** 表单分区 */
export interface FormSection {
  id: string;
  title: string;
  description?: string;
  fields: FormField[];
  collapsedByDefault?: boolean;
  repeatable?: boolean;
  repeatLabel?: string;
  minEntries?: number;
  stopAppendWhen?: { fieldId: string; value: string };
}

/** 阶段配置 */
export interface PhaseConfig {
  id: string;
  label: string;
  icon: string;
  description?: string;
  sectionIndices: number[];
  completionFields: string[];
  completesRecord?: boolean;
}

/** 表单模板 */
export interface FormTemplate {
  id: string;
  name: string;
  icon: string;
  description: string;
  module?: string;
  recommended?: boolean;
  scenarios?: string[];
  flowSteps?: string[];
  sections: FormSection[];
  phases?: PhaseConfig[];
  timing?: { frequency: string; suggestion: string };
}

/** 表单记录 */
export interface FormRecord {
  id: string;
  templateId: string;
  title: string;
  data: Record<string, unknown>;
  status: 'draft' | 'completed';
  createdAt: string;
  updatedAt: string;
  tags?: string[];
  module?: string;
}

/** 账户 */
export interface Account {
  id: string;
  username: string;
  passwordHash: string;
  salt: string;
  createdAt: string;
}

/** 应用设置 */
export interface AppSettings {
  cooldownDays: number;
  d1Endpoint?: string;
  autoSync?: boolean;
  syncInterval?: number;
}

/** 同步状态 */
export interface SyncStatus {
  lastSyncAt: string | null;
  pendingChanges: number;
  isOnline: boolean;
}

/** 同步结果 */
export interface SyncResult {
  success: boolean;
  pushed: number;
  pulled: number;
  conflicts: number;
  timestamp: string;
  error?: string;
}

/** 导出数据格式 */
export interface ExportedData {
  records: FormRecord[];
  settings: Record<string, unknown>;
  version: string;
  exportedAt: string;
}
