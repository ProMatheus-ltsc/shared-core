/**
 * ResponsiveTable — 容器查询驱动的自适应表格（宽容器表格 / 窄容器卡片）
 *
 * 渲染策略（纯 CSS 容器查询切换，无 JS 测量，断点 40rem 写在 responsive.css）：
 * - 宽容器（> 40rem）：渲染普通 <table>，thead / tbody / scope 语义完整保留；
 * - 窄容器（≤ 40rem）：每行渲染为一张卡片，每个字段「label + value」成对展示，
 *   label 取自列定义的 header（即表头），并保留 data-label 无障碍属性。
 *
 * 依赖样式：消费方入口需 import '@shared/core/styles/responsive.css'。
 * 不支持容器查询的旧浏览器固定显示表格视图（表格包装层自带横向滚动兜底）。
 *
 * 用法：
 *   <ResponsiveTable
 *     columns={[
 *       { key: 'name', header: '姓名' },
 *       { key: 'score', header: '得分', render: (r) => <b>{r.score}</b> },
 *     ]}
 *     rows={students}
 *     rowKey={(r) => r.id}
 *   />
 */
import type { ReactNode } from 'react';

/** 列定义：header 即表头文案，也是移动端卡片的字段 label 与 data-label */
export interface ResponsiveTableColumn<T> {
  /** 列标识（render 未提供时默认取 row[key] 的值） */
  key: string;
  /** 表头文案 */
  header: string;
  /** 单元格渲染；不传时默认展示 row[key] 的字符串值 */
  render?: (row: T, index: number) => ReactNode;
  /** 窄容器卡片视图中隐藏该列（如仅桌面展示的操作列），默认展示 */
  hideOnCard?: boolean;
}

export interface ResponsiveTableProps<T> {
  /** 列定义（顺序即展示顺序） */
  columns: Array<ResponsiveTableColumn<T>>;
  /** 行数据 */
  rows: T[];
  /** 行 key 提取器，默认用行下标 */
  rowKey?: (row: T, index: number) => string | number;
  /** 宽容器 table 元素追加的 class */
  tableClassName?: string;
  /** 窄容器卡片列表追加的 class */
  cardClassName?: string;
  className?: string;
}

export function ResponsiveTable<T>({
  columns,
  rows,
  rowKey,
  tableClassName,
  cardClassName,
  className,
}: ResponsiveTableProps<T>) {
  const cardColumns = columns.filter((col) => !col.hideOnCard);

  return (
    <div className={`responsive-table${className ? ` ${className}` : ''}`}>
      {/* 宽容器：普通表格（thead 语义完整保留） */}
      <div className="responsive-table__table-wrap">
        <table className={`responsive-table__table${tableClassName ? ` ${tableClassName}` : ''}`}>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key} scope="col">
                  {col.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={rowKey ? rowKey(row, index) : index}>
                {columns.map((col) => (
                  <td key={col.key}>{col.render ? col.render(row, index) : defaultCell(row, col.key)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 窄容器：每行一张卡片（label 取自表头，保留 data-label 无障碍属性） */}
      <ul className={`responsive-table__cards${cardClassName ? ` ${cardClassName}` : ''}`}>
        {rows.map((row, index) => (
          <li key={rowKey ? rowKey(row, index) : index} className="responsive-table__card">
            {cardColumns.map((col) => (
              <div key={col.key} className="responsive-table__field" data-label={col.header}>
                <span className="responsive-table__field-label">{col.header}</span>
                <span className="responsive-table__field-value">
                  {col.render ? col.render(row, index) : defaultCell(row, col.key)}
                </span>
              </div>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 默认取值：render 未提供时把 row[key] 转成字符串 */
function defaultCell<T>(row: T, key: string): string {
  const value = (row as Record<string, unknown>)[key];
  if (value === null || value === undefined) return '';
  return String(value);
}
