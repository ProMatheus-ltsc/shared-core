/**
 * Timeline — 受控列表式时间线（纯展示，零依赖）
 *
 * 与 TimelineChart（横向 SVG 图表）互补：本组件用于「状态流转 / 事件历史」这类
 * 纵向列表场景，由调用方传入已排序的 items，组件不做数据计算与写回。
 *
 * 用法：
 *   <Timeline items={[{ time: '2026-11-01', title: '未修复', description: '自动 · 新建' }]} />
 */
import type { ReactNode } from 'react';

export type TimelineTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface TimelineItem {
  /** 可选稳定 key；缺省时用 time + 下标兜底 */
  id?: string;
  /** 展示时间（调用方格式化后的字符串） */
  time: string;
  /** 主标题，如状态名 */
  title: string;
  /** 可选补充说明，如来源与原因 */
  description?: string;
  /** 节点配色，默认 neutral */
  tone?: TimelineTone;
}

export interface TimelineProps {
  items: TimelineItem[];
  /** items 为空时的占位文案，默认「暂无记录」 */
  emptyText?: string;
  className?: string;
  /** 可选自定义空状态渲染，优先于 emptyText */
  empty?: ReactNode;
}

const DOT_STYLES: Record<TimelineTone, string> = {
  neutral: 'border-slate-300 bg-slate-100',
  success: 'border-emerald-500 bg-emerald-100',
  warning: 'border-amber-500 bg-amber-100',
  danger: 'border-red-500 bg-red-100',
  info: 'border-blue-500 bg-blue-100',
};

export function Timeline({ items, emptyText = '暂无记录', className, empty }: TimelineProps) {
  if (items.length === 0) {
    return empty ? <>{empty}</> : <p className="text-sm text-slate-400">{emptyText}</p>;
  }

  return (
    <ol className={`relative space-y-4${className ? ` ${className}` : ''}`}>
      {items.map((item, index) => (
        <li key={item.id ?? `${item.time}-${index}`} className="relative pl-6">
          {index < items.length - 1 && (
            <span className="absolute left-[7px] top-4 h-[calc(100%+0.5rem)] w-px bg-slate-200" aria-hidden />
          )}
          <span
            className={`absolute left-0 top-1 h-3.5 w-3.5 rounded-full border-2 ${DOT_STYLES[item.tone ?? 'neutral']}`}
            aria-hidden
          />
          <div className="text-xs text-slate-500">{item.time}</div>
          <div className="text-sm font-medium text-slate-800">{item.title}</div>
          {item.description && <div className="mt-0.5 text-xs text-slate-500">{item.description}</div>}
        </li>
      ))}
    </ol>
  );
}
