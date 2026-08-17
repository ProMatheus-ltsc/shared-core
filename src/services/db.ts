/**
 * IndexedDB 数据层 - 可配置版本
 * 各项目通过 configureDB 设置不同的数据库名和表结构
 * 默认使用通用的 records + settings 两表结构
 */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import type { Account, FormRecord, ExportedData } from '../types';

interface MetaDBSchema extends DBSchema {
  accounts: {
    key: string;
    value: Account;
  };
}

interface BusinessDBSchema extends DBSchema {
  records: {
    key: string;
    value: FormRecord;
    indexes: {
      templateId: string;
      createdAt: string;
      updatedAt: string;
      module: string;
    };
  };
  settings: {
    key: string;
    value: { key: string; value: unknown };
  };
}

/** 数据库配置：各项目通过 configureDB 设置自己的数据库名前缀 */
let DB_PREFIX = 'shared-app';

export function configureDB(prefix: string): void {
  DB_PREFIX = prefix;
  // 重置缓存以使用新前缀
  metaDBPromise = undefined;
  businessDBPromise = undefined;
}

export function getDBPrefix(): string {
  return DB_PREFIX;
}

let metaDBPromise: Promise<IDBPDatabase<MetaDBSchema>> | undefined;

function getMetaDB(): Promise<IDBPDatabase<MetaDBSchema>> {
  if (!metaDBPromise) {
    metaDBPromise = openDB<MetaDBSchema>(DB_PREFIX, 1, {
      upgrade(db) {
        db.createObjectStore('accounts', { keyPath: 'id' });
      },
    });
  }
  return metaDBPromise;
}

let currentAccountId: string | undefined;
let businessDBPromise: Promise<IDBPDatabase<BusinessDBSchema>> | undefined;

export function setCurrentAccountId(accountId: string | undefined): void {
  currentAccountId = accountId;
  businessDBPromise = undefined;
}

export function getCurrentAccountId(): string | undefined {
  return currentAccountId;
}

function getBusinessDB(): Promise<IDBPDatabase<BusinessDBSchema>> {
  if (!currentAccountId) {
    throw new Error('尚未选择当前账户，无法访问业务数据库');
  }
  if (!businessDBPromise) {
    const dbName = `${DB_PREFIX}-${currentAccountId}`;
    businessDBPromise = openDB<BusinessDBSchema>(dbName, 1, {
      upgrade(db) {
        const recordStore = db.createObjectStore('records', { keyPath: 'id' });
        recordStore.createIndex('templateId', 'templateId');
        recordStore.createIndex('createdAt', 'createdAt');
        recordStore.createIndex('updatedAt', 'updatedAt');
        recordStore.createIndex('module', 'module');
        db.createObjectStore('settings', { keyPath: 'key' });
      },
    });
  }
  return businessDBPromise;
}

// === 账户操作 ===

export async function listAccounts(): Promise<Account[]> {
  const db = await getMetaDB();
  return db.getAll('accounts');
}

export async function getAccountByUsername(username: string): Promise<Account | undefined> {
  const accounts = await listAccounts();
  return accounts.find((a) => a.username === username);
}

export async function createAccount(account: Account): Promise<void> {
  const db = await getMetaDB();
  await db.put('accounts', account);
}

// === 记录操作 ===

export async function getAllRecords(): Promise<FormRecord[]> {
  const db = await getBusinessDB();
  return db.getAll('records');
}

export async function getRecord(id: string): Promise<FormRecord | undefined> {
  const db = await getBusinessDB();
  return db.get('records', id);
}

export async function putRecord(record: FormRecord): Promise<void> {
  const db = await getBusinessDB();
  await db.put('records', record);
}

export async function deleteRecord(id: string): Promise<void> {
  const db = await getBusinessDB();
  await db.delete('records', id);
}

export async function deleteRecords(ids: string[]): Promise<void> {
  const db = await getBusinessDB();
  const tx = db.transaction('records', 'readwrite');
  await Promise.all(ids.map((id) => tx.store.delete(id)));
  await tx.done;
}

export async function getRecordsByTemplate(templateId: string): Promise<FormRecord[]> {
  const db = await getBusinessDB();
  return db.getAllFromIndex('records', 'templateId', templateId);
}

export async function getRecordsByModule(module: string): Promise<FormRecord[]> {
  const db = await getBusinessDB();
  return db.getAllFromIndex('records', 'module', module);
}

export async function searchRecords(query: string): Promise<FormRecord[]> {
  const all = await getAllRecords();
  if (!query.trim()) return all;
  const lower = query.toLowerCase();
  return all.filter((r) => JSON.stringify(r).toLowerCase().includes(lower));
}

// === 设置操作 ===

export async function getSetting<T>(key: string, defaultValue: T): Promise<T> {
  const db = await getBusinessDB();
  const row = await db.get('settings', key);
  return row ? (row.value as T) : defaultValue;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const db = await getBusinessDB();
  await db.put('settings', { key, value });
}

// === 导入导出 ===

export async function exportAllData(): Promise<ExportedData> {
  const db = await getBusinessDB();
  const records = await db.getAll('records');
  const settingsRows = await db.getAll('settings');
  const settings = Object.fromEntries(settingsRows.map((row) => [row.key, row.value]));
  return { records, settings, version: '1.0.0', exportedAt: new Date().toISOString() };
}

export async function importAllData(data: ExportedData): Promise<void> {
  const db = await getBusinessDB();
  const tx = db.transaction(['records', 'settings'], 'readwrite');
  await Promise.all(data.records.map((record) => tx.objectStore('records').put(record)));
  await Promise.all(
    Object.entries(data.settings ?? {}).map(([key, value]) =>
      tx.objectStore('settings').put({ key, value })
    )
  );
  await tx.done;
}

export async function clearAllData(): Promise<void> {
  const db = await getBusinessDB();
  const tx = db.transaction(['records', 'settings'], 'readwrite');
  await tx.objectStore('records').clear();
  await tx.objectStore('settings').clear();
  await tx.done;
}

// === 统计辅助 ===

export async function getRecordsModifiedSince(since: string | null): Promise<FormRecord[]> {
  const all = await getAllRecords();
  if (!since) return all;
  return all.filter((r) => r.updatedAt > since);
}
