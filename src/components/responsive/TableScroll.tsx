/**
 * TableScroll — 表格横向滚动容器（滚动阴影提示 + 键盘可达）
 *
 * 职责：给宽表格包一层横向滚动视口，不改变内部表格本身的结构：
 * - overflow-x: auto（含 iOS 动量滚动、横向链式滚动隔离）；
 * - 滚动阴影：onScroll 把两端状态写入 data 属性（data-at-start / data-at-end），
 *   由 responsive.css 中的 .table-scroll 规则渲染左 / 右内阴影，提示还可继续滚动；
 * - 无障碍：role="region" + aria-label + tabindex=0，聚焦后可用方向键滚动。
 *
 * 依赖样式：消费方入口需 import '@shared/core/styles/responsive.css'。
 *
 * 用法：
 *   <TableScroll label="成绩列表">
 *     <table>…</table>
 *   </TableScroll>
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode } from 'react';

export interface TableScrollProps {
  /** 区域可读名称（输出为 aria-label，role=region 必需） */
  label: string;
  /** 表格或其他可能横向溢出的内容（结构原样渲染） */
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

export function TableScroll({ label, children, className, style }: TableScrollProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);

  // 依据滚动位置更新 data 属性：data-at-start=「已到最左」 / data-at-end=「已到最右」
  const updateShadowState = () => {
    const wrap = wrapRef.current;
    const viewport = viewportRef.current;
    if (!wrap || !viewport) return;
    const atStart = viewport.scrollLeft <= 0;
    const atEnd = viewport.scrollWidth - viewport.clientWidth - viewport.scrollLeft <= 1;
    wrap.setAttribute('data-at-start', atStart ? 'true' : 'false');
    wrap.setAttribute('data-at-end', atEnd ? 'true' : 'false');
  };

  // 每次渲染后校准一次：初次挂载、异步数据导致内容宽度变化时也能刷新阴影状态
  useEffect(updateShadowState);

  return (
    <div
      ref={wrapRef}
      className={`table-scroll${className ? ` ${className}` : ''}`}
      style={style}
    >
      <div
        ref={viewportRef}
        className="table-scroll__viewport"
        role="region"
        aria-label={label}
        tabIndex={0}
        onScroll={updateShadowState}
      >
        {children}
      </div>
    </div>
  );
}
