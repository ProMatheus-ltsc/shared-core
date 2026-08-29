/**
 * Toast 通知组件
 * - ToastContainer：全局通知容器（配合 useToast Context，推荐新项目使用）
 * - Toast：单实例受控通知（提取自 personal_review_system，老调用方直接复用）
 *   两者按需取用：已有自管 toast 状态的项目用 Toast，新项目用 useToast + ToastContainer
 */
import { useEffect } from 'react';
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

interface ControlledToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  isVisible: boolean;
  onClose: () => void;
}

/**
 * 单实例受控 Toast：固定顶部居中，error 5 秒 / 其他 3 秒自动关闭，可手动关闭。
 * 由调用方自管状态（isVisible + onClose），不依赖 Context。
 */
export function Toast({ message, type, isVisible, onClose }: ControlledToastProps) {
  useEffect(() => {
    if (!isVisible) return;
    const duration = type === 'error' ? 5000 : 3000;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [isVisible, type, onClose]);

  if (!isVisible) return null;

  return (
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 rounded-lg border px-4 py-3 shadow-lg animate-in slide-in-from-top duration-200 ${typeStyles[type]}`}
      role="alert"
    >
      <span className="text-lg font-bold flex-shrink-0">{typeIcons[type]}</span>
      <span className="text-sm font-medium">{message}</span>
      <button
        type="button"
        onClick={onClose}
        className="ml-2 flex-shrink-0 opacity-60 hover:opacity-100 transition-opacity"
        aria-label="关闭"
      >
        <X size={14} />
      </button>
    </div>
  );
}
