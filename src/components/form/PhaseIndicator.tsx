/**
 * 阶段进度指示器 - 可点击导航
 * 当模板配置了 phases 时，此组件作为主导航替代 FormTabs
 */
import { Check } from 'lucide-react';

interface PhaseIndicatorProps {
  phases: { label: string; icon: string }[];
  currentIndex: number;
  activeIndex: number;
  isCompleted: boolean;
  onPhaseClick?: (index: number) => void;
}

export function PhaseIndicator({ phases, currentIndex, activeIndex, isCompleted, onPhaseClick }: PhaseIndicatorProps) {
  if (phases.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto py-2">
      {phases.map((phase, index) => {
        const isDone = isCompleted || index < currentIndex;
        const isActive = !isCompleted && index === activeIndex;
        const isClickable = !!onPhaseClick && (isDone || index <= currentIndex);

        return (
          <div key={index} className="flex items-center">
            {index > 0 && (
              <div
                className={`w-6 h-0.5 mx-1 transition-colors ${
                  isDone ? 'bg-emerald-400' : index <= activeIndex ? 'bg-blue-300' : 'bg-slate-200'
                }`}
              />
            )}
            <button
              type="button"
              onClick={() => isClickable && onPhaseClick?.(index)}
              disabled={!isClickable}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all ${
                isDone && !isActive
                  ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 cursor-pointer'
                  : isActive
                  ? 'bg-blue-50 text-blue-700 border border-blue-200 shadow-sm ring-2 ring-blue-100'
                  : 'bg-slate-50 text-slate-400 border border-slate-200 cursor-not-allowed'
              }`}
            >
              {isDone && !isActive ? (
                <Check size={12} className="text-emerald-600" />
              ) : (
                <span>{phase.icon}</span>
              )}
              <span>{phase.label}</span>
            </button>
          </div>
        );
      })}
    </div>
  );
}
