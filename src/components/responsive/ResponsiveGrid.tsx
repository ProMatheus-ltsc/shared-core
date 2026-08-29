/**
 * ResponsiveGrid — CSS Grid 流式自适应网格
 *
 * 列宽策略：grid-template-columns: repeat(auto-fit, minmax(min, 1fr))
 * - 容器变窄时列数自动减少（移动端自然降为单列），变宽时自动增多，无需 JS 测量；
 * - minItemWidth 不传时使用 var(--grid-min, 16rem)，消费方可通过 CSS 变量
 *   --grid-min 在不改动组件的情况下全局覆盖默认最小列宽。
 *
 * 零依赖：纯内联样式实现，不依赖 Tailwind（v3/v4 消费方通用）。
 *
 * 用法：
 *   <ResponsiveGrid minItemWidth="240px" gap="1rem">…</ResponsiveGrid>
 */
import type { CSSProperties, ElementType, ReactNode } from 'react';

export interface ResponsiveGridProps {
  /** 单列最小宽度（任意 CSS 长度，如 '16rem' / '240px'）；默认 var(--grid-min, 16rem) */
  minItemWidth?: string;
  /** 行 / 列间距（gap），如 '1rem' / '16px' */
  gap?: string;
  /** 渲染元素类型（默认 'div'），如 'ul' / 'section' */
  as?: ElementType;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function ResponsiveGrid({
  minItemWidth,
  gap,
  as,
  children,
  className,
  style,
}: ResponsiveGridProps) {
  const Component: ElementType = as ?? 'div';
  const minTrack = minItemWidth ?? 'var(--grid-min, 16rem)';
  const gridStyle: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fit, minmax(${minTrack}, 1fr))`,
    ...(gap !== undefined ? { gap } : {}),
    ...style,
  };
  return (
    <Component className={className} style={gridStyle}>
      {children}
    </Component>
  );
}
