# @shared/core - 三项目共用基座包

## 概述

此包是三个项目的共用基础设施层，通过本地路径引用（非npm发布）实现代码共享：

- **公考复盘系统** (`civil-exam-system`)
- **根因分析系统** (`root-cause-analysis`)
- **个人复盘系统** (`personal_review_system`)

## 使用方式

### 1. 在项目 package.json 中添加本地依赖

```json
{
  "dependencies": {
    "@shared/core": "file:../shared-core"
  }
}
```

### 2. 在 vite.config.ts 中配置别名

```typescript
resolve: {
  alias: {
    '@shared/core': path.resolve(__dirname, '../shared-core/src'),
  }
}
```

### 3. 在 tsconfig.json 中配置路径

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

### 4. 在项目入口初始化数据库前缀

```typescript
import { configureDB } from '@shared/core';

// 各项目使用不同的数据库前缀，确保数据隔离
configureDB('civil-exam-app');    // 公考系统
configureDB('rca-app');           // 根因分析
configureDB('review-app');        // 个人复盘
```

## 包含模块

### 类型 (`types/`)
- `FormTemplate`, `FormField`, `FormSection`, `FormRecord`
- `Account`, `ExportedData`, `SyncStatus`, `SyncResult`
- `Snapshot`（版本快照）, `CausalChainItem`（回路检测）, `AiLoop`/`AiLeveragePoint`/`AiAnalysisResult`
- `QuadrantKey`/`QuadrantItem`/`QuadrantConfig`/`DragMatrixValue`/`DragMatrixQuadrantConfig`（象限/矩阵字段）

### 服务 (`services/`)
- `db.ts` — IndexedDB 多账户隔离数据层（可配置数据库前缀，含快照 CRUD：getSnapshotsByRecord/putSnapshot/deleteSnapshot）
- `auth.ts` — PBKDF2-SHA256 本地认证
- `cloudflareD1.ts` — Cloudflare D1 远程备份同步

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

## 设计原则

1. **数据隔离**：各项目通过 `configureDB(prefix)` 使用独立的 IndexedDB 数据库
2. **零耦合**：共用包不依赖任何项目的业务逻辑
3. **可配置**：Layout 等组件通过 props 接收项目特定配置
4. **向后兼容**：已有项目的数据不受影响（数据库名不变）
