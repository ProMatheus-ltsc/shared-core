# @shared/core - 多项目共用基座包

## 概述

此包是多个项目的共用基础设施层，通过本地路径引用（非 npm 发布）实现代码共享：

- **公考复盘系统** (`civil-exam-system`)
- **根因分析系统** (`root-cause-analysis`)
- **个人复盘系统** (`personal_review_system`)
- **能力成长系统** (`ability-growth-system`)
- **财富成长系统** (`money-growth-system`)

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
- `auth.ts` — PBKDF2-SHA256 本地认证
- `cloudflareD1.ts` — Cloudflare D1 容灾备份/多端同步（`createD1SyncService` 工厂 + `D1SyncDataAdapter` 适配器注入 + `createDefaultD1SyncAdapter` 默认适配器，Local-First，冲突 LWW）

### Hooks (`hooks/`)
- `useAuth.tsx` — 认证状态机 Provider + Hook
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
