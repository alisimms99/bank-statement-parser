import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * Extend this file with additional tables as your product grows.
 * Columns use camelCase to match both database fields and generated types.
 */
export const users = mysqlTable("users", {
  /**
   * Surrogate primary key. Auto-incremented numeric value managed by the database.
   * Use this for relations between tables.
   */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. Unique per user. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

export const quickbooksHistory = mysqlTable("quickbooks_history", {
  id: int("id").autoincrement().primaryKey(),
  date: varchar("date", { length: 255 }).notNull(),
  description: text("description").notNull(),
  payee: varchar("payee", { length: 255 }),
  category: varchar("category", { length: 255 }).notNull(),
  amount: varchar("amount", { length: 255 }).notNull(), // Store as string to handle different formats
  userId: int("userId").references(() => users.id),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type QuickbooksHistory = typeof quickbooksHistory.$inferSelect;
export type InsertQuickbooksHistory = typeof quickbooksHistory.$inferInsert;