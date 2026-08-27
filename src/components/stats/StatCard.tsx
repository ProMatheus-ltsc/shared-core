/**
 * 仪表盘统计卡片：展示单个指标的标签、数值与可选提示。
 * 提取自 root-cause-analysis 项目（公共统计组件，纯展示，直接复用）。
 */
interface StatCardProps {
  /** 指标名称（如"待分析"） */
  label: string;
  /** 指标数值 */
  value: number | string;
  /** 可选补充说明，显示在数值下方 */
  hint?: string;
  /** 数值的额外配色 class（如已完成用 emerald 绿色），缺省为深灰 */
  accentClassName?: string;
}

/**
 * 统计卡片组件。
 * @param label 指标名称
 * @param value 指标数值
 * @param hint 补充说明（可选）
 * @param accentClassName 数值文字配色（可选）
 */
export function StatCard({ label, value, hint, accentClassName }: StatCardProps) {
  return (
    <div className="flex h-full flex-col rounded-xl bg-white p-5 shadow-[0_1px_3px_rgba(0,0,0,0.08),0_1px_2px_rgba(0,0,0,0.04)] hover:shadow-[0_4px_6px_rgba(0,0,0,0.07),0_2px_4px_rgba(0,0,0,0.04)] transition-shadow duration-200">
      <p className="text-[13px] font-medium text-slate-500 tracking-wide">{label}</p>
      <p className={`mt-2 text-[28px] font-bold leading-tight tracking-tight ${accentClassName ?? 'text-slate-900'}`} style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</p>
      <p className={`mt-2 text-xs leading-relaxed ${hint ? 'text-slate-400' : 'text-transparent'}`}>{hint || '\u00A0'}</p>
    </div>
  );
}
