-- Cloudflare D1 建表脚本（通用模板，与默认适配器 createDefaultD1SyncAdapter 的快照结构对应）
-- 使用方式:
--   npx wrangler d1 execute <database_name> --remote --file=./schema.sql
-- 说明:
--   - 每张业务表结构相同: id 主键 + updated_at(Last-Write-Wins 排序/合并依据) + data(实体 JSON)
--   - 默认两张表: records(表单记录,updated_at 取实体 updatedAt) + settings(键值设置)
--     settings 记录无修改时间戳,仅随全量备份/恢复整体流动,不参与增量 LWW 合并
--   - 消费方数据模型不同时按需增删表,并同步修改 src/index.ts 的 STORES 白名单(两处保持一致)
--   - sync_backups 保存全量备份版本(按时间戳), 前端可列出/恢复历史备份点

-- 业务表
CREATE TABLE IF NOT EXISTS records (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, data TEXT NOT NULL);

-- 索引: 增量拉取按 updated_at 过滤
CREATE INDEX IF NOT EXISTS idx_records_updated ON records(updated_at);
CREATE INDEX IF NOT EXISTS idx_settings_updated ON settings(updated_at);

-- 全量备份版本表: id = 备份时间戳(ISO), account_id 隔离不同账户
CREATE TABLE IF NOT EXISTS sync_backups (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  data TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_backups_account ON sync_backups(account_id, created_at);
