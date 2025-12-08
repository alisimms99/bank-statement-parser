import { randomUUID } from "crypto";
import type { CanonicalTransaction } from "@shared/transactions";

// In-memory store for transactions (keyed by UUID)
// In production, this could be replaced with Redis or a database
const transactionStore = new Map<string, CanonicalTransaction[]>();

// Clean up old entries after 1 hour
const STORE_TTL_MS = 60 * 60 * 1000;

/**
 * Store transactions and return a UUID for retrieval
 */
export function storeTransactions(transactions: CanonicalTransaction[]): string {
  const id = randomUUID();
  transactionStore.set(id, transactions);
  
  // Schedule cleanup after TTL
  setTimeout(() => {
    transactionStore.delete(id);
  }, STORE_TTL_MS);
  
  return id;
}

