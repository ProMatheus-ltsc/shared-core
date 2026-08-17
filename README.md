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

### 服务 (`services/`)
- `db.ts` — IndexedDB 多账户隔离数据层（可配置数据库前缀）
- `auth.ts` — PBKDF2-SHA256 本地认证
- `cloudflareD1.ts` — Cloudflare D1 远程备份同步

### Hooks (`hooks/`)
- `useAuth.tsx` — 认证状态机 Provider + Hook
- `useToast.tsx` — 全局通知系统
- `useDB.ts` — 数据 CRUD Hooks
- `usePhaseLogic.ts` — 多阶段表单生命周期

### 组件 (`components/`)
- `Layout.tsx` — 可配置的应用壳（传入 navItems + appConfig）
- `Toast.tsx` — 通知容器
- `ConfirmDialog.tsx` — 确认弹窗
- `LoadingSpinner.tsx` — 加载状态
- `ProtectedRoute.tsx` — 路由守卫
- `form/FormRenderer.tsx` — 核心表单引擎
- `form/FieldRenderer.tsx` — 字段渲染器
- `form/FieldInputs.tsx` — 底层输入组件
- `form/FormTabs.tsx` — Tab 导航
- `form/RepeatableSection.tsx` — 可重复分区
- `form/PhaseIndicator.tsx` — 阶段指示器

### 工具 (`utils/`)
- `formValidation.ts` — 字段校验、默认值解析、完成度计算

## 设计原则

1. **数据隔离**：各项目通过 `configureDB(prefix)` 使用独立的 IndexedDB 数据库
2. **零耦合**：共用包不依赖任何项目的业务逻辑
3. **可配置**：Layout 等组件通过 props 接收项目特定配置
4. **向后兼容**：已有项目的数据不受影响（数据库名不变）
