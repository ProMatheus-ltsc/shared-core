/**
 * Stack — 垂直 / 水平布局栈（flex 封装）
 *
 * 说明：组件本身不做断点切换 ——「小容器单列、大容器横排」由调用方控制：
 * - 响应式方向：按容器宽度（如 useMediaQuery 或容器查询类）条件渲染 direction；
 * - 响应式间距：gap 直接支持 clamp()，如 gap="clamp(0.5rem, 2vw, 1.5rem)"。
 *
 * 零依赖：纯内联样式实现，不依赖 Tailwind（v3/v4 消费方通用）。
 *
 * 用法：
 *   <Stack direction="horizontal" gap="clamp(0.5rem, 2vw, 1.5rem)" wrap>…</Stack>
 */
import type { CSSProperties, ReactNode } from 'react';

export interface StackProps {
  /** 主轴方向，默认 'vertical' */
  direction?: 'vertical' | 'horizontal';
  /** 间距，支持任意 CSS 值（含 clamp() 响应式间距） */
  gap?: string;
  /** 交叉轴对齐方式（align-items） */
  align?: 'start' | 'center' | 'end' | 'stretch' | 'baseline';
  /** 是否允许换行（horizontal 下窄容器自动折行），默认 false */
  wrap?: boolean;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** 语义化对齐值 → CSS align-items 值 */
const ALIGN_MAP: Record<NonNullable<StackProps['align']>, string> = {
  start: 'flex-start',
  center: 'center',
  end: 'flex-end',
  stretch: 'stretch',
  baseline: 'baseline',
};

export function Stack({
  direction = 'vertical',
  gap,
  align,
  wrap = false,
  children,
  className,
  style,
}: StackProps) {
  const stackStyle: CSSProperties = {
    display: 'flex',
    flexDirection: direction === 'vertical' ? 'column' : 'row',
    flexWrap: wrap ? 'wrap' : 'nowrap',
    ...(gap !== undefined ? { gap } : {}),
    ...(align !== undefined ? { alignItems: ALIGN_MAP[align] as CSSProperties['alignItems'] } : {}),
    ...style,
  };
  return (
    <div className={className} style={stackStyle}>
      {children}
    </div>
  );
}
