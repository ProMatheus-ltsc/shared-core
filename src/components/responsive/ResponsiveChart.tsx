/**
 * ResponsiveChart — 图表响应式容器
 *
 * 职责：
 * - ResizeObserver 监听容器内容区尺寸，变化时回调 onResize(width, height)
 *   （observer 在 effect 内创建、卸载时 disconnect；环境不支持 ResizeObserver 时
 *   静默降级不报错，容器仍正常渲染）；
 * - 容器高度用 clamp() 约束在 [minHeight, maxHeight] 区间随视口自适应
 *   （默认 clamp(16rem, 40vh, 32rem)），图表内容按 100% × 100% 填充。
 *
 * 零依赖：不依赖 Tailwind / recharts，可包裹任意图表库的容器组件。
 *
 * 用法：
 *   <ResponsiveChart minHeight="14rem" maxHeight="28rem" onResize={(w, h) => setBox({ w, h })}>
 *     <ResponsiveContainer>…</ResponsiveContainer>
 *   </ResponsiveChart>
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface ResponsiveChartProps {
  /** 容器尺寸变化回调（含 ResizeObserver 首次 observe 送出的初始尺寸） */
  onResize?: (width: number, height: number) => void;
  /** 高度下限（clamp 第 1 段），默认 '16rem' */
  minHeight?: string;
  /** 高度上限（clamp 第 3 段），默认 '32rem' */
  maxHeight?: string;
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function ResponsiveChart({
  onResize,
  minHeight = '16rem',
  maxHeight = '32rem',
  children,
  className,
  style,
}: ResponsiveChartProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // 回调走 ref：消费方传内联箭头函数也不会导致 observer 反复重建
  const onResizeRef = useRef(onResize);

  useEffect(() => {
    onResizeRef.current = onResize;
  });

  useEffect(() => {
    const el = containerRef.current;
    // 降级：环境不支持 ResizeObserver 时跳过监听（不报错）
    if (!el || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      onResizeRef.current?.(width, height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        width: '100%',
        height: `clamp(${minHeight}, 40vh, ${maxHeight})`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}
