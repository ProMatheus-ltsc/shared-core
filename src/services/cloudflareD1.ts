/**
 * Cloudflare D1 远程备份/同步服务（通用实现，蓝本：ability-growth-system src/services/remoteSync.ts）
 *
 * 设计要点:
 * - Local-First: 本地存储(如 IndexedDB)为主, D1 仅作为异地备份和多设备同步的容灾存储
 * - Worker 网关: 前端通过 HTTPS 调用部署在 Cloudflare Workers 上的 API,
 *   由 Worker 使用 D1 Binding 完成 SQL 读写（可部署模板见 shared-core/worker/）
 * - 数据访问抽象: 通过 D1SyncDataAdapter 注入任意本地数据层, 不绑定具体数据模型
 * - 三种模式: 增量推送(pushChanges) / 增量拉取(pullChanges) / 全量备份/恢复(fullBackupToD1/restoreFromD1)
 * - 冲突策略: Last-Write-Wins, 冲突数上报便于端上知情
 *
 * 期望的 Cloudflare Worker 端点(前端不实现,由部署方提供):
 *   POST /api/sync/push       -> 接收快照,写入 D1,返回 { conflicts }
 *   GET  /api/sync/pull       -> ?accountId&since=ISO 返回快照
 *   POST /api/sync/backup     -> 全量覆盖备份
 *   GET  /api/sync/restore    -> 可选 ?timestamp=xxx 返回历史版本
 *   GET  /api/sync/health     -> 连通性检测
 *   GET  /api/sync/backups    -> 列出历史备份点
 */
import type { FormRecord, SyncStatus, SyncResult } from '../types';
import {
  exportAllData,
  importAllData,
  clearAllData,
  getRecordsModifiedSince,
  getSetting,
  setSetting,
} from './db';

// ============ 类型定义 ============

/** 同步服务配置（持久化在适配器的 meta 存储中,键名 d1-sync-config） */
export interface D1SyncConfig {
  /** Worker 网关地址,如 https://xxx.workers.dev */
  apiEndpoint: string;
  /** 数据归属账户(多端填相同值即可互通);留空时依次回退 resolveAccountId 注入值 / 'local-user' */
  accountId: string;
  /** 可选 Bearer Token,与 Worker 端 SYNC_AUTH_TOKEN 一致 */
  authToken?: string;
  /** 可选,仅作备注展示,不参与请求 */
  databaseId?: string;
}

/** 历史备份点（由 Worker GET /api/sync/backups 返回） */
export interface BackupPoint {
  timestamp: string;
  size: number;
  records: number;
}

/**
 * 通用同步快照: 任意业务表名 -> 记录数组,附带可选的版本信息。
 * 快照里值为数组的 key 会被视为"记录表"参与增量推送/拉取与 LWW 合并;
 * version/exportedAt 等标量字段仅作元信息透传。
 */
export interface D1SyncSnapshot {
  [store: string]: unknown;
  version?: string;
  exportedAt?: string;
}

/**
 * 数据访问适配器: 把任意本地数据层(通常是 IndexedDB)映射为同步所需的五个原语。
 * 记录需带字符串 id;合并时间戳字段优先级为 updatedAt > createdAt > evaluationTime(均 ISO 字符串)。
 */
export interface D1SyncDataAdapter {
  /** 导出全量快照(全量备份/合并基准) */
  exportSnapshot(): Promise<D1SyncSnapshot>;
  /** 导入快照;'replace' 清空后覆盖,'merge' 按 id upsert */
  importSnapshot(snapshot: D1SyncSnapshot, mode?: 'merge' | 'replace'): Promise<void>;
  /** 返回 since(ISO,可空)之后有变更的记录组成的快照(增量推送/待同步统计) */
  getChangesSince(since: string | null): Promise<D1SyncSnapshot>;
  /** 读取元数据(同步配置/时间戳的持久化通道) */
  getMeta<T>(key: string, defaultValue: T): Promise<T>;
  /** 写入元数据 */
  setMeta(key: string, value: unknown): Promise<void>;
}

/** createD1SyncService 的可选注入项 */
export interface D1SyncServiceOptions {
  /**
   * 配置里 accountId 留空时的兜底解析(如取当前登录账户名);
   * 抛错/返回空值时最终回退到固定 'local-user'
   */
  resolveAccountId?: () => Promise<string>;
}

/** 由 createD1SyncService 返回的同步服务实例(API 与 ability 的 remoteSync.ts 保持一致) */
export interface D1SyncService {
  /** 启动时从适配器 meta 恢复已保存的配置 */
  loadSyncConfig(): Promise<D1SyncConfig | null>;
  /** 保存配置(运行时 + 持久化) */
  configureSync(config: D1SyncConfig): Promise<void>;
  /** 同步读取当前运行时配置(未 loadSyncConfig 前为 null) */
  getSyncConfigSync(): D1SyncConfig | null;
  /** 断开配置(不删本地数据) */
  clearSyncConfig(): Promise<void>;
  /** 同步状态: 上次同步时间/待同步变更数/连通性 */
  getSyncStatus(): Promise<SyncStatus>;
  /** 上次全量备份时间(未备份过为 null) */
  getLastBackupAt(): Promise<string | null>;
  /** 连通性探针(GET /api/sync/health),未配置返回 false */
  checkHealth(): Promise<boolean>;
  /** 增量推送本地变更 */
  pushChanges(): Promise<SyncResult>;
  /** 增量拉取云端变更并按 LWW 合并到本地 */
  pullChanges(): Promise<SyncResult>;
  /** 先推后拉 */
  syncBoth(): Promise<{ push: SyncResult; pull: SyncResult }>;
  /** 全量备份到 D1(存为一个历史版本) */
  fullBackupToD1(): Promise<SyncResult>;
  /** 从 D1 恢复(默认最新备份,可指定 timestamp)并覆盖本地 */
  restoreFromD1(timestamp?: string): Promise<SyncResult>;
  /** 列出云端历史备份点(失败返回空数组) */
  listBackupPoints(): Promise<BackupPoint[]>;
}

// meta 持久化键名(与 ability-growth-system 保持一致,便于平滑切换)
const CONFIG_KEY = 'd1-sync-config';
const LAST_SYNC_KEY = 'd1-last-sync-at';
const LAST_BACKUP_KEY = 'd1-last-backup-at';

// ============ 快照通用工具(不绑定具体数据模型) ============

/** 从实体取合并时间戳(LWW 判定依据,字段优先级与 Worker 端 entityTimestamp 一致) */
function recordTimestamp(record: Record<string, unknown>): string {
  const t = record.updatedAt ?? record.createdAt ?? record.evaluationTime;
  return typeof t === 'string' ? t : '';
}

/** 快照中所有"记录表"的 key(值为数组的字段) */
function snapshotStoreKeys(snap: D1SyncSnapshot): string[] {
  return Object.keys(snap).filter((key) => Array.isArray(snap[key]));
}

/** 统计快照内记录总数(所有数组字段求和) */
function totalRecords(snap: D1SyncSnapshot): number {
  return snapshotStoreKeys(snap).reduce((sum, key) => sum + (snap[key] as unknown[]).length, 0);
}

interface MergeReport {
  snapshot: D1SyncSnapshot;
  pulled: number;
  conflicts: number;
}

/** 单表按 id 合并(Last-Write-Wins);无 id 的记录原样保留在本地侧 */
function mergeById(
  localList: Record<string, unknown>[],
  remoteList: Record<string, unknown>[],
): { merged: Record<string, unknown>[]; pulled: number; conflicts: number } {
  const localMap = new Map<string, Record<string, unknown>>();
  const idless: Record<string, unknown>[] = [];
  for (const record of localList) {
    if (record && typeof record.id === 'string') localMap.set(record.id, record);
    else idless.push(record);
  }
  let pulled = 0;
  let conflicts = 0;
  for (const remote of remoteList) {
    if (!remote || typeof remote.id !== 'string') continue;
    const local = localMap.get(remote.id);
    if (!local) {
      localMap.set(remote.id, remote);
      pulled++;
      continue;
    }
    if (recordTimestamp(remote) > recordTimestamp(local)) {
      localMap.set(remote.id, remote);
      pulled++;
      conflicts++;
    }
  }
  return { merged: [...idless, ...Array.from(localMap.values())], pulled, conflicts };
}

/** 整快照合并: 对 local/remote 的全部记录表逐表 LWW 合并,非数组元信息保留 local 侧 */
function mergeSnapshots(local: D1SyncSnapshot, remote: D1SyncSnapshot): MergeReport {
  let totalPulled = 0;
  let totalConflicts = 0;
  const merged: D1SyncSnapshot = { ...local };

  const storeKeys = new Set([...snapshotStoreKeys(local), ...snapshotStoreKeys(remote)]);
  for (const key of storeKeys) {
    const localList = (Array.isArray(local[key]) ? local[key] : []) as Record<string, unknown>[];
    const remoteList = (Array.isArray(remote[key]) ? remote[key] : []) as Record<string, unknown>[];
    const { merged: mergedList, pulled, conflicts } = mergeById(localList, remoteList);
    merged[key] = mergedList;
    totalPulled += pulled;
    totalConflicts += conflicts;
  }

  return {
    snapshot: { ...merged, exportedAt: new Date().toISOString() },
    pulled: totalPulled,
    conflicts: totalConflicts,
  };
}

// ============ 同步服务工厂 ============

/**
 * 创建 D1 同步服务实例。
 *
 * @param adapter  数据访问适配器(自定义实现,或直接用 createDefaultD1SyncAdapter())
 * @param options  可选注入: resolveAccountId 用于 accountId 留空时解析数据归属
 */
export function createD1SyncService(
  adapter: D1SyncDataAdapter,
  options?: D1SyncServiceOptions,
): D1SyncService {
  let runtimeConfig: D1SyncConfig | null = null;

  /**
   * 解析本次同步使用的 accountId(D1 内区分数据来源):
   * 1. 配置里显式填写了就用配置值(多设备想共用同一份数据时,各端填相同值即可互通)
   * 2. 否则调用注入的 resolveAccountId(如取当前登录账户名,同一账户名跨设备登录即可互通)
   * 3. 兜底用固定值 'local-user'(纯单设备备份场景,零配置)
   */
  async function resolveAccountId(cfg: D1SyncConfig): Promise<string> {
    if (cfg.accountId?.trim()) return cfg.accountId.trim();
    if (options?.resolveAccountId) {
      try {
        const id = await options.resolveAccountId();
        if (id?.trim()) return id.trim();
      } catch {
        /* 账户解析异常时走兜底 */
      }
    }
    return 'local-user';
  }

  function buildUrl(cfg: D1SyncConfig, path: string, params?: Record<string, string | undefined>): string {
    const base = cfg.apiEndpoint.replace(/\/$/, '');
    const url = new URL(`${base}${path}`);
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== '') url.searchParams.set(k, v);
      }
    }
    return url.toString();
  }

  async function authHeaders(cfg: D1SyncConfig, extra?: HeadersInit): Promise<Headers> {
    const headers = new Headers(extra);
    if (cfg.authToken) headers.set('Authorization', `Bearer ${cfg.authToken}`);
    headers.set('X-Sync-Account', await resolveAccountId(cfg));
    return headers;
  }

  async function checkConnectivity(cfg: D1SyncConfig): Promise<boolean> {
    try {
      const res = await fetch(buildUrl(cfg, '/api/sync/health'), {
        method: 'GET',
        headers: await authHeaders(cfg),
        signal: AbortSignal.timeout(5000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  function emptyResult(error?: string): SyncResult {
    return {
      success: !error,
      pushed: 0,
      pulled: 0,
      conflicts: 0,
      timestamp: new Date().toISOString(),
      error,
    };
  }

  async function getSyncStatus(): Promise<SyncStatus> {
    const cfg = runtimeConfig;
    const lastSyncAt = await adapter.getMeta<string | null>(LAST_SYNC_KEY, null);
    const pending = await adapter.getChangesSince(lastSyncAt);
    const pendingChanges = totalRecords(pending);
    const isOnline = cfg ? await checkConnectivity(cfg) : false;
    return { lastSyncAt, pendingChanges, isOnline };
  }

  async function getLastBackupAt(): Promise<string | null> {
    return adapter.getMeta<string | null>(LAST_BACKUP_KEY, null);
  }

  async function pushChanges(): Promise<SyncResult> {
    const cfg = runtimeConfig;
    if (!cfg) return emptyResult('未配置 D1 同步服务');
    try {
      const lastSyncAt = await adapter.getMeta<string | null>(LAST_SYNC_KEY, null);
      const changes = await adapter.getChangesSince(lastSyncAt);
      const total = totalRecords(changes);
      if (total === 0) return { ...emptyResult(), success: true };
      const res = await fetch(buildUrl(cfg, '/api/sync/push'), {
        method: 'POST',
        headers: await authHeaders(cfg, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          accountId: await resolveAccountId(cfg),
          snapshot: changes,
          since: lastSyncAt,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`推送失败(HTTP ${res.status}): ${await res.text()}`);
      const body = (await res.json()) as { conflicts?: number };
      const now = new Date().toISOString();
      await adapter.setMeta(LAST_SYNC_KEY, now);
      return { success: true, pushed: total, pulled: 0, conflicts: body.conflicts ?? 0, timestamp: now };
    } catch (e) {
      return emptyResult(e instanceof Error ? e.message : '未知错误');
    }
  }

  async function pullChanges(): Promise<SyncResult> {
    const cfg = runtimeConfig;
    if (!cfg) return emptyResult('未配置 D1 同步服务');
    try {
      const lastSyncAt = await adapter.getMeta<string | null>(LAST_SYNC_KEY, null);
      const res = await fetch(
        buildUrl(cfg, '/api/sync/pull', { accountId: await resolveAccountId(cfg), since: lastSyncAt ?? undefined }),
        { headers: await authHeaders(cfg) },
      );
      if (!res.ok) throw new Error(`拉取失败(HTTP ${res.status}): ${await res.text()}`);
      const remote = (await res.json()) as D1SyncSnapshot;

      const local = await adapter.exportSnapshot();
      const merged = mergeSnapshots(local, remote);
      await adapter.importSnapshot(merged.snapshot, 'replace');

      const now = new Date().toISOString();
      await adapter.setMeta(LAST_SYNC_KEY, now);
      return { success: true, pushed: 0, pulled: merged.pulled, conflicts: merged.conflicts, timestamp: now };
    } catch (e) {
      return emptyResult(e instanceof Error ? e.message : '未知错误');
    }
  }

  async function syncBoth(): Promise<{ push: SyncResult; pull: SyncResult }> {
    const push = await pushChanges();
    const pull = await pullChanges();
    return { push, pull };
  }

  async function fullBackupToD1(): Promise<SyncResult> {
    const cfg = runtimeConfig;
    if (!cfg) return emptyResult('未配置 D1 同步服务');
    try {
      const snapshot = await adapter.exportSnapshot();
      const res = await fetch(buildUrl(cfg, '/api/sync/backup'), {
        method: 'POST',
        headers: await authHeaders(cfg, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          accountId: await resolveAccountId(cfg),
          snapshot,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`备份失败(HTTP ${res.status}): ${await res.text()}`);
      const now = new Date().toISOString();
      await adapter.setMeta(LAST_SYNC_KEY, now);
      await adapter.setMeta(LAST_BACKUP_KEY, now);
      return { success: true, pushed: totalRecords(snapshot), pulled: 0, conflicts: 0, timestamp: now };
    } catch (e) {
      return emptyResult(e instanceof Error ? e.message : '未知错误');
    }
  }

  async function restoreFromD1(timestamp?: string): Promise<SyncResult> {
    const cfg = runtimeConfig;
    if (!cfg) return emptyResult('未配置 D1 同步服务');
    try {
      const res = await fetch(
        buildUrl(cfg, '/api/sync/restore', { accountId: await resolveAccountId(cfg), timestamp }),
        { headers: await authHeaders(cfg) },
      );
      if (!res.ok) throw new Error(`恢复失败(HTTP ${res.status}): ${await res.text()}`);
      const snapshot = (await res.json()) as D1SyncSnapshot;
      await adapter.importSnapshot(snapshot, 'replace');
      const now = new Date().toISOString();
      await adapter.setMeta(LAST_SYNC_KEY, now);
      return { success: true, pushed: 0, pulled: totalRecords(snapshot), conflicts: 0, timestamp: now };
    } catch (e) {
      return emptyResult(e instanceof Error ? e.message : '未知错误');
    }
  }

  async function listBackupPoints(): Promise<BackupPoint[]> {
    const cfg = runtimeConfig;
    if (!cfg) return [];
    try {
      const res = await fetch(buildUrl(cfg, '/api/sync/backups', { accountId: await resolveAccountId(cfg) }), {
        headers: await authHeaders(cfg),
      });
      if (!res.ok) return [];
      return (await res.json()) as BackupPoint[];
    } catch {
      return [];
    }
  }

  return {
    loadSyncConfig: async () => {
      const persisted = await adapter.getMeta<D1SyncConfig | null>(CONFIG_KEY, null);
      runtimeConfig = persisted;
      return persisted;
    },
    configureSync: async (config: D1SyncConfig) => {
      runtimeConfig = config;
      await adapter.setMeta(CONFIG_KEY, config);
    },
    getSyncConfigSync: () => runtimeConfig,
    clearSyncConfig: async () => {
      runtimeConfig = null;
      await adapter.setMeta(CONFIG_KEY, null);
    },
    getSyncStatus,
    getLastBackupAt,
    checkHealth: () => (runtimeConfig ? checkConnectivity(runtimeConfig) : Promise.resolve(false)),
    pushChanges,
    pullChanges,
    syncBoth,
    fullBackupToD1,
    restoreFromD1,
    listBackupPoints,
  };
}

// ============ 默认适配器(基于本包 services/db.ts) ============

/**
 * 基于 shared-core services/db.ts(records + settings 两表结构)的默认适配器,
 * 让"标准 db.ts 用户"零成本接入。要求已调用 setCurrentAccountId(多账户各自隔离,与 D1 accountId 天然对应)。
 *
 * 能力边界:
 * - 全量备份/恢复: records + settings 全量导出/导入
 *   (settings 无数组结构,导出时数组化为 { id: key, value } 记录,随备份快照整体上云/回本地)
 * - 增量推送/拉取: 仅 records(db.ts 的 getRecordsModifiedSince 按 updatedAt 增量过滤);
 *   settings 无修改时间戳,不参与增量同步——其变更只随下次全量备份上云、恢复时回本地
 */
export function createDefaultD1SyncAdapter(): D1SyncDataAdapter {
  return {
    async exportSnapshot(): Promise<D1SyncSnapshot> {
      const data = await exportAllData();
      return {
        version: data.version,
        exportedAt: data.exportedAt,
        records: data.records,
        settings: Object.entries(data.settings ?? {}).map(([key, value]) => ({ id: key, value })),
      };
    },

    async importSnapshot(snapshot: D1SyncSnapshot, mode: 'merge' | 'replace' = 'merge'): Promise<void> {
      if (mode === 'replace') await clearAllData();
      const records = (Array.isArray(snapshot.records) ? snapshot.records : []) as FormRecord[];
      const settingsRows = Array.isArray(snapshot.settings)
        ? (snapshot.settings as { id?: unknown; value?: unknown }[])
        : [];
      const settings = Object.fromEntries(
        settingsRows.filter((r) => typeof r?.id === 'string').map((r) => [r.id as string, r.value]),
      );
      await importAllData({
        records,
        settings,
        version: (typeof snapshot.version === 'string' && snapshot.version) || '1.0.0',
        exportedAt: (typeof snapshot.exportedAt === 'string' && snapshot.exportedAt) || new Date().toISOString(),
      });
    },

    async getChangesSince(since: string | null): Promise<D1SyncSnapshot> {
      const records = await getRecordsModifiedSince(since);
      return { records, version: '1.0.0', exportedAt: new Date().toISOString() };
    },

    getMeta<T>(key: string, defaultValue: T): Promise<T> {
      return getSetting<T>(key, defaultValue);
    },

    setMeta(key: string, value: unknown): Promise<void> {
      return setSetting(key, value);
    },
  };
}
