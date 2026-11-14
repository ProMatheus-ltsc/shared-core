/**
 * EmptyState — 空状态/引导态组件
 * 提取自 ability-growth-system / money-growth-system（统一 API：icon 可选超集）
 *
 * - 带 icon：圆形图标底 + 标题 + 描述 + 可选操作按钮（原 ability 风格）
 * - 无 icon：虚线边框卡片 + 标题 + 描述 + 可选操作（原 money 风格）
 *
 * icon 类型刻意不绑定 lucide-react 的 LucideIcon：
 * 各消费方的 lucide-react 版本可能不同（如 0.4xx / 1.xx），
 * 直接引用 LucideIcon 会因基座自身安装的副本版本不一致而产生类型冲突。
 */
import type { ComponentType, ReactNode } from 'react';

interface EmptyStateProps {
  title: string;
  description?: string;
  action?: ReactNode;
  /** 可选图标（传入后渲染圆形图标底样式）；兼容任意图标库的 size 组件 */
  icon?: ComponentType<{ size?: number | string; className?: string }>;
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
