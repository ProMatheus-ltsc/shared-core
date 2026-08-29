/**
 * useMediaQuery — 媒体查询 hook（matchMedia 封装）
 *
 * 设计要点：
 * - SSR 安全：初始值恒为 false（服务端不感知视口），挂载后在 effect 内读取真实匹配结果，
 *   避免服务端 / 客户端首帧不一致导致的 hydration 抖动；
 * - 低频更新：监听 matchMedia 的 change 事件而非 window resize —— 只有断点跨越时才触发，
 *   拖拽窗口尺寸不会造成高频重渲染；
 * - 正确清理：卸载或 query 变化时移除监听（优先 removeEventListener，旧 Safari 退回 removeListener）。
 *
 * 用法：
 *   const isDesktop = useMediaQuery('(min-width: 1024px)');
 *   const isTouch = useMediaQuery('(pointer: coarse)');
 */
import { useEffect, useState } from 'react';

/**
 * 订阅一条媒体查询的匹配状态。
 * @param query 标准 media query 字符串，如 '(min-width: 1024px)'
 * @returns 当前是否匹配；SSR 首帧恒为 false
 */
export function useMediaQuery(query: string): boolean {
  // 初始 false：服务端渲染与客户端首帧保持一致
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mql = window.matchMedia(query);
    // effect 内先同步一次真实值（初始 false 可能与实际不符）
    setMatches(mql.matches);

    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches);

    if (typeof mql.addEventListener === 'function') {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    }
    // 旧版 Safari（< 14）兼容
    mql.addListener(onChange);
    return () => mql.removeListener(onChange);
  }, [query]);

  return matches;
}
