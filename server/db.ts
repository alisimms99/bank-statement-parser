import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, users } from "../drizzle/schema";
import { ENV } from './_core/env';

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) {
    throw new Error("User openId is required for upsert");
  }

  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot upsert user: database not available");
    return;
  }

  try {
    const values: InsertUser = {
      openId: user.openId,
    };
    const updateSet: Record<string, unknown> = {};

    const textFields = ["name", "email", "loginMethod"] as const;
    type TextField = (typeof textFields)[number];

    const assignNullable = (field: TextField) => {
      const value = user[field];
      if (value === undefined) return;
      const normalized = value ?? null;
      values[field] = normalized;
      updateSet[field] = normalized;
    };

    textFields.forEach(assignNullable);

    if (user.lastSignedIn !== undefined) {
      values.lastSignedIn = user.lastSignedIn;
      updateSet.lastSignedIn = user.lastSignedIn;
    }
    if (user.role !== undefined) {
      values.role = user.role;
      updateSet.role = user.role;
    } else if (user.openId === ENV.ownerOpenId) {
      values.role = 'admin';
      updateSet.role = 'admin';
    }

    if (!values.lastSignedIn) {
      values.lastSignedIn = new Date();
    }

    if (Object.keys(updateSet).length === 0) {
      updateSet.lastSignedIn = new Date();
    }

    await db.insert(users).values(values).onDuplicateKeyUpdate({
      set: updateSet,
    });
  } catch (error) {
    console.error("[Database] Failed to upsert user:", error);
    throw error;
  }
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get user: database not available");
    return undefined;
  }

  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);

  return result.length > 0 ? result[0] : undefined;
}

// Account and import log functions for Google Sheets export
export interface Account {
  id: number;
  userId: number;
  name: string;
  type: string;
  spreadsheetId?: string;
  createdAt: Date;
}

export interface ImportLog {
  id: number;
  accountId: number;
  userId: number;
  transactionCount: number;
  periodStart?: string;
  periodEnd?: string;
  fileHash?: string;
  createdAt: Date;
}

// In-memory stores for development (in production, use DB tables)
const accountsStore = new Map<number, Account[]>();
const importLogsStore = new Map<string, ImportLog[]>();

export async function getAccounts(userId: number): Promise<Account[]> {
  const db = await getDb();
  if (!db) {
    // Return in-memory accounts for development
    return accountsStore.get(userId) || [];
  }
  // TODO: Query from database when accounts table is added
  return accountsStore.get(userId) || [];
}

export async function createAccount(userId: number, account: Omit<Account, "id" | "userId" | "createdAt">): Promise<Account> {
  const accounts = accountsStore.get(userId) || [];
  const newAccount: Account = {
    ...account,
    id: Date.now(),
    userId,
    createdAt: new Date(),
  };
  accounts.push(newAccount);
  accountsStore.set(userId, accounts);
  return newAccount;
}

export async function checkImportExists(
  accountId: number,
  fileHash: string
): Promise<boolean> {
  const key = `${accountId}`;
  const logs = importLogsStore.get(key) || [];
  return logs.some(log => log.fileHash === fileHash);
}

export async function storeImportLog(log: Omit<ImportLog, "id" | "createdAt">): Promise<ImportLog> {
  const key = `${log.accountId}`;
  const logs = importLogsStore.get(key) || [];
  const newLog: ImportLog = {
    ...log,
    id: Date.now(),
    createdAt: new Date(),
  };
  logs.push(newLog);
  importLogsStore.set(key, logs);
  return newLog;
}

export async function getImportLogs(accountId: number): Promise<ImportLog[]> {
  const key = `${accountId}`;
  return importLogsStore.get(key) || [];
}
