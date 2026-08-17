/**
 * 可重复分区组件：支持动态添加/删除条目
 * 复用自 root-cause-analysis / personal_review_system
 */
import { useState } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import type { FormSection } from '../../types';
import { FieldRenderer } from './FieldRenderer';

interface RepeatableSectionProps {
  section: FormSection;
  entries: Record<string, unknown>[];
  onChange: (entries: Record<string, unknown>[]) => void;
  disabled?: boolean;
}

export function RepeatableSection({
  section,
  entries,
  onChange,
  disabled = false,
}: RepeatableSectionProps) {
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());

  const addEntry = () => {
    const newEntry: Record<string, unknown> = {};
    section.fields.forEach((f) => {
      if (f.autoTimestamp) {
        newEntry[f.id] = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      }
    });
    onChange([...entries, newEntry]);
  };

  const removeEntry = (index: number) => {
    onChange(entries.filter((_, i) => i !== index));
  };

  const updateEntry = (index: number, fieldId: string, value: unknown) => {
    const updated = entries.map((entry, i) =>
      i === index ? { ...entry, [fieldId]: value } : entry
    );
    onChange(updated);
  };

  const toggleCollapse = (index: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  // 检查是否应停止添加
  const shouldStop = section.stopAppendWhen
    ? entries.some(
        (entry) => entry[section.stopAppendWhen!.fieldId] === section.stopAppendWhen!.value
      )
    : false;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-slate-700">
          {section.title}
          <span className="ml-2 text-xs text-slate-400 font-normal">
            ({entries.length} 条)
          </span>
        </h4>
        {!disabled && !shouldStop && (
          <button
            type="button"
            onClick={addEntry}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-blue-600 bg-blue-50 rounded-lg hover:bg-blue-100 transition-colors"
          >
            <Plus size={14} />
            {section.repeatLabel ?? '添加'}
          </button>
        )}
      </div>

      {section.description && (
        <p className="text-xs text-slate-500">{section.description}</p>
      )}

      {entries.length === 0 && (
        <div className="text-center py-8 text-slate-400 text-sm border-2 border-dashed border-slate-200 rounded-lg">
          暂无记录，点击上方按钮添加
        </div>
      )}

      <div className="space-y-2">
        {entries.map((entry, index) => (
          <div
            key={index}
            className="border border-slate-200 rounded-lg bg-white overflow-hidden transition-all hover:border-slate-300"
          >
            {/* 条目头 */}
            <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-100">
              <button
                type="button"
                onClick={() => toggleCollapse(index)}
                className="text-slate-400 hover:text-slate-600"
              >
                {collapsed.has(index) ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </button>
              <span className="text-xs font-medium text-slate-500">
                #{index + 1}
              </span>
              {/* 显示第一个有值的字段作为摘要 */}
              <span className="text-xs text-slate-400 truncate flex-1">
                {section.fields
                  .map((f) => entry[f.id])
                  .filter(Boolean)
                  .slice(0, 2)
                  .join(' · ')}
              </span>
              {!disabled && (
                <button
                  type="button"
                  onClick={() => removeEntry(index)}
                  className="text-slate-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>

            {/* 条目内容 */}
            {!collapsed.has(index) && (
              <div className="p-3 grid gap-3 sm:grid-cols-2">
                {section.fields.map((field) => (
                  <div key={field.id} className={field.type === 'textarea' ? 'sm:col-span-2' : ''}>
                    <FieldRenderer
                      field={field}
                      value={entry[field.id]}
                      onChange={(v) => updateEntry(index, field.id, v)}
                      disabled={disabled}
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
