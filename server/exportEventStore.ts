import { randomUUID } from "crypto";
import type { CanonicalTransaction } from "@shared/transactions";

export type ExportFormat = "csv" | "pdf";

export interface ExportEvent {
  exportId: string;
  format: ExportFormat;
  status: "success" | "expired" | "error";
  timestamp: Date;
  message?: string;
}

interface StoredTransactions {
  transactions: CanonicalTransaction[];
  expiresAt: number;
}

export class ExportEventStore {
  private readonly transactions = new Map<string, StoredTransactions>();
  private readonly events: ExportEvent[] = [];

  constructor(private readonly ttlMs = 60 * 60 * 1000) {}

  storeTransactions(transactions: CanonicalTransaction[]): string {
    const id = randomUUID();
    const expiresAt = Date.now() + this.ttlMs;

    this.transactions.set(id, { transactions, expiresAt });

    return id;
  }

  getTransactions(id: string): CanonicalTransaction[] | null {
    const entry = this.transactions.get(id);

    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.transactions.delete(id);
      return null;
    }

    return entry.transactions;
  }

  logEvent(event: Omit<ExportEvent, "timestamp">): void {
    this.events.push({ ...event, timestamp: new Date() });
  }

  getEvents(): ExportEvent[] {
    return [...this.events];
  }

  clear(): void {
    this.transactions.clear();
    this.events.length = 0;
  }
}

export const exportEventStore = new ExportEventStore();
