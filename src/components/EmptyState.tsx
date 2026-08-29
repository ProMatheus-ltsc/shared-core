/**
 * EmptyState — 空状态/引导态组件
 * 提取自 ability-growth-system / money-growth-system（统一 API：icon 可选超集）
 *
 * - 带 icon：圆形图标底 + 标题 + 描述 + 可选操作按钮（原 ability 风格）
 * - 无 icon：虚线边框卡片 + 标题 + 描述 + 可选操作（原 money 风格）
 */
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** 可选图标（传入后渲染圆形图标底样式） */
  icon?: LucideIcon;
}

export function EmptyState({ title, description, action, icon: Icon }: EmptyStateProps) {
  return (
    <div
      className={
        Icon
          ? 'flex flex-col items-center justify-center rounded-xl bg-white p-8 text-center shadow-sm'
          : 'flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-6 py-16 text-center'
      }
    >
      {Icon && (
        <div className="mb-3 flex h-14 w-14 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          <Icon size={24} />
        </div>
      )}
      <p className={Icon ? 'text-base font-semibold text-slate-800' : 'text-sm font-medium text-slate-700'}>
        {title}
      </p>
      {description && (
        <p className={Icon ? 'mt-2 max-w-md text-sm text-slate-500' : 'max-w-md text-xs text-slate-400'}>
          {description}
        </p>
      )}
      {action && <div className={Icon ? 'mt-4' : 'mt-3'}>{action}</div>}
    </div>
  );
}
