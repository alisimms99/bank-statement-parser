import { createHash } from "crypto";
import type { CanonicalTransaction } from "@shared/transactions";

/**
 * Generate a SHA256 hash for a transaction
 * Hash is based on: date + amount + description
 */
export function hashTransaction(tx: CanonicalTransaction): string {
  const amount = tx.debit || tx.credit || 0;
  const hashInput = `${tx.date}|${amount}|${tx.description}`;
  return createHash("sha256").update(hashInput).digest("hex");
}

/**
 * Get existing transaction hashes from the Hashes sheet
 */
export async function getExistingHashes(
  spreadsheetId: string,
  accessToken: string
): Promise<Set<string>> {
  const response = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Hashes!A:A`,
    {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    }
  );

  if (!response.ok) {
    // If the Hashes sheet doesn't exist, return empty set
    if (response.status === 400) {
      return new Set<string>();
    }
    const errorText = await response.text();
    throw new Error(`Failed to fetch existing hashes (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  const hashes = new Set<string>();
  
  if (data.values && Array.isArray(data.values)) {
    // Skip the header row if it exists
    const startIndex = data.values[0]?.[0] === "Hash" ? 1 : 0;
    for (let i = startIndex; i < data.values.length; i++) {
      if (data.values[i]?.[0]) {
        hashes.add(data.values[i][0]);
      }
    }
  }

  return hashes;
}

/**
 * Ensure the Hashes sheet exists and is hidden
 */
export async function ensureHashesSheet(
  spreadsheetId: string,
  accessToken: string
): Promise<number> {
  try {
    // First, get the spreadsheet metadata to check if Hashes sheet exists
    const metadataResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}`,
      {
        method: "GET",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
        },
      }
    );

    if (!metadataResponse.ok) {
      throw new Error("Failed to fetch spreadsheet metadata");
    }

    const metadata = await metadataResponse.json();
    const hashesSheet = metadata.sheets?.find(
      (sheet: any) => sheet.properties.title === "Hashes"
    );

    if (hashesSheet) {
      // Sheet exists, return its ID
      return hashesSheet.properties.sheetId;
    }

    // Create the Hashes sheet
    const createResponse = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          requests: [
            {
              addSheet: {
                properties: {
                  title: "Hashes",
                  hidden: true,
                },
              },
            },
          ],
        }),
      }
    );

    if (!createResponse.ok) {
      const error = await createResponse.json();
      throw new Error(error.error?.message || "Failed to create Hashes sheet");
    }

    const createResult = await createResponse.json();
    const newSheetId = createResult.replies[0].addSheet.properties.sheetId;

    // Add header row to Hashes sheet
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Hashes!A1:append?valueInputOption=RAW`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values: [["Hash"]],
        }),
      }
    );

    return newSheetId;
  } catch (error) {
    console.error("Error ensuring Hashes sheet:", error);
    throw error;
  }
}

/**
 * Append new hashes to the Hashes sheet
 */
export async function appendHashes(
  spreadsheetId: string,
  accessToken: string,
  hashes: string[]
): Promise<void> {
  if (hashes.length === 0) {
    return;
  }

  try {
    const values = hashes.map(hash => [hash]);
    
    const response = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Hashes!A:A:append?valueInputOption=RAW`,
      {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          values,
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error?.message || "Failed to append hashes");
    }
  } catch (error) {
    console.error("Error appending hashes:", error);
    throw error;
  }
}

/**
 * Filter out duplicate transactions based on existing hashes
 * Returns: { uniqueTransactions, duplicateCount }
 */
export function filterDuplicates(
  transactions: CanonicalTransaction[],
  existingHashes: Set<string>
): { uniqueTransactions: CanonicalTransaction[]; duplicateCount: number; newHashes: string[] } {
  const uniqueTransactions: CanonicalTransaction[] = [];
  const newHashes: string[] = [];
  let duplicateCount = 0;

  for (const tx of transactions) {
    const hash = hashTransaction(tx);
    
    if (!existingHashes.has(hash)) {
      uniqueTransactions.push(tx);
      newHashes.push(hash);
      existingHashes.add(hash); // Add to set to catch duplicates within the same batch
    } else {
      duplicateCount++;
    }
  }

  return { uniqueTransactions, duplicateCount, newHashes };
}
