import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { 
  InsertUser, users, 
  quickbooksHistory, InsertQuickbooksHistory,
  accountRegistry, Account, InsertAccount,
  importLog, ImportLog, InsertImportLog
} from "../drizzle/schema";
import { and } from "drizzle-orm";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

// Lazily create the drizzle instance so local tooling can run without a DB.
export async function getDb() {
  if (!_db && ENV.databaseUrl) {
    try {
      _db = drizzle(ENV.databaseUrl);
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

export async function storeQuickbooksHistory(entries: InsertQuickbooksHistory[]): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot store QuickBooks history: database not available");
    return;
  }

  try {
    // Process in batches of 100 to avoid large payload issues
    const batchSize = 100;
    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      await db.insert(quickbooksHistory).values(batch);
    }
  } catch (error) {
    console.error("[Database] Failed to store QuickBooks history:", error);
    throw error;
  }
}

export async function getQuickbooksHistory(userId: number): Promise<InsertQuickbooksHistory[]> {
  const db = await getDb();
  if (!db) {
    console.warn("[Database] Cannot get QuickBooks history: database not available");
    return [];
  }

  try {
    return await db.select().from(quickbooksHistory).where(eq(quickbooksHistory.userId, userId));
  } catch (error) {
    console.error("[Database] Failed to get QuickBooks history:", error);
    return [];
  }
}

// Account Registry Functions
export async function getAccounts(userId: number): Promise<Account[]> {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(accountRegistry).where(and(eq(accountRegistry.userId, userId), eq(accountRegistry.isActive, 1)));
}

export async function createAccount(account: InsertAccount): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(accountRegistry).values(account);
}

export async function updateAccount(id: number, userId: number, account: Partial<InsertAccount>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(accountRegistry).set(account).where(and(eq(accountRegistry.id, id), eq(accountRegistry.userId, userId)));
}

// Import Log Functions
export async function getImportLogs(userId: number): Promise<ImportLog[]> {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(importLog).where(eq(importLog.userId, userId));
}

export async function checkImportExists(accountId: number, period: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select().from(importLog).where(and(eq(importLog.accountId, accountId), eq(importLog.statementPeriod, period))).limit(1);
  return result.length > 0;
}

export async function storeImportLog(log: InsertImportLog): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(importLog).values(log);
}
}
