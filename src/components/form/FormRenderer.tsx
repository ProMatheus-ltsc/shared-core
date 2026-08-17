/**
 * 核心表单引擎：模板驱动，多Tab，自动保存，阶段管理
 * 复用自 root-cause-analysis / personal_review_system
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import type { FormTemplate, FormRecord } from '../../types';
import { resolveDefaultValue, isFieldEmpty } from '../../utils/formValidation';
import { FieldRenderer } from './FieldRenderer';
import { FormTabs } from './FormTabs';
import { RepeatableSection } from './RepeatableSection';
import { PhaseIndicator } from './PhaseIndicator';
import { Save, CheckCircle2, ArrowRight, ArrowLeft } from 'lucide-react';

interface FormRendererProps {
  template: FormTemplate;
  record?: FormRecord | null;
  onSave: (record: FormRecord) => Promise<void>;
  onComplete?: (record: FormRecord) => Promise<void>;
  disabled?: boolean;
}

export function FormRenderer({
  template,
  record,
  onSave,
  onComplete,
  disabled = false,
}: FormRendererProps) {
  const [data, setData] = useState<Record<string, unknown>>(() => {
    if (record?.data) return { ...record.data };
    // 初始化默认值
    const initial: Record<string, unknown> = {};
    template.sections.forEach((section) => {
      section.fields.forEach((field) => {
        if (field.defaultValue !== undefined) {
          initial[field.id] = resolveDefaultValue(field.defaultValue);
        }
      });
    });
    return initial;
  });

  const [activeTab, setActiveTab] = useState(0);
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const autoSaveRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // 构建记录对象
  const buildRecord = useCallback(
    (status: 'draft' | 'completed' = 'draft'): FormRecord => {
      const now = new Date().toISOString();
      return {
        id: record?.id ?? uuidv4(),
        templateId: template.id,
        title: (data.title as string) || `${template.name} - ${new Date().toLocaleDateString('zh-CN')}`,
        data,
        status,
        createdAt: record?.createdAt ?? now,
        updatedAt: now,
        module: (data.module as string) || template.id.split('-')[0],
      };
    },
    [data, record, template]
  );

  // 手动保存
  const handleSave = async () => {
    setSaving(true);
    try {
      const rec = buildRecord('draft');
      await onSave(rec);
      setLastSaved(new Date().toLocaleTimeString('zh-CN'));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  // 完成
  const handleComplete = async () => {
    if (!onComplete) return;
    setSaving(true);
    try {
      const rec = buildRecord('completed');
      await onComplete(rec);
      setLastSaved(new Date().toLocaleTimeString('zh-CN'));
      setDirty(false);
    } finally {
      setSaving(false);
    }
  };

  // 自动保存（30秒）
  useEffect(() => {
    if (disabled) return;
    autoSaveRef.current = setInterval(() => {
      if (dirty) {
        handleSave();
      }
    }, 30000);
    return () => {
      if (autoSaveRef.current) clearInterval(autoSaveRef.current);
    };
  }, [dirty, disabled]);

  // 更新字段值
  const updateField = (fieldId: string, value: unknown) => {
    setData((prev) => ({ ...prev, [fieldId]: value }));
    setDirty(true);
  };

  // 更新可重复分区
  const updateRepeatable = (sectionId: string, entries: Record<string, unknown>[]) => {
    setData((prev) => ({ ...prev, [`_repeat_${sectionId}`]: entries }));
    setDirty(true);
  };

  // 阶段逻辑
  const phases = template.phases ?? [];
  const hasPhases = phases.length > 0;

  // 当前进度阶段（根据completionFields判断）
  const currentPhaseIndex = (() => {
    for (let i = 0; i < phases.length; i++) {
      const allFilled = phases[i].completionFields.every((fid) => !isFieldEmpty(data[fid]));
      if (!allFilled) return i;
    }
    return phases.length - 1;
  })();

  // 当前用户正在查看的阶段（根据activeTab推断）
  const activePhaseIndex = (() => {
    if (!hasPhases) return -1;
    for (let i = 0; i < phases.length; i++) {
      if (phases[i].sectionIndices.includes(activeTab)) return i;
    }
    return 0;
  })();

  // 点击Phase切换到对应section
  const handlePhaseClick = (phaseIndex: number) => {
    if (phases[phaseIndex]) {
      const firstSection = phases[phaseIndex].sectionIndices[0];
      if (firstSection !== undefined) {
        setActiveTab(firstSection);
      }
    }
  };

  const isLastTab = activeTab === template.sections.length - 1;

  // 下一步：跳转到下一个阶段的第一个 Tab
  const handleNextPhase = async () => {
    // 先自动保存
    setSaving(true);
    try {
      const rec = buildRecord('draft');
      await onSave(rec);
      setLastSaved(new Date().toLocaleTimeString('zh-CN'));
      setDirty(false);
    } finally {
      setSaving(false);
    }

    // 跳转到下一个 Tab
    if (activeTab < template.sections.length - 1) {
      setActiveTab(activeTab + 1);
    }
  };

  // 上一步
  const handlePrevPhase = () => {
    if (activeTab > 0) {
      setActiveTab(activeTab - 1);
    }
  };

  // Tab 列表
  const tabs = template.sections.map((s) => ({ id: s.id, title: s.title }));
  const currentSection = template.sections[activeTab];

  // 条件字段可见性
  const isFieldVisible = (field: { condition?: { dependsOn: string; showWhen: string | string[] } }) => {
    if (!field.condition) return true;
    const depValue = data[field.condition.dependsOn];
    if (Array.isArray(field.condition.showWhen)) {
      return field.condition.showWhen.includes(depValue as string);
    }
    return depValue === field.condition.showWhen;
  };

  return (
    <div className="space-y-4">
      {/* 阶段指示器（有phases时作为主导航，替代Tab） */}
      {hasPhases ? (
        <PhaseIndicator
          phases={phases.map((p) => ({ label: p.label, icon: p.icon }))}
          currentIndex={currentPhaseIndex}
          activeIndex={activePhaseIndex}
          isCompleted={record?.status === 'completed'}
          onPhaseClick={handlePhaseClick}
        />
      ) : (
        /* 无phases时使用Tab导航 */
        <FormTabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      )}

      {/* 表单内容 */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="p-4 lg:p-6">
          {currentSection && (
            <div className="space-y-4">
              {currentSection.description && (
                <p className="text-sm text-slate-500 bg-slate-50 px-3 py-2 rounded-lg">
                  {currentSection.description}
                </p>
              )}

              {currentSection.repeatable ? (
                <RepeatableSection
                  section={currentSection}
                  entries={(data[`_repeat_${currentSection.id}`] as Record<string, unknown>[]) ?? []}
                  onChange={(entries) => updateRepeatable(currentSection.id, entries)}
                  disabled={disabled}
                />
              ) : (
                <div className="grid gap-4 sm:grid-cols-2">
                  {currentSection.fields
                    .filter(isFieldVisible)
                    .map((field) => (
                      <div
                        key={field.id}
                        className={
                          field.type === 'textarea' || field.type === 'table' || field.type === 'checkbox'
                            ? 'sm:col-span-2'
                            : ''
                        }
                      >
                        <FieldRenderer
                          field={field}
                          value={data[field.id]}
                          onChange={(v) => updateField(field.id, v)}
                          disabled={disabled}
                        />
                      </div>
                    ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 底部操作栏 */}
        {!disabled && (
          <div className="flex items-center justify-between px-4 lg:px-6 py-3 bg-slate-50 border-t border-slate-200">
            <div className="flex items-center gap-2">
              {/* 上一步按钮 */}
              {activeTab > 0 && (
                <button
                  type="button"
                  onClick={handlePrevPhase}
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition-all"
                >
                  <ArrowLeft size={14} />
                  上一步
                </button>
              )}
              <div className="text-xs text-slate-400">
                {lastSaved && `上次保存: ${lastSaved}`}
                {dirty && <span className="ml-2 text-amber-500">● 未保存</span>}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-slate-700 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-all"
              >
                <Save size={14} />
                {saving ? '保存中...' : '保存草稿'}
              </button>
              {/* 多阶段模板：非最后一个Tab显示"下一步"，最后一个Tab显示"完成记录" */}
              {hasPhases && !isLastTab ? (
                <button
                  type="button"
                  onClick={handleNextPhase}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-all shadow-sm"
                >
                  下一步
                  <ArrowRight size={14} />
                </button>
              ) : onComplete ? (
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm font-medium text-white bg-emerald-600 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-all shadow-sm"
                >
                  <CheckCircle2 size={14} />
                  完成记录
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
