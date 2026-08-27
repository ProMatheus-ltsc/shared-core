/**
 * Toast 通知组件 — 使用 Portal 渲染到 body 层级，避免被任何父级 stacking context 遮挡
 */
import { createPortal } from 'react-dom';
import { useToast, type ToastType } from '../hooks/useToast';
import { X } from 'lucide-react';

const typeStyles: Record<ToastType, string> = {
  success: 'bg-emerald-50 border-emerald-200 text-emerald-800',
  error: 'bg-red-50 border-red-200 text-red-800',
  warning: 'bg-amber-50 border-amber-200 text-amber-800',
  info: 'bg-blue-50 border-blue-200 text-blue-800',
};

const typeIcons: Record<ToastType, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
};

export function ToastContainer() {
  const { toasts, removeToast } = useToast();

  if (toasts.length === 0) return null;

  return createPortal(
    <div
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm"
      style={{ pointerEvents: 'none' }}
      role="alert"
      aria-live="assertive"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          style={{ pointerEvents: 'auto' }}
          className={`flex items-center gap-3 px-4 py-3 rounded-lg border-2 shadow-xl animate-in slide-in-from-right duration-300 ${typeStyles[toast.type]}`}
        >
          <span className="text-lg font-bold flex-shrink-0">{typeIcons[toast.type]}</span>
          <p className="text-sm flex-1 font-medium">{toast.message}</p>
          <button
            onClick={() => removeToast(toast.id)}
            className="flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>,
    document.body
  );
}
