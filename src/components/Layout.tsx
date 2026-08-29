/**
 * 应用壳组件 - 统一 UI 风格基线（源自 ability-growth-system NestedLayout 下沉）
 *
 * 默认行为（所有项目的默认配置）：
 * - 桌面端：固定左侧边栏，支持折叠/展开（w-16 / w-60）
 * - 一级组：图标 + 名称 + 展开/收起箭头；组内子项激活时自动展开
 * - 二级项：缩进对齐 + NavLink active 高亮
 * - 单页（无子项）的一级项作为普通链接直接跳转
 * - 折叠态：图标 + tooltip
 * - 移动端（<lg 断点）：侧边栏变为 Drawer 抽屉 + 顶部条
 *   （Esc 关闭 / body 滚动锁定 / 关闭后焦点回到汉堡按钮 / dialog aria 语义 /
 *     切回桌面尺寸自动收起；touch-target 触控目标依赖入口引入 responsive.css）
 * - Ctrl+K / Cmd+K：基于导航菜单的全局搜索面板（可通过 enableSearch={false} 关闭）
 * - 分组展开态记忆到 localStorage（storageKey 可配置）
 *
 * 兼容性：
 * - navItems（扁平导航）与 groups（分组导航）二选一，扁平项等价于「单页组」
 * - 未注入 user/onLogout 时，回退到 shared-core 内部 useAuth
 *   （使用方有自己的认证体系时，传入 user + onLogout 即可解耦）
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { ChevronDown, ChevronRight, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, X } from 'lucide-react';

/** 扁平导航项（等价于单页组） */
export interface NavItem {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
}

/** 二级导航叶子项 */
export interface NavLeaf {
  to: string;
  icon: React.ElementType;
  label: string;
  end?: boolean;
  visible?: boolean;
}

/** 一级导航组（单页组：有 to 无 children，点击直接跳转） */
export interface NavGroup {
  key: string;
  label: string;
  icon: React.ElementType;
  /** 一级组是否可见（整组过滤） */
  visible?: boolean;
  to?: string;
  end?: boolean;
  children?: NavLeaf[];
}

export interface AppConfig {
  name: string;
  icon: React.ElementType;
  iconClassName?: string;
}

export interface LayoutUser {
  username: string;
}

interface LayoutProps {
  children: React.ReactNode;
  /** 扁平导航（与 groups 二选一） */
  navItems?: NavItem[];
  /** 分组导航（与 navItems 二选一） */
  groups?: NavGroup[];
  appConfig: AppConfig;
  /** 分组展开态的 localStorage key */
  storageKey?: string;
  /** 是否启用 Ctrl+K 导航搜索面板（默认 true） */
  enableSearch?: boolean;
  /** 注入的用户信息（不传则回退到内部 useAuth） */
  user?: LayoutUser | null;
  /** 注入的登出回调（不传则回退到内部 useAuth） */
  onLogout?: () => void;
}

const DEFAULT_STORAGE_KEY = 'layout-nav-expanded';

export function Layout(props: LayoutProps) {
  // 注入了 user 或 onLogout 时不依赖内部 useAuth（兼容使用方自有认证体系）
  if (props.user !== undefined || props.onLogout !== undefined) {
    return <LayoutBase {...props} />;
  }
  return <LayoutWithAuth {...props} />;
}

/** 内部 useAuth 版本：未注入 user/onLogout 时的默认行为 */
function LayoutWithAuth(props: LayoutProps) {
  const { logout, account } = useAuth();
  const navigate = useNavigate();
  const handleLogout = () => {
    logout();
    navigate('/login');
  };
  return <LayoutBase {...props} user={account ?? null} onLogout={handleLogout} />;
}

function LayoutBase({
  children,
  navItems,
  groups,
  appConfig,
  storageKey = DEFAULT_STORAGE_KEY,
  enableSearch = true,
  user,
  onLogout,
}: LayoutProps) {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  // 移动端(<lg 断点)侧边栏改为 Drawer 抽屉,默认关闭
  const [mobileOpen, setMobileOpen] = useState(false);
  // Ctrl+K / Cmd+K 打开全局搜索
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) return new Set(JSON.parse(raw) as string[]);
    } catch {
      /* ignore */
    }
    return new Set();
  });

  // ===== 移动端 Drawer 增强（Esc 关闭 / 滚动锁定 / 焦点恢复 / 桌面尺寸自动收起） =====
  // 汉堡按钮 ref：Drawer 关闭后焦点恢复的目标
  const hamburgerRef = useRef<HTMLButtonElement>(null);
  // ≥lg(1024px) 视为桌面：切回桌面尺寸时自动收起 Drawer
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  // Drawer 打开时锁定 body 滚动（引用计数，可与弹窗等嵌套锁定共存）
  useBodyScrollLock(mobileOpen);

  useEffect(() => {
    if (isDesktop) setMobileOpen(false);
  }, [isDesktop]);

  // Drawer 由开变关时，焦点回到汉堡按钮（键盘 / 读屏可达性）
  const prevMobileOpenRef = useRef(false);
  useEffect(() => {
    if (prevMobileOpenRef.current && !mobileOpen) {
      hamburgerRef.current?.focus();
    }
    prevMobileOpenRef.current = mobileOpen;
  }, [mobileOpen]);

  // 扁平 navItems 归一化为「单页组」
  const normalizedGroups: NavGroup[] = useMemo(() => {
    if (groups?.length) return groups;
    return (navItems ?? []).map((item) => ({
      key: `flat-${item.to}`,
      label: item.label,
      icon: item.icon,
      to: item.to,
      end: item.end,
    }));
  }, [groups, navItems]);

  // Ctrl+K / Cmd+K 打开全局搜索；Esc 关闭搜索面板与移动端 Drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (enableSearch && (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setSearchOpen(false);
        setMobileOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enableSearch]);

  // 路由切换时关闭 Drawer
  useEffect(() => {
    setMobileOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  // 当前路由属于哪个组 → 自动展开
  const activeGroupKey = useMemo(() => {
    const path = location.pathname;
    for (const g of normalizedGroups) {
      if (g.to && (g.to === path || (path.startsWith(g.to) && g.to !== '/'))) return g.key;
      if (g.children?.some((c) => c.to === path)) return g.key;
    }
    return null;
  }, [location.pathname, normalizedGroups]);

  useEffect(() => {
    if (activeGroupKey && !expanded.has(activeGroupKey)) {
      setExpanded((prev) => {
        const next = new Set(prev);
        next.add(activeGroupKey);
        try {
          localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
        } catch {
          /* ignore */
        }
        return next;
      });
    }
  }, [activeGroupKey, expanded, storageKey]);

  const toggleGroup = (key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        localStorage.setItem(storageKey, JSON.stringify(Array.from(next)));
      } catch {
        /* ignore */
      }
      return next;
    });
  };

  const AppIcon = appConfig.icon;
  const sidebarWidth = collapsed ? 'w-16' : 'w-60';
  // 移动端不预留侧栏空间,主内容 100% 宽度
  const mainPadding = collapsed ? 'lg:pl-16' : 'lg:pl-60';

  const visibleGroups = normalizedGroups.filter((g) => g.visible !== false);

  // 全局搜索候选(基于导航菜单)
  const searchCandidates = useMemo(() => {
    const list: Array<{ to: string; label: string; group: string }> = [];
    for (const g of visibleGroups) {
      if (g.to && !g.children?.length) list.push({ to: g.to, label: g.label, group: g.label });
      g.children?.forEach((c) => {
        if (c.visible !== false) list.push({ to: c.to, label: c.label, group: g.label });
      });
    }
    return list;
  }, [visibleGroups]);
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return searchCandidates.slice(0, 8);
    return searchCandidates.filter(
      (c) => c.label.toLowerCase().includes(q) || c.group.toLowerCase().includes(q),
    );
  }, [searchQuery, searchCandidates]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col lg:flex-row">
      {/* 移动端顶部条(<lg 断点显示) */}
      <div className="lg:hidden flex items-center justify-between bg-white border-b border-slate-200 px-3 h-14 sticky top-0 z-30">
        <button
          ref={hamburgerRef}
          className="p-2.5 rounded hover:bg-slate-100 touch-target"
          onClick={() => setMobileOpen(true)}
          aria-label="打开菜单"
          aria-expanded={mobileOpen}
          aria-controls="layout-mobile-drawer"
        >
          <Menu size={20} />
        </button>
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-lg flex items-center justify-center">
            <AppIcon size={16} className="text-white" />
          </div>
          <span className="font-bold text-slate-800 text-sm">{appConfig.name}</span>
        </div>
        {enableSearch ? (
          <button
            className="p-2.5 rounded hover:bg-slate-100 touch-target"
            onClick={() => setSearchOpen(true)}
            aria-label="搜索"
          >
            <Search size={20} />
          </button>
        ) : (
          <div className="w-9" />
        )}
      </div>

      {/* 移动端 Drawer 遮罩 */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-black/40"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <aside
        id="layout-mobile-drawer"
        role={mobileOpen ? 'dialog' : undefined}
        aria-modal={mobileOpen ? 'true' : undefined}
        aria-label={appConfig.name}
        className={`
          fixed left-0 top-0 bottom-0 flex flex-col bg-white border-r border-slate-200 z-50 transition-transform duration-300
          ${sidebarWidth}
          ${mobileOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
        `}
      >
        {/* 品牌区 */}
        <div className="flex items-center h-14 px-3 border-b border-slate-100 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <div
              className={`flex-shrink-0 w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-700 rounded-xl flex items-center justify-center shadow-md ${appConfig.iconClassName ?? ''}`}
            >
              <AppIcon size={18} className="text-white" />
            </div>
            {!collapsed && <span className="font-bold text-slate-800 text-sm truncate">{appConfig.name}</span>}
          </div>
        </div>

        {/* 导航 */}
        <nav className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            const isSingle = !!group.to && !group.children?.length;
            const activeChildren = group.children?.filter((c) => c.visible !== false) ?? [];
            const isExpanded = expanded.has(group.key);
            const isActive = activeGroupKey === group.key;

            if (isSingle) {
              return (
                <NavLink
                  key={group.key}
                  to={group.to!}
                  end={group.end ?? group.to === '/'}
                  title={collapsed ? group.label : undefined}
                  className={({ isActive: navActive }) =>
                    `flex items-center gap-3 rounded-lg text-sm font-medium transition-all mb-0.5 group relative ${
                      collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'
                    } ${
                      navActive
                        ? 'bg-blue-50 text-blue-700 shadow-sm border border-blue-100'
                        : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-transparent'
                    }`
                  }
                >
                  <GroupIcon size={18} className="flex-shrink-0" />
                  {!collapsed && <span className="truncate">{group.label}</span>}
                  {collapsed && (
                    <span className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                      {group.label}
                    </span>
                  )}
                </NavLink>
              );
            }

            if (activeChildren.length === 0) return null;

            return (
              <div key={group.key} className="mb-0.5">
                <button
                  onClick={() => toggleGroup(group.key)}
                  title={collapsed ? group.label : undefined}
                  className={`w-full flex items-center gap-3 rounded-lg text-sm font-semibold transition-all group relative ${
                    collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2'
                  } ${isActive ? 'text-blue-700' : 'text-slate-700 hover:text-slate-900 hover:bg-slate-50'}`}
                >
                  <GroupIcon size={18} className="flex-shrink-0" />
                  {!collapsed && (
                    <>
                      <span className="truncate flex-1 text-left">{group.label}</span>
                      {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </>
                  )}
                  {collapsed && (
                    <span className="absolute left-full ml-2 px-2 py-1 bg-slate-800 text-white text-xs rounded-md whitespace-nowrap opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity z-50 shadow-lg">
                      {group.label} · {activeChildren.length} 项
                    </span>
                  )}
                </button>
                {!collapsed && isExpanded && (
                  <div className="mt-0.5 ml-2 pl-3 border-l border-slate-100 space-y-0.5">
                    {activeChildren.map((leaf) => {
                      const LeafIcon = leaf.icon;
                      return (
                        <NavLink
                          key={leaf.to}
                          to={leaf.to}
                          end={leaf.end}
                          className={({ isActive: navActive }) =>
                            `flex items-center gap-2 rounded-md text-xs transition-all px-2 py-2 ${
                              navActive
                                ? 'bg-blue-50 text-blue-700 font-medium'
                                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-50'
                            }`
                          }
                        >
                          <LeafIcon size={14} className="flex-shrink-0" />
                          <span className="truncate">{leaf.label}</span>
                        </NavLink>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>

        {/* 底部 */}
        <div className="flex-shrink-0 border-t border-slate-100 p-2 space-y-1">
          {!collapsed && user?.username && (
            <div className="flex items-center gap-2 px-3 py-2">
              <div className="w-7 h-7 bg-gradient-to-br from-slate-600 to-slate-700 rounded-lg flex items-center justify-center text-white text-xs font-bold flex-shrink-0">
                {user.username.charAt(0)}
              </div>
              <span className="text-xs text-slate-600 truncate">{user.username}</span>
            </div>
          )}
          <button
            onClick={() => setCollapsed(!collapsed)}
            className={`flex items-center gap-2 w-full rounded-lg text-sm text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-all touch-target ${collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'}`}
            title={collapsed ? '展开侧边栏' : '折叠侧边栏'}
          >
            {collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
            {!collapsed && <span className="text-xs">折叠</span>}
          </button>
          {onLogout && (
            <button
              onClick={onLogout}
              className={`flex items-center gap-2 w-full rounded-lg text-sm text-slate-500 hover:text-red-600 hover:bg-red-50 transition-all touch-target ${collapsed ? 'px-0 py-2.5 justify-center' : 'px-3 py-2.5'}`}
              title="退出登录"
            >
              <LogOut size={18} />
              {!collapsed && <span className="text-xs">退出</span>}
            </button>
          )}
        </div>
      </aside>

      <main className={`flex-1 ${mainPadding} transition-all duration-300 min-h-screen`}>
        <div className="p-3 lg:p-6 max-w-7xl mx-auto">{children}</div>
      </main>

      {/* Ctrl+K 全局搜索面板 */}
      {enableSearch && searchOpen && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center pt-24 bg-black/40"
          onClick={() => setSearchOpen(false)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-100">
              <Search size={18} className="text-slate-400" />
              <input
                autoFocus
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="搜索菜单/功能(Ctrl+K)"
                className="flex-1 outline-none text-sm"
              />
              <button
                onClick={() => setSearchOpen(false)}
                className="p-1 rounded hover:bg-slate-100 text-slate-400"
                aria-label="关闭"
              >
                <X size={16} />
              </button>
            </div>
            <div className="max-h-80 overflow-y-auto py-1">
              {searchResults.length === 0 ? (
                <div className="px-4 py-6 text-center text-sm text-slate-400">未找到匹配项</div>
              ) : (
                searchResults.map((r) => (
                  <SearchResultItem
                    key={r.to}
                    result={r}
                    onSelect={() => {
                      setMobileOpen(false);
                      setSearchOpen(false);
                      setSearchQuery('');
                    }}
                  />
                ))
              )}
            </div>
            <div className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400 flex items-center gap-2">
              <kbd className="px-1.5 py-0.5 rounded bg-slate-100">↑↓</kbd> 选择
              <kbd className="px-1.5 py-0.5 rounded bg-slate-100">Enter</kbd> 打开
              <kbd className="px-1.5 py-0.5 rounded bg-slate-100">Esc</kbd> 关闭
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** 搜索结果项（独立组件以便使用 useNavigate） */
function SearchResultItem({
  result,
  onSelect,
}: {
  result: { to: string; label: string; group: string };
  onSelect: () => void;
}) {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => {
        navigate(result.to);
        onSelect();
      }}
      className="w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-slate-50 text-left"
    >
      <span className="text-slate-800">{result.label}</span>
      <span className="text-xs text-slate-400">{result.group}</span>
    </button>
  );
}
