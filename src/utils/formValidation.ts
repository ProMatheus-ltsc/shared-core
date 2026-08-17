/**
 * 表单校验工具函数
 * 复用自 root-cause-analysis / personal_review_system
 */
import type { FormField, FormSection, FormTemplate } from '../types';

/** 判断字段值是否为空 */
export function isFieldEmpty(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  if (Array.isArray(value) && value.length === 0) return true;
  if (typeof value === 'object' && Object.keys(value).length === 0) return true;
  return false;
}

/** 解析默认值（支持 magic string） */
export function resolveDefaultValue(defaultValue: unknown): unknown {
  if (typeof defaultValue !== 'string') return defaultValue;

  if (defaultValue === 'auto_today') {
    return new Date().toISOString().split('T')[0];
  }
  if (defaultValue === 'auto_now') {
    return new Date().toISOString().slice(0, 16);
  }
  if (defaultValue.startsWith('auto_now+')) {
    const days = parseInt(defaultValue.replace('auto_now+', ''), 10);
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().split('T')[0];
  }

  return defaultValue;
}

/** 获取模板所有必填字段 */
export function getRequiredFields(template: FormTemplate): FormField[] {
  return template.sections.flatMap((s) => s.fields.filter((f) => f.required));
}

/** 校验必填字段是否已填 */
export function validateRequiredFields(
  template: FormTemplate,
  data: Record<string, unknown>
): { valid: boolean; missingFields: string[] } {
  const required = getRequiredFields(template);
  const missingFields = required
    .filter((f) => isFieldEmpty(data[f.id]))
    .map((f) => f.label);

  return { valid: missingFields.length === 0, missingFields };
}

/** 计算表单填写完成度（百分比） */
export function calculateCompleteness(
  template: FormTemplate,
  data: Record<string, unknown>
): number {
  const allFields = template.sections.flatMap((s) => s.fields);
  if (allFields.length === 0) return 100;

  const filled = allFields.filter((f) => !isFieldEmpty(data[f.id])).length;
  return Math.round((filled / allFields.length) * 100);
}

/** 获取阶段对应的分区 */
export function getPhaseSections(
  template: FormTemplate,
  phaseIndex: number
): FormSection[] {
  const phase = template.phases?.[phaseIndex];
  if (!phase) return template.sections;
  return phase.sectionIndices.map((i) => template.sections[i]).filter(Boolean);
}

/** 构建表单初始值 */
export function buildInitialValues(template: FormTemplate): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const section of template.sections) {
    for (const field of section.fields) {
      if (field.defaultValue !== undefined) {
        values[field.id] = resolveDefaultValue(field.defaultValue);
      }
    }
  }
  return values;
}
