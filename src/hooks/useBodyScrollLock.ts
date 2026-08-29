/**
 * useBodyScrollLock — body 滚动锁定 hook
 *
 * 设计要点：
 * - 嵌套安全（引用计数）：多个组件（Drawer、弹窗、Lightbox…）同时锁定时，
 *   只有第一个锁定者真正修改 body 样式，最后一个解锁者负责恢复原状；
 * - 保存并恢复原始 overflow（内联样式级），不覆盖消费方自己设置的样式；
 * - 保存锁定瞬间的滚动位置，解锁时恢复 —— 部分浏览器（尤其 iOS）在
 *   overflow:hidden 期间会把滚动偏移重置回顶部。
 *
 * 用法：
 *   useBodyScrollLock(drawerOpen);
 */
import { useEffect } from 'react';

// 模块级共享状态：当前锁定层数 + 首次锁定时保存的现场
let lockCount = 0;
let savedOverflow = '';
let savedScrollY = 0;

/**
 * locked 为 true 时锁定 body 滚动；变回 false 或组件卸载时解锁。
 * 引用计数归零后才真正恢复 overflow 与滚动位置。
 * @param locked 是否锁定
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked) return;

    if (lockCount === 0) {
      savedOverflow = document.body.style.overflow;
      savedScrollY = window.scrollY;
      document.body.style.overflow = 'hidden';
    }
    lockCount += 1;

    return () => {
      lockCount -= 1;
      if (lockCount === 0) {
        document.body.style.overflow = savedOverflow;
        // overflow:hidden 期间滚动偏移可能被重置，解锁时恢复原位
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [locked]);
}
