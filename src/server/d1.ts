/**
 * D1 访问层（类型 + 通用工具）
 *
 * 收归各项目后端重复的 D1 接入代码：
 * - D1 句柄与语句的类型声明（各项目原先各写一份，签名还不一致）
 * - 批量执行的分批处理（D1 单次 batch 有语句数上限）
 * - 表结构探测（schema 自愈时要用）
 * - 常用的小工具（是否存在、计数、事务式批量写）
 *
 * ## 不依赖 @cloudflare/workers-types
 *
 * 这里用**结构化类型**声明 D1 的最小接口，运行时不需要类型包，
 * 消费方的 `D1Database`（来自 workers-types）可以直接传进来——
 * TypeScript 的结构化类型保证兼容。
 *
 * ## 不改数据模型
 *
 * 本模块**只提供访问方式**，不涉及任何表结构：
 * 表名、列名、索引、迁移文件全部由各项目自己管。
 */

/**
 * D1 预编译语句。
 *
 * 与 Cloudflare 官方 `D1PreparedStatement` 结构兼容，
 * 也与各项目原先自写的 `Statement` 接口兼容。
 */
export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ success: boolean; meta: D1MetaLike }>;
}

/**
 * D1 执行结果的元信息（官方类型叫 D1Meta）。
 *
 * 只有需要读 `changes` / `last_row_id` 时才用得上。
 */
export interface D1MetaLike {
  changes?: number;
  last_row_id?: number;
  duration?: number;
  rows_read?: number;
  rows_written?: number;
  served_by?: string | null;
  /** 允许其它 meta 字段（D1 后续可能新增） */
  [key: string]: unknown;
}

/**
 * D1 批量执行的结果形状。
 *
 * 与 Cloudflare 官方 `D1Result` 结构一致：每条语句对应一个结果，
 * 里面带 `results`（查询行）与 `success` / `meta`。
 */
export interface D1BatchResultLike<T = unknown> {
  results?: T[];
  success?: boolean;
  meta?: D1MetaLike;
}

/**
 * D1 数据库句柄。
 *
 * 与 Cloudflare 官方 `D1Database` 结构兼容。
 *
 * `batch` 在真实 D1 上一定存在，因此这里声明为**可选**——
 * 这样只用到 prepare 的场景（多数只读查询）不必实现它，
 * 而真正需要批量写入时用 `runBatches` / `runBatchesWithResults`，
 * 它们会在句柄缺少 batch 时给出明确报错，而不是让调用方到处判空。
 */
export interface D1DatabaseLike {
  prepare(query: string): D1PreparedStatementLike;
  batch?<T = unknown>(statements: D1PreparedStatementLike[]): Promise<D1BatchResultLike<T>[]>;
}

/**
 * 完整 D1 句柄（含 batch）。
 *
 * 需要直接调用 `db.batch(...)` 的场景用这个类型——
 * TypeScript 就知道 batch 一定在，不必写 `db.batch!(...)`。
 */
export interface D1WithBatchLike extends D1DatabaseLike {
  batch<T = unknown>(statements: D1PreparedStatementLike[]): Promise<D1BatchResultLike<T>[]>;
}

/**
 * 把任意 D1 句柄转成本模块的接口类型。
 *
 * 各项目的 D1 句柄类型写法不一（官方 `D1Database`、自写 `Database`、
 * `Env['DB']` 索引访问、无类型 JS），但运行时结构一致，
 * 用一次断言即可统一——**不改任何表结构与数据模型**。
 *
 * @example
 * const db = toD1(env.DB);
 * const rows = await queryAll(db, 'SELECT id FROM users WHERE id = ?', id);
 */
export function toD1(db: unknown): D1DatabaseLike {
  return db as D1DatabaseLike;
}

/**
 * D1 单次 batch 的语句数上限。
 *
 * 超出会报 "too many statements"（D1 限制 100 条）。
 * 分批执行是各项目后端重复实现过的东西，这里统一。
 */
export const D1_MAX_BATCH_STATEMENTS = 100;

/**
 * 把一批语句分批执行。
 *
 * @param db D1 句柄
 * @param statements 待执行语句
 * @param size 每批条数，默认 D1_MAX_BATCH_STATEMENTS
 * @throws db 没有 batch 方法时（本地假库），抛出明确错误而不是静默失败
 */
export async function runBatches(
  db: D1DatabaseLike,
  statements: D1PreparedStatementLike[],
  size: number = D1_MAX_BATCH_STATEMENTS,
): Promise<void> {
  if (statements.length === 0) return;
  if (!db.batch) {
    throw new Error('该 D1 句柄没有 batch 方法，无法批量执行');
  }
  for (let index = 0; index < statements.length; index += size) {
    await db.batch(statements.slice(index, index + size));
  }
}

/**
 * 批量执行并返回每条语句的结果。
 *
 * 与 runBatches 的区别：需要逐条结果时用它（例如逐条检查冲突数）。
 *
 * @returns 每条语句对应的结果（顺序与 statements 一致）
 */
export async function runBatchesWithResults<T = unknown>(
  db: D1DatabaseLike,
  statements: D1PreparedStatementLike[],
  size: number = D1_MAX_BATCH_STATEMENTS,
): Promise<D1BatchResultLike<T>[]> {
  if (statements.length === 0) return [];
  if (!db.batch) {
    throw new Error('该 D1 句柄没有 batch 方法，无法批量执行');
  }
  const results: D1BatchResultLike<T>[] = [];
  for (let index = 0; index < statements.length; index += size) {
    const chunk = await db.batch<T>(statements.slice(index, index + size));
    results.push(...chunk);
  }
  return results;
}

/**
 * 判断当前库的结构是否满足要求。
 *
 * 一些项目在冷启动时做 schema 自愈（缺列就补、缺表就建），
 * 但每次请求都跑一遍 PRAGMA 很慢。这里一次性探明「表和列齐不齐」，
 * 齐了就不做任何 DDL，不齐再走自愈逻辑。
 *
 * @param db D1 句柄
 * @param required 每张表必需的列（表名 → 列名数组）
 * @param requiredIndexes 必需的索引名
 */
export async function schemaIsSatisfied(
  db: D1DatabaseLike,
  required: Record<string, string[]>,
  requiredIndexes: string[] = [],
): Promise<boolean> {
  for (const [table, columns] of Object.entries(required)) {
    const present = new Set(await tableColumns(db, table));
    if (present.size === 0) return false; // 表不存在
    for (const column of columns) {
      if (!present.has(column)) return false;
    }
  }
  if (requiredIndexes.length === 0) return true;

  const rows = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${requiredIndexes
        .map(() => '?')
        .join(',')})`,
    )
    .bind(...requiredIndexes)
    .all<{ name: string }>();
  const present = new Set(rows.results.map((row) => row.name));
  return requiredIndexes.every((name) => present.has(name));
}

/**
 * 判断当前库的结构是否满足要求（**批量探活**）。
 *
 * 与 schemaIsSatisfied 的区别：把所有 PRAGMA 探针打包成一次 batch，
 * 只发一个往返。冷启动时表多，逐表探会拖慢请求——
 * 探活这一步必须快。
 *
 * @param db D1 句柄（需支持 batch）
 * @param required 每张表必需的列（表名 → 列名数组）
 * @param requiredIndexes 必需的索引名
 */
export async function schemaIsSatisfiedBatched(
  db: D1WithBatchLike,
  required: Record<string, string[]>,
  requiredIndexes: string[] = [],
): Promise<boolean> {
  const tables = Object.keys(required);
  const probes = tables.map((table) => db.prepare(`PRAGMA table_info(${table})`));
  if (requiredIndexes.length > 0) {
    probes.push(
      db
        .prepare(
          `SELECT name FROM sqlite_master WHERE type = 'index' AND name IN (${requiredIndexes
            .map(() => '?')
            .join(',')})`,
        )
        .bind(...requiredIndexes),
    );
  }

  const results = await db.batch<{ name: string }>(probes);
  const columnsOk = tables.every((table, index) => {
    const present = new Set((results[index]?.results ?? []).map((row) => row.name));
    return required[table].every((column) => present.has(column));
  });
  if (!columnsOk) return false;
  if (requiredIndexes.length === 0) return true;

  const indexes = new Set(
    (results[results.length - 1]?.results ?? []).map((row) => row.name),
  );
  return requiredIndexes.every((name) => indexes.has(name));
}

/**
 * 补一列（幂等）。
 *
 * D1 的 `ALTER TABLE ... ADD COLUMN` 不支持 `IF NOT EXISTS`，
 * 重复列会报错——这里把「列已存在」当作成功。
 *
 * @returns true 表示列已就绪（含本次新建）
 */
export async function ensureColumn(
  db: D1DatabaseLike,
  table: string,
  column: string,
  ddl: string,
): Promise<boolean> {
  if (await hasColumn(db, table, column)) return true;
  try {
    await db.prepare(`ALTER TABLE ${table} ADD COLUMN ${ddl}`).run();
    return true;
  } catch (error) {
    // 并发冷启动时另一个实例可能已经补列，忽略重复列错误
    const message = error instanceof Error ? error.message : String(error);
    if (!/duplicate column/i.test(message)) throw error;
    return true;
  }
}

/**
 * 建表（幂等）。
 */
export async function ensureTable(
  db: D1DatabaseLike,
  table: string,
  ddl: string,
): Promise<void> {
  await db.prepare(`CREATE TABLE IF NOT EXISTS ${table} ${ddl}`).run();
}

/**
 * 建索引（幂等）。
 */
export async function ensureIndex(
  db: D1DatabaseLike,
  index: string,
  ddl: string,
): Promise<void> {
  await db.prepare(`CREATE INDEX IF NOT EXISTS ${index} ${ddl}`).run();
}

/**
 * 读一张表的列信息。
 *
 * schema 自愈 / 迁移校验时都要先知道表当前有哪些列。
 *
 * @returns 列名数组；表不存在时返回空数组
 */
export async function tableColumns(
  db: D1DatabaseLike,
  table: string,
): Promise<string[]> {
  const row = await db
    .prepare(`PRAGMA table_info(${table})`)
    .first<{ name: string }>();
  if (!row) return [];
  const rows = await db.prepare(`PRAGMA table_info(${table})`).all<{ name: string }>();
  return rows.results.map((item) => item.name);
}

/**
 * 表是否存在。
 *
 * @param db D1 句柄
 * @param table 表名
 */
export async function tableExists(db: D1DatabaseLike, table: string): Promise<boolean> {
  const row = await db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`,
    )
    .bind(table)
    .first<{ name: string }>();
  return Boolean(row);
}

/**
 * 表里是否已存在某列。
 */
export async function hasColumn(
  db: D1DatabaseLike,
  table: string,
  column: string,
): Promise<boolean> {
  const columns = await tableColumns(db, table);
  return columns.includes(column);
}

/**
 * 统计行数。
 *
 * @param db D1 句柄
 * @param table 表名
 * @param where 可选的 WHERE 子句（不含 WHERE 关键字）
 */
export async function countRows(
  db: D1DatabaseLike,
  table: string,
  where?: string,
): Promise<number> {
  const clause = where ? ` WHERE ${where}` : '';
  const row = await db
    .prepare(`SELECT COUNT(*) AS c FROM ${table}${clause}`)
    .first<{ c: number }>();
  return Number(row?.c ?? 0);
}

/**
 * 一次取多行的便捷封装。
 *
 * @param db D1 句柄
 * @param sql 查询语句
 * @param values 绑定参数
 */
export async function queryAll<T = Record<string, unknown>>(
  db: D1DatabaseLike,
  sql: string,
  ...values: unknown[]
): Promise<T[]> {
  const result = await db.prepare(sql).bind(...values).all<T>();
  return result.results;
}

/**
 * 取第一行的便捷封装。
 */
export async function queryFirst<T = Record<string, unknown>>(
  db: D1DatabaseLike,
  sql: string,
  ...values: unknown[]
): Promise<T | null> {
  return db.prepare(sql).bind(...values).first<T>();
}

/**
 * 执行一条写语句。
 */
export async function execute(
  db: D1DatabaseLike,
  sql: string,
  ...values: unknown[]
): Promise<{ success: boolean; meta?: Record<string, unknown> }> {
  return db.prepare(sql).bind(...values).run();
}

/**
 * 判断 D1 句柄是否可用（能否查通）。
 *
 * 冷启动探活用：一次 SELECT 1 就够，比逐表探活快得多。
 */
export async function ping(db: D1DatabaseLike): Promise<boolean> {
  try {
    const row = await db.prepare('SELECT 1 AS ok').first<{ ok: number }>();
    return row?.ok === 1;
  } catch {
    return false;
  }
}
