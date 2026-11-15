# @shared/core - 多项目共用基座包

## 概述

此包是多个项目的共用基础设施层，通过本地路径引用（非 npm 发布）实现代码共享：

- **公考复盘系统** (`civil-exam-system`)
- **根因分析系统** (`root-cause-analysis`)
- **个人复盘系统** (`personal_review_system`)
- **能力成长系统** (`ability-growth-system`)
- **财富成长系统** (`money-growth-system`)
- **量化交易系统** (`quant-trading-system`)
- **交易账本** (`quant-trading-agent/journal`)

其中**注册登录已统一收归到本包**（前端 `auth/` + 后端 `server/`），各项目只声明自己的表结构与差异点，详见「统一注册登录」章节。

## 引用方式（标准模式，参考 ability-growth-system）

所有项目统一以下列方式接入（Vite 项目模板照抄即可）：

**1. package.json 本地依赖**

```json
{
  "dependencies": {
    "@shared/core": "file:../shared-core"
  }
}
```

**2. vite.config.ts 别名 + dedupe（两个都要，缺一不可）**

```typescript
resolve: {
  alias: {
    '@shared/core': path.resolve(__dirname, '../shared-core/src'),
  },
  // 强制 React 系列解析到项目根 node_modules 的单实例：
  // @shared/core 源码位于项目父目录，其自身 node_modules 里有 npm 自动安装的独立 react 副本，
  // 不 dedupe 会导致 production bundle 出现两份 React，hooks dispatcher 为 null 而白屏
  // （dev 因依赖预打包不受影响，typecheck/build 也不报错）。
  dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom', 'react-hook-form'],
}
```

**3. tsconfig.json 路径**

```json
{
  "compilerOptions": {
    "paths": {
      "@shared/core": ["../shared-core/src/index.ts"],
      "@shared/core/*": ["../shared-core/src/*"]
    }
  }
}
```

**4. 共享包目录内必须 `npm install`（peer 依赖解析）**

消费方 bundler 直接编译 shared-core 的 TS 源码，源码里的裸导入（如 `lucide-react`）按「导入文件位置」向上查找 node_modules——**消费方自己的 node_modules 帮不上忙**，shared-core 目录内必须安装依赖（npm 7+ 会自动装 peer）：

```bash
cd ../shared-core && npm install   # shared-core 目录内执行
npm install                        # 回到消费项目执行
```

CI 中先装 shared-core 依赖再装主项目依赖（参考 root-cause-analysis 的 deploy.yml）。

**5. 数据库前缀隔离**

```typescript
import { configureDB } from '@shared/core';

// 各项目使用不同的数据库前缀，确保数据隔离
configureDB('civil-exam-app');    // 公考系统
configureDB('rca-app');           // 根因分析
configureDB('review-app');        // 个人复盘
configureDB('ability-app');       // 能力成长
configureDB('fam-asset-app');     // 财富成长
```

## 使用示例

### 渲染统一应用壳 Layout（所有项目默认 UI 风格基线）
```tsx
import { Layout } from '@shared/core';
// 统一 UI 风格：可折叠侧边栏（w-16/w-60）+ 分组导航 + 移动端 Drawer + ⌘K 菜单搜索
// navItems（扁平导航）与 groups（分组导航）二选一；未传 user/onLogout 时回退到包内 useAuth
<Layout
  navItems={[
    { to: '/', icon: Home, label: '首页', end: true },
    { to: '/data', icon: Database, label: '数据管理' },
  ]}
  appConfig={{ name: '应用名', icon: AppIcon }}
/>
// 使用方自有认证体系时注入（不依赖包内 AuthProvider）：
<Layout
  navItems={navItems}
  appConfig={appConfig}
  enableSearch={false}              // 关闭内置 ⌘K 菜单搜索（默认开启）
  user={account ? { username: account.username } : null}
  onLogout={handleLogout}
/>
// 分组导航（一级组 + 二级叶子，展开态记忆到 localStorage，storageKey 可配置）：
<Layout
  groups={[{ key: 'daily', label: '日常工作', icon: Calendar, children: [{ to: '/today', icon: Clock, label: '今日工作台' }] }]}
  appConfig={appConfig}
  storageKey="my-app-nav-expanded"
/>
```

### 空状态 EmptyState（带/不带图标两种形态）
```tsx
import { EmptyState } from '@shared/core';
// 带 icon：圆形图标底样式；无 icon：虚线边框卡片样式
<EmptyState icon={Inbox} title="暂无数据" description="导入后显示" action={<button>去导入</button>} />
```

### 消息提示 Toast（两种形态按需取用）
```tsx
import { ToastContainer, Toast, useToast } from '@shared/core';
// 新项目推荐：useToast + ToastContainer（Context 全局通知栈，Portal 渲染）
const { showToast } = useToast();
showToast({ type: 'success', message: '已保存' });
// 老项目自管状态：单实例受控 Toast（error 5 秒 / 其他 3 秒自动关闭）
<Toast message="已保存" type="success" isVisible={visible} onClose={() => setVisible(false)} />
```

### 确认弹窗 ConfirmDialog（支持 open/isOpen 两种属性名）
```tsx
import { ConfirmDialog } from '@shared/core';
<ConfirmDialog
  open={dialogOpen}          // 旧调用方可用 isOpen 别名
  title="清空全部数据"
  message={<span>此操作不可恢复</span>}   // 支持 ReactNode
  variant="danger"           // danger | warning | info
  onConfirm={handleConfirm}
  onCancel={() => setDialogOpen(false)}
/>
```

### 渲染模板驱动表单（核心能力）

```tsx
import { FormRenderer } from '@shared/core';
import type { FormTemplate, FormRecord } from '@shared/core';

// template: 模板定义（sections/phases/fields）
// record:   已有记录（新建时传 null）
// onSave:   自动保存 / 手动保存草稿回调
// onComplete: 完成回调
<FormRenderer
  template={template}
  record={record}
  onSave={async (r) => { await saveRecord(r); }}
  onComplete={async (r) => { await completeRecord(r); }}
  slots={{ /* 业务插件扩展点（自定义面板/侧栏注入） */ }}
/>
```

### 条件显隐字段（支持嵌套路径 + 通配符）

```tsx
import { ConditionalField } from '@shared/core';

// basePath：repeatable 分区内需传前缀（如 'items.0.'）
// showWhen 支持单个值、数组，以及 '*'（被依赖字段值为任意非空值时显示）
<ConditionalField condition={field.condition} basePath={basePath}>
  <FieldRenderer field={field} />
</ConditionalField>
```

### 版本快照（撤销/回放）

```tsx
import { useSnapshots, VersionHistoryList } from '@shared/core';

const { snapshots, loading, createSnapshot, removeSnapshot } = useSnapshots(recordId);

<button onClick={() => createSnapshot(formData, '重大进展前')}>存档</button>
<VersionHistoryList
  snapshots={snapshots}
  loading={loading}
  onRestore={(s) => form.reset(s.data)}
  onDelete={removeSnapshot}
  onCreateSnapshot={() => createSnapshot(formData)}
/>
```

### 全文搜索（需安装 flexsearch）

```ts
import { useSearch } from '@shared/core/hooks/useSearch';

const results = useSearch(records, query, (r) => `${r.title} ${r.data.description ?? ''}`);
```

### 回路检测（系统思考分析）

```ts
import { detectLoops } from '@shared/core';

// causalChain: { factorA, factorB, relationType: 'reinforcing'|'balancing'|'causal'|'none' }[]
const { loops, leveragePoints } = detectLoops(causalChain);
```

## 统一注册登录（auth/ + server/）

> **设计原则**：本包只维护**最佳实践的标准实现**。项目因必要原因（历史 schema、既有技术栈、特殊业务约束）需要偏离时，**在项目内自行适配**，本包不为个别项目塞特例。能复用本包的尽量复用。

### 分层

```
前端：src/auth/          —— 契约 + 驱动 + 统一状态机（React）
后端：src/server/        —— 哈希 / 会话 / Cookie / D1 存储 / 路由分发（框架无关，纯 TS）
```

### 前端（`@shared/core/auth`）

前端只认一个接口 `AuthDriver`，认证后端由项目注入：

```tsx
import { AuthProvider, useAuth, createRestAuthDriver, createLocalAuthDriver } from '@shared/core/auth';

// 服务端模式：REST + HttpOnly Cookie（前端不接触 token）
const driver = createRestAuthDriver({ basePath: '/api/auth' });

// 本地模式：IndexedDB（纯前端项目）
const driver = createLocalAuthDriver({
  store: { list, findByUsername, put },   // 接项目自己的 IndexedDB 实现
  prefix: 'rca-app',
  hashFormat: 'hex',                      // 'hex' | 'base64'（见下）
  sessionMedium: 'localStorage',          // 'localStorage' | 'sessionStorage'
});

<AuthProvider driver={driver}><App /></AuthProvider>;
```

`useAuth()` 返回统一结构：

| 字段 | 说明 |
|---|---|
| `state` | `'loading' \| 'firstTime' \| 'login' \| 'authenticated'` 四态 |
| `user` | `AuthUser { id, username, displayName?, email?, extra? }`，项目特有字段进 `extra` |
| `account` | 兼容字段（同 `user`） |
| `initializing` | `state === 'loading'` |
| `error` / `errorCode` | 可直接展示的中文文案 + 机器可读错误码 |
| `login` / `register` / `registerWith` / `logout` / `resetPassword` | 统一签名 |
| `driver` | 驱动实例，供项目调用扩展能力（如发送重置邮件） |

### 后端（`@shared/core/server/*`）

| 模块 | 职责 |
|---|---|
| `server/authCore` | 密码哈希、常量时间校验、哑元哈希（防枚举）、会话令牌、Cookie 拼装/读取、响应信封 |
| `server/authDb` | D1 用户/会话/限流表操作（只依赖 D1 的 `prepare/bind` 接口，不依赖框架） |
| `server/authRoutes` | 6 个认证端点的统一分发（框架无关，Hono / 裸 Pages Functions 均可接） |

**统一约定**：

- 密码哈希格式 `pbkdf2-sha256$<iterations>$<base64 salt>$<base64 hash>`（100000 次迭代）
- 会话 token 只在 Cookie 里出现，**库里只存 `sha256(token)`**
- Cookie：`HttpOnly` + `SameSite=Strict` + `Secure`(https) + 30 天
- 响应信封 `{ success: true, data }` / `{ success: false, error: { code, message } }`
- 端点：`POST /auth/register`、`/auth/login`、`/auth/logout`、`GET /auth/me`、`POST /auth/password/forgot`、`/auth/password/reset`

**迁移友好**：`verifyPassword` 认全部历史格式，老用户迁移当天不会被锁在门外——

| # | 存储形态 | 来自 |
|---|---|---|
| 1 | `pbkdf2-sha256$<iter>$<b64 salt>$<b64 hash>` | civil / ability（当前统一格式） |
| 2 | 裸 hex 摘要 + 独立 `salt` 列 | money-growth-system |
| 3 | `<b64 salt>:<b64 hash>` | personal_review_system（本地） |
| 4 | base64url 摘要 + 独立 `salt` 列 | quant-trading-agent/journal |

格式 2/4 还需匹配两项参数，否则派生结果不同、老用户登不进来：

- **迭代次数**：默认 100000；项目若把迭代次数存进独立列，必须传实际值
- **盐的字节处理**：`'bytes'`（解码后参与派生，默认）或 `'utf8'`（盐是字符串，取其 UTF-8 字节）

### 表结构：沿用项目既有列，不改数据库

> **原则**：本包只维护最佳实践的**标准实现**。项目因必要原因（历史 schema、既有技术栈）需要偏离时，**在项目内声明适配**，本包不为个别项目塞特例——更不允许为了迁就共享包去 ALTER 项目的数据库。

**推荐形态**（新建项目照此建表）：

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  username_normalized TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_login_at TEXT NOT NULL
);
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE auth_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_key TEXT NOT NULL,
  succeeded INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
```

**已有表结构不同怎么办**：用 `UserShape` 声明本项目的形状，共享包按形状取列，**无需迁移数据库**。

```ts
import { DEFAULT_USER_SHAPE } from '@shared/core/server/authDb';

// 例：登录标识是邮箱、没有 username 列、展示名是 nickname
const USER_SHAPE = {
  ...DEFAULT_USER_SHAPE,
  usernameColumn: 'email_normalized',   // 登录名归一化列
  usernameDisplayColumn: null,          // null = 没有这一列
  hasStatusColumn: true,                // 有 status 列 → 禁用账户会话立即失效
};
```

`UserShape` 各项：

| 字段 | 默认 | 含义 |
|---|---|---|
| `usernameColumn` | `username_normalized` | 登录名归一化列（查用户用这一列） |
| `usernameDisplayColumn` | `username` | 登录名展示列；`null` 表示没这一列 |
| `saltColumn` | `null` | 独立盐列；`null` 表示盐内嵌在 `password_hash` 里 |
| `hasLastLoginAt` | `true` | 有无 `last_login_at` 列 |
| `hasStatusColumn` | `false` | 有无 `status` 列；有则禁用账户的会话立即失效 |
| `idMode` | `text` | `text` 或 `autoincrement`（INTEGER 主键） |

项目特有列（`role` / `email` / `nickname` / `grade_level` 等）通过 `userExtraColumns` 参与读写。

> 若漏传 `userShape` 导致列名对不上，共享包会抛出明确的提示
> （"请在调用时传 userShape"），而不是裸的 SQLite `no such column`。

### 各项目的落地情况

| 项目 | 形态 | 偏离点 |
|---|---|---|
| civil-exam-drill | 服务端 REST + HttpOnly Cookie | 登录标识是邮箱（沿用既有 `email_normalized` 列）；昵称在邀请码范围内唯一；密码重置走 Resend |
| ability-growth-system | 服务端 REST + HttpOnly Cookie | 用户档案带 `role` / `grade_level`；workspace 由服务端从会话推导 |
| money-growth-system | 服务端 REST + **Bearer token** | **Bearer 而非 Cookie**——运维脚本等非浏览器客户端需要 `Authorization` 头；**未开放自助注册**（账号由管理员预置） |
| root-cause-analysis | 本地 IndexedDB | 哈希 hex 格式（盐与哈希分列）；会话键 `rca-current-account-id` |
| personal_review_system | 本地 IndexedDB | 哈希 base64 格式（盐在哈希串里）；会话介质 sessionStorage；账户 id 即用户名 |
| quant-trading-system | 自建（Node + Express + SQLite + JWT） | 技术栈不兼容 Cloudflare D1；**密码哈希渐进迁移**——认统一格式，新注册用统一格式，bcrypt 老用户登录成功后就地升级 |
| quant-trading-agent/journal | 自建（JS + D1） | 两阶段邮箱验证注册（统一契约已支持）；users 表用 `email` 作登录名、sessions 以 `token_hash` 作主键 |


## Cloudflare D1 容灾备份/多端同步（可选）

> **前提**：该能力面向使用 **Cloudflare 技术栈（Workers + D1）** 的 **Local-First** 项目——本地 IndexedDB 为主数据源，D1 仅作异地容灾备份与多端同步（冲突策略 Last-Write-Wins，以记录的 `updatedAt`（回退 `createdAt`/`evaluationTime`）为准）。**直接以 D1 为主数据库的项目（如 money-growth-system）无需接入本能力。**

前端同步客户端 = `createD1SyncService`（`services/cloudflareD1.ts`，工厂 + 数据适配器注入，不绑定具体数据模型）；Worker 网关可部署模板 = 本包 `worker/` 目录（独立部署物，不参与消费方构建，也不在 package.json exports 中）。

### 接入三步

**第 1 步：部署 Worker 网关模板（`worker/` 目录）**

```bash
cd shared-core/worker
npm install                                  # 安装 wrangler
npx wrangler d1 create shared_sync           # 创建 D1 数据库
# 把 wrangler.toml 里的 database_name / database_id 替换成上一步返回的真实值
npm run db:init                              # 建表（wrangler d1 execute --remote --file=./schema.sql）
npx wrangler secret put SYNC_AUTH_TOKEN      # 可选：设置访问令牌（前端 authToken 与之一致，跳过则不启用鉴权）
npm run deploy                               # 部署，得到 https://<name>.<account>.workers.dev
```

Worker 协议：`POST /api/sync/push`、`GET /api/sync/pull`、`POST /api/sync/backup`、`GET /api/sync/restore`、`GET /api/sync/health`、`GET /api/sync/backups`；账户数据通过 `X-Sync-Account` 头隔离。消费方数据模型与默认的 records + settings 两表不一致时，同步修改 `worker/schema.sql` 与 `worker/src/index.ts` 的 `STORES` 白名单。

**第 2 步：消费方实现数据适配器（或直接用默认适配器）**

- 使用本包 `services/db.ts`（records + settings 结构）的项目**零成本接入**，直接用默认适配器 `createDefaultD1SyncAdapter()`。
  能力边界：全量备份/恢复覆盖 records + settings；增量推送/拉取仅 records（`getRecordsModifiedSince` 按 `updatedAt` 过滤），settings 无修改时间戳不参与增量，其变更只随下次全量备份上云。
- 自有数据层的项目实现 `D1SyncDataAdapter`（五个原语：`exportSnapshot` / `importSnapshot` / `getChangesSince` / `getMeta` / `setMeta`）：

```ts
import { createD1SyncService, type D1SyncDataAdapter } from '@shared/core';

// 以任意本地数据层为例（记录需带字符串 id 与 ISO 时间戳字段）
const myAdapter: D1SyncDataAdapter = {
  exportSnapshot: () => myDB.exportAll(),                        // 全量快照: { 表名: 记录数组, ... }
  importSnapshot: (snap, mode) => myDB.importAll(snap, mode),    // 'replace' 清空后覆盖 / 'merge' upsert
  getChangesSince: (since) => myDB.changesSince(since),          // since 之后变更的记录快照
  getMeta: (key, fallback) => myDB.getMeta(key, fallback),       // 元数据读写（配置/时间戳持久化通道）
  setMeta: (key, value) => myDB.setMeta(key, value),
};
```

**第 3 步：创建同步服务并在设置页暴露配置/备份/恢复 UI**

```ts
import { createD1SyncService, createDefaultD1SyncAdapter } from '@shared/core';

// 标准db.ts用户；accountId 留空时可用 resolveAccountId 注入当前登录账户名（回退 'local-user'）
export const sync = createD1SyncService(createDefaultD1SyncAdapter(), {
  resolveAccountId: async () => currentAccount?.username ?? 'local-user',
});

// App 启动时恢复配置
await sync.loadSyncConfig();

// 设置页：保存/断开配置
await sync.configureSync({ apiEndpoint: 'https://xxx.workers.dev', accountId: '', authToken: '' });
await sync.clearSyncConfig();

// 同步操作（均返回 SyncResult { success, pushed, pulled, conflicts, timestamp, error? }）
await sync.pushChanges();        // 增量推送
await sync.pullChanges();        // 增量拉取 + LWW 合并
await sync.syncBoth();           // 先推后拉
await sync.fullBackupToD1();     // 全量备份（存为一个历史版本，云端每账户保留最近 20 个）
await sync.restoreFromD1();      // 恢复最新备份（可传 timestamp 恢复指定备份点）
await sync.listBackupPoints();   // 历史备份点列表 [{ timestamp, size, records }]
await sync.getSyncStatus();      // { lastSyncAt, pendingChanges, isOnline }
await sync.checkHealth();        // 连通性探针
```

完整 UI 参考蓝本：ability-growth-system 的 `src/pages/SyncPage.tsx`（配置表单 + 同步操作 + 历史备份点）与 `src/hooks/useSyncStatus.tsx`（状态轮询 hook）。

## 可选依赖

以下模块依赖**可选库**（peerDependenciesMeta 声明为 optional），使用方按需安装并**通过子路径导入**：

| 子路径 | 组件/能力 | 需安装 |
|---|---|---|
| `@shared/core/components/visualize/CausalGraph` | 因果链有向图（ReactFlow） | `@xyflow/react` |
| `@shared/core/components/stats/RootCauseTypePie` | 环形占比图 | `recharts` |
| `@shared/core/hooks/useSearch` | flexsearch 全文搜索 | `flexsearch` |

```bash
npm install @xyflow/react recharts flexsearch
```

```tsx
// 子路径导入示例
import { CausalGraph } from '@shared/core/components/visualize/CausalGraph';
import { RootCauseTypePie } from '@shared/core/components/stats/RootCauseTypePie';
import { useSearch } from '@shared/core/hooks/useSearch';
```

> 主入口 `@shared/core` **不导出**依赖可选库的模块，避免未安装对应库的项目 import 主入口时报模块解析错误。

## 包含模块

### 类型 (`types/`)
- `FormTemplate`, `FormField`, `FormSection`, `FormRecord`
- `Account`, `ExportedData`, `SyncStatus`, `SyncResult`
- `Snapshot`（版本快照）, `CausalChainItem`（回路检测）, `AiLoop`/`AiLeveragePoint`/`AiAnalysisResult`
- `QuadrantKey`/`QuadrantItem`/`QuadrantConfig`/`DragMatrixValue`/`DragMatrixQuadrantConfig`（象限/矩阵字段）

### 服务 (`services/`)
- `db.ts` — IndexedDB 多账户隔离数据层（可配置数据库前缀，含快照 CRUD：getSnapshotsByRecord/putSnapshot/deleteSnapshot）
- `auth.ts` — PBKDF2-SHA256 本地认证（**旧版**，新项目请用 `auth/` 下的统一认证）
- `cloudflareD1.ts` — Cloudflare D1 容灾备份/多端同步（`createD1SyncService` 工厂 + `D1SyncDataAdapter` 适配器注入 + `createDefaultD1SyncAdapter` 默认适配器，Local-First，冲突 LWW）

### 统一认证 (`auth/` + `server/`)
- `auth/types.ts` — `AuthDriver` 契约、`AuthUser`、`AuthState`、`AuthError`、标准错误码
- `auth/localDriver.ts` — 本地（IndexedDB）驱动，支持 `hex` / `base64` 两种历史哈希格式与两种会话介质
- `auth/restDriver.ts` — 服务端（REST + HttpOnly Cookie）驱动，端点前缀可配
- `auth/AuthProvider.tsx` — 统一四态状态机 Provider + `useAuth` / `useAuthUser` / `useAuthRole`
- `server/authCore.ts` — 密码哈希（认四种历史格式）、会话令牌、Cookie 助手、响应信封
- `server/authDb.ts` — D1 用户/会话/限流表操作；`UserShape` 声明表形状，**不改消费方数据库**
- `server/authRoutes.ts` — 6 个认证端点的框架无关分发

### Hooks (`hooks/`)
- `useToast.tsx` — 全局通知系统
- `useDB.ts` — 数据 CRUD Hooks
- `usePhaseLogic.ts` — 多阶段表单生命周期（含 useFormPhaseLogic 增强版）
- `useSnapshots.ts` — 版本快照（保存/查看/删除，每记录上限 20 条）
- `useSearch.ts` — flexsearch 全文搜索（依赖可选库，走子路径导入）

### 组件 (`components/`)
- 基础：`Layout`、`ToastContainer`、`ConfirmDialog`、`LoadingSpinner`、`ProtectedRoute`、`SearchBar`、`PasswordInput`、`TemplateCard`、`RecordList`、`VersionHistoryList`
- 表单引擎（RHF 增强版）：`form/FormRenderer`（自动保存/分阶段校验/锁定只读/业务 slots 扩展点）、`form/FieldRenderer`、`form/FieldInputs`（text/textarea/number/date/select/radio/checkbox/rating/table/quadrant/dragMatrix/computed/singleCheckbox + 自动补全）、`form/ConditionalField`（basePath 嵌套 + '*' 通配）、`form/FormTabs`（锁定/只读/错误角标）、`form/RepeatableSection`（折叠/撤销删除/stopAppendWhen）、`form/PhaseIndicator`（时间锁/冷静期）、`form/PhaseNotice`、`form/OptionalFieldsGroup`、`form/CollapsibleSection`、`form/FormNavButtons`
- 统计与可视化：`stats/StatCard`、`stats/KeywordList`、`stats/RootCauseTypePie`（recharts，可选依赖）、`visualize/MatrixHeatmap`、`visualize/FishboneDiagram`、`visualize/ComparisonDiffChart`、`visualize/CausalGraph`（@xyflow/react，可选依赖）、`visualize/TimelineChart`、`visualize/WhyLadderChart`、`visualize/LoopDiagram`

### 工具 (`utils/`)
- `formValidation.ts` — 字段校验、默认值解析、完成度计算、阶段时间锁
- `exportFormatter.ts` — 导出字段格式化（select/checkbox/date/table 等 → 文本/Markdown）
- `loopDetection.ts` — 因果链回路检测（DFS 找环 + 奇偶判型 + 杠杆点）
- `suggestions.ts` — 从历史记录提取字段建议值

> 注：`CausalGraph`（@xyflow/react）、`RootCauseTypePie`（recharts）、`useSearch`（flexsearch）依赖可选库，
> 使用方需自行安装对应依赖，并通过子路径导入（如 `@shared/core/components/visualize/CausalGraph`）。

### Worker 网关模板 (`worker/`)
- Cloudflare Worker + D1 备份/同步网关的可部署模板（`src/index.ts` + `schema.sql` + `wrangler.toml` + `.dev.vars.example`），与 `services/cloudflareD1.ts` 的 API 契约一一对应；独立部署物，不参与消费方构建（详见上文「Cloudflare D1 容灾备份/多端同步」章节）

## 迁移指南（从本地副本切换到公共包）

本包的表单组件为 **react-hook-form 增强版**（自动保存、分阶段校验、锁定/只读、条件字段、业务 slots 插件点）。
从项目本地副本切换时按以下步骤：

1. **安装依赖**：确保项目已安装 `react-hook-form`（表单引擎必需）+ 按需的可选库
2. **改 import**：把本地组件导入替换为 `@shared/core` 子路径导入
   ```ts
   // 之前（本地副本）
   import FormRenderer from '@/components/FormRenderer';
   import ConditionalField from '@/components/form/ConditionalField';
   // 之后（公共包）
   import { FormRenderer, ConditionalField } from '@shared/core';
   ```
3. **删除本地副本**：确认无引用后删除项目内的 `components/FormRenderer.tsx`、`components/form/FieldInputs.tsx` 等重复文件
4. **业务插件迁移**：若本地 FormRenderer 注入了投资/决策/周复盘等业务面板，通过 `slots` / `renderField` props 重新注入（业务逻辑留在业务项目，不进公共包）
5. **数据兼容**：业务库自动从版本 1 升级到版本 2（新增 snapshots 表），旧数据不受影响，无需手动迁移

## 设计原则

1. **数据隔离**：各项目通过 `configureDB(prefix)` 使用独立的 IndexedDB 数据库
2. **零耦合**：共用包不依赖任何项目的业务逻辑
3. **可配置**：Layout 等组件通过 props 接收项目特定配置
4. **向后兼容**：已有项目的数据不受影响（数据库名不变）
5. **最佳实践**：共用包只维护**标准实现**；项目因必要原因需要偏离时，在项目内自行适配，共用包不为个别项目塞特例
6. **不改消费方的数据库**：共用包适配既有 schema（`UserShape` 声明表形状），**不要求项目 ALTER TABLE** 来迁就共用包。存量数据格式一律兼容——密码校验认全部历史哈希格式，老用户无需重置密码
