/**
 * 全屏加载组件
 *
 * 注意：默认参数只在 undefined 时生效，调用方显式传 ''（例如把后端空字符串
 * 直接透传进来）会渲染出一个没有文字的空转圈。这里统一 trim + 兜底，
 * 保证任何情况下都有一句可读的加载提示。
 */
export function LoadingSpinner({ message = '加载中...' }: { message?: string }) {
  const text = message?.trim() || '加载中...';
  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <div className="relative">
        <div className="w-12 h-12 rounded-full border-4 border-slate-200 border-t-blue-600 animate-spin" />
      </div>
      <p className="text-sm text-slate-500 animate-pulse">{text}</p>
    </div>
  );
}
