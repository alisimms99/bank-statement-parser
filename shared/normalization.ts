import { CanonicalDocument, CanonicalTransaction } from "./transactions";

export interface DocumentAiMoneyValue {
  amount?: number;
  currencyCode?: string;
}

export interface DocumentAiEntity {
  type?: string;
  mentionText?: string;
  normalizedValue?: {
    text?: string;
    dateValue?: string;
    moneyValue?: DocumentAiMoneyValue;
  };
  properties?: DocumentAiEntity[];
  confidence?: number;
}

export interface DocumentAiNormalizedDocument {
  entities?: DocumentAiEntity[];
  text?: string;
}

export interface LegacyTransactionLike {
  date: string;
  description: string;
  amount: string;
  type?: string;
  directionHint?: "debit" | "credit";
  payee?: string;
  balance?: string | number | null;
  account_id?: string | null;
  source_bank?: string | null;
  statement_period?: { start?: string | null; end?: string | null };
}

export function normalizeLegacyTransactions(legacy: LegacyTransactionLike[], defaultYear?: string | number): CanonicalTransaction[] {
  const results: (CanonicalTransaction | null)[] = legacy.map(item => {
    const description = collapseWhitespace(item.description);
    const payeeRaw = collapseWhitespace(item.payee ?? "") || description;
    const payee: string | null = payeeRaw.length > 0 ? payeeRaw : null;
    const amountParts = normalizeAmount(item.amount, item.directionHint);
    const posted_date = normalizeDateString(item.date, defaultYear);

    if (!amountParts || (!amountParts.debit && !amountParts.credit)) return null;

    return {
      date: posted_date,
      posted_date,
      description,
      payee,
      debit: amountParts.debit,
      credit: amountParts.credit,
      balance: normalizeNumber(item.balance),
      account_id: item.account_id ?? null,
      source_bank: item.source_bank ?? null,
      statement_period: {
        start: normalizeDateString(item.statement_period?.start ?? null, defaultYear),
        end: normalizeDateString(item.statement_period?.end ?? null, defaultYear)
      },
      metadata: { raw_type: item.type ?? null }
    } satisfies CanonicalTransaction;
  });
  
  return results.filter((t): t is CanonicalTransaction => t !== null);
}

/**
 * Detect bank/card issuer from document text, filename, and entities
 */
function detectBankFromContent(
  text: string | undefined, 
  fileName: string | undefined,
  entities: DocumentAiEntity[] | undefined
): string {
  const combined = `${text || ""} ${fileName || ""}`.toLowerCase();
  
  // Check for Dollar Bank specific markers FIRST (before checking transaction content)
  // Dollar Bank has bank_name and bank_address entities that are reliable indicators
  if (entities) {
    const bankNameEntity = entities.find(e => {
      const type = (e.type || "").toLowerCase();
      return type.includes("bank_name") || type.includes("institution_name");
    });
    if (bankNameEntity?.mentionText?.toLowerCase().includes('dollar')) {
      return 'dollar_bank';
    }
    
    // Check bank_address for Dollar Bank locations
    const bankAddress = entities.find(e => {
      const type = (e.type || "").toLowerCase();
      return type.includes("bank_address") || type.includes("address");
    });
    if (bankAddress?.mentionText && (
      bankAddress.mentionText.includes('PENN HILLS') || 
      bankAddress.mentionText.includes('RODI ROAD') ||
      bankAddress.mentionText.includes('DOLLAR BANK')
    )) {
      return 'dollar_bank';
    }
  }
  
  // Check filename patterns (more reliable than content)
  if (/Statement_\d{6}_\d+\.pdf/i.test(fileName || "")) {
    return 'capital_one';
  }
  if (/STATEMENTS,.*-\d+\.pdf/i.test(fileName || "")) {
    return 'citizens';
  }
  if (/^\d{8}-statements-\d+/i.test(fileName || "")) {
    return 'chase';
  }
  
  // Check document text for bank names (but not transaction descriptions)
  // Look for bank name in headers/first part of document, not in transaction descriptions
  const textLower = (text || "").toLowerCase();
  const first500Chars = textLower.substring(0, 500); // Check header area
  
  if (first500Chars.includes('dollar bank') || combined.includes('dollar bank')) {
    return 'dollar_bank';
  }
  if (first500Chars.includes('american express') || first500Chars.includes('amex')) {
    return 'amex';
  }
  if (first500Chars.includes('citizens bank') || first500Chars.includes('citizens')) {
    return 'citizens';
  }
  if (first500Chars.includes('capital one') && !first500Chars.includes('payment')) {
    // Only match Capital One if it's in header, not just in payment descriptions
    return 'capital_one';
  }
  if (first500Chars.includes('chase') && (first500Chars.includes('sapphire') || first500Chars.includes('chase.com'))) {
    return 'chase';
  }
  if (first500Chars.includes('citi') && (first500Chars.includes('custom cash') || first500Chars.includes('double cash') || first500Chars.includes('citicards.com') || first500Chars.includes('thankyou'))) {
    return 'citi';
  }
  if (first500Chars.includes('citibank') || first500Chars.includes('citi cards')) {
    return 'citi';
  }
  // Distinguish Amazon from Lowe's (both Synchrony but different formats)
  // NOTE: `String.includes()` is literal, so patterns like "amazon.*synchrony" must use regex.
  const amazonSynchronyPattern = /amazon[\s\S]*(synchrony|syncb)/i;
  if (
    first500Chars.includes('amazon') &&
    (first500Chars.includes('syf.com') ||
      first500Chars.includes('prime store card') ||
      amazonSynchronyPattern.test(first500Chars))
  ) {
    return 'amazon-synchrony';
  }
  if (first500Chars.includes('lowe') && (first500Chars.includes('pro') || first500Chars.includes('rewards') || first500Chars.includes('lowes.com'))) {
    return 'lowes';
  }
  if (first500Chars.includes('synchrony') || first500Chars.includes('syncb')) {
    return 'synchrony';
  }
  
  return 'unknown';
}

export function normalizeDocumentAITransactions(
  doc: DocumentAiNormalizedDocument,
  documentType: CanonicalDocument["documentType"] = "bank_statement",
  defaultYear?: string | number,
  fileName?: string
): CanonicalTransaction[] {
  const transactions: CanonicalTransaction[] = [];
  const entities = doc.entities ?? [];
  
  // Detect bank/card issuer (pass entities for better detection)
  const bankType = detectBankFromContent(doc.text, fileName, entities);
  const isCreditCard = bankType === 'capital_one' || bankType === 'amex' || bankType === 'chase' || bankType === 'citi' || bankType === 'lowes' || bankType === 'synchrony' || bankType === 'amazon-synchrony';

  // Extract statement year from statement_start_date entity if available
  let statementYear: number | undefined;
  if (typeof defaultYear === 'number') {
    statementYear = defaultYear;
  } else if (typeof defaultYear === 'string') {
    statementYear = parseInt(defaultYear, 10);
  } else {
    // Try to find statement_start_date entity
    const startDateEntity = entities.find(e => {
      const type = (e.type || "").toLowerCase();
      return type.includes("statement_start_date") || type.includes("statement_period");
    });
    if (startDateEntity) {
      const yearMatch = startDateEntity.mentionText?.match(/\d{4}/) || 
                       startDateEntity.normalizedValue?.text?.match(/\d{4}/);
      if (yearMatch) {
        statementYear = parseInt(yearMatch[0], 10);
      }
    }
    // Fallback to current year if not found
    if (!statementYear) {
      statementYear = new Date().getFullYear();
    }
  }

  // Log table_item entities for debugging
  const tableItems = entities.filter(e => {
    const type = (e.type || "").toLowerCase();
    return type.includes("table_item") || type.includes("tableitem");
  });
  
  if (tableItems.length > 0) {
    console.log(`[Normalization] Found ${tableItems.length} table_item entities (bank: ${bankType}, year: ${statementYear})`);
    // Log full structure of table_item entities to debug
    console.log('[Normalization] Table items structure:', JSON.stringify(
      tableItems.slice(0, 3).map(item => ({
        type: item.type,
        mentionText: item.mentionText?.substring(0, 150),
        hasProperties: !!item.properties,
        propertyCount: item.properties?.length ?? 0,
        propertyTypes: item.properties?.map(p => p.type).filter(Boolean),
        properties: item.properties?.map(p => ({
          type: p.type,
          mentionText: p.mentionText?.substring(0, 100),
          hasNormalizedValue: !!p.normalizedValue,
          moneyValue: p.normalizedValue?.moneyValue,
          dateValue: p.normalizedValue?.dateValue,
        })),
        normalizedValue: item.normalizedValue ? {
          text: item.normalizedValue.text,
          hasMoneyValue: !!item.normalizedValue.moneyValue,
          hasDateValue: !!item.normalizedValue.dateValue,
        } : null,
      })),
      null,
      2
    ));
  }

  // Debug: Log all entities before filtering
  console.log(`[Normalization] Processing ${entities.length} entities, checking for transactions...`);
  const transactionEntityTypes = entities
    .filter(e => isTransactionEntity(e, documentType))
    .map(e => e.type);
  console.log(`[Normalization] Found ${transactionEntityTypes.length} transaction entities:`, transactionEntityTypes);

  for (const entity of entities) {
    if (!isTransactionEntity(entity, documentType)) {
      // Debug: Log why entities are being skipped
      const entityType = (entity.type || "").toLowerCase();
      if (entityType.includes("table") || entityType.includes("item")) {
        console.log(`[Normalization] Skipping entity type "${entity.type}" - not recognized as transaction entity`);
      }
      continue;
    }

    const entityType = (entity.type || "").toLowerCase();
    const isTableItem = entityType.includes("table_item") || entityType.includes("tableitem");
    const isLineItem = entityType.includes("line_item") || entityType.includes("lineitem");
    
    // Debug: Log what we're processing
    if (isTableItem) {
      console.log(`[Normalization] Processing table_item entity:`, {
        type: entity.type,
        hasProperties: !!entity.properties,
        propertyCount: entity.properties?.length ?? 0,
        hasMentionText: !!entity.mentionText,
      });
    }

    let date: string | null = null;
    let amountText: string = "";
    let description: string = "";
    let debit = 0;
    let credit = 0;

    // Handle line_item entities (Bank Statement Parser format with properties)
    if (isLineItem && entity.properties && entity.properties.length > 0) {
      // Extract date, amount, and description from line_item properties
      let lineItemDate: string | null = null;
      let lineItemAmount: number | null = null;
      let lineItemDescription: string = "";
      
      for (const prop of entity.properties) {
        const propType = (prop.type || "").toLowerCase();
        if (propType.includes("date") || propType.includes("transaction_date")) {
          lineItemDate = prop.mentionText || prop.normalizedValue?.text || null;
          if (prop.normalizedValue?.dateValue) {
            lineItemDate = prop.normalizedValue.dateValue;
          }
        } else if (propType.includes("amount") || propType.includes("transaction_amount")) {
          if (prop.normalizedValue?.moneyValue?.amount != null) {
            lineItemAmount = prop.normalizedValue.moneyValue.amount;
          } else {
            lineItemAmount = normalizeNumber(prop.mentionText);
          }
        } else if (propType.includes("description") || propType.includes("merchant") || propType.includes("payee")) {
          lineItemDescription = prop.mentionText || prop.normalizedValue?.text || "";
        }
      }
      
      // If we have the main entity mentionText, use it as description fallback
      if (!lineItemDescription && entity.mentionText) {
        lineItemDescription = entity.mentionText;
      }
      
      // Only create transaction if we have required fields
      if (lineItemAmount != null && lineItemDescription) {
        const normalizedDate = normalizeDateString(lineItemDate, statementYear);
        const direction = inferDirectionFromEntity(entity);
        
        // Determine debit/credit based on amount sign and direction
        if (lineItemAmount < 0 || direction === "debit") {
          debit = Math.abs(lineItemAmount);
          credit = 0;
        } else {
          debit = 0;
          credit = Math.abs(lineItemAmount);
        }
        
        transactions.push({
          date: normalizedDate,
          posted_date: normalizedDate,
          description: lineItemDescription.trim(),
          payee: null, // Will be extracted later if needed
          debit,
          credit,
          balance: null,
          account_id: null,
          source_bank: bankType,
          statement_period: {
            start: null,
            end: null,
          },
        });
      }
      continue; // Skip to next entity
    }

    if (isTableItem) {
      // Check if table_item has properties (Bank Statement Parser format: table_item/date, table_item/amount, etc.)
      if (entity.properties && entity.properties.length > 0) {
        console.log(`[Normalization] Processing table_item with ${entity.properties.length} properties`);
        // Extract from properties (Bank Statement Parser format)
        let tableItemDate: string | null = null;
        let tableItemAmount: number | null = null;
        let tableItemDescription: string = "";
        let tableItemBalance: number | null = null;
        
        for (const prop of entity.properties) {
          const propType = (prop.type || "").toLowerCase();
          console.log(`[Normalization] Checking property: type="${prop.type}", mentionText="${prop.mentionText?.substring(0, 50)}"`);
          
          // Date extraction - look for _date suffix, extract mentionText (not the object)
          if (propType.includes("_date") || propType.includes("transaction_date")) {
            tableItemDate = prop.mentionText || prop.normalizedValue?.text || null;
            // Only use dateValue if mentionText is not available
            if (!tableItemDate && prop.normalizedValue?.dateValue) {
              tableItemDate = prop.normalizedValue.dateValue;
            }
            console.log(`[Normalization] Found date property: "${tableItemDate}"`);
          }
          // Amount extraction - look for transaction_deposit or transaction_withdrawal (but not description)
          else if (propType.includes("transaction_deposit") && !propType.includes("description")) {
            // Deposit amount (positive)
            if (prop.normalizedValue?.moneyValue?.amount != null) {
              tableItemAmount = prop.normalizedValue.moneyValue.amount;
              console.log(`[Normalization] Found deposit amount from moneyValue: ${tableItemAmount}`);
            } else {
              // Extract from mentionText like "$334.89"
              const amountStr = prop.mentionText?.replace(/[$,]/g, '') || '0';
              tableItemAmount = parseFloat(amountStr);
              console.log(`[Normalization] Found deposit amount from mentionText: "${prop.mentionText}" -> ${tableItemAmount}`);
            }
          } else if (propType.includes("transaction_withdrawal") && !propType.includes("description") && !propType.includes("date")) {
            // Withdrawal amount (negative)
            if (prop.normalizedValue?.moneyValue?.amount != null) {
              tableItemAmount = -Math.abs(prop.normalizedValue.moneyValue.amount);
              console.log(`[Normalization] Found withdrawal amount from moneyValue: ${tableItemAmount}`);
            } else {
              // Extract from mentionText like "$334.89" and make negative
              const amountStr = prop.mentionText?.replace(/[$,]/g, '') || '0';
              tableItemAmount = -Math.abs(parseFloat(amountStr));
              console.log(`[Normalization] Found withdrawal amount from mentionText: "${prop.mentionText}" -> ${tableItemAmount}`);
            }
          }
          // Legacy support: also check for generic "amount" or "transaction_amount"
          else if ((propType.includes("amount") || propType.includes("transaction_amount")) && !propType.includes("description")) {
            if (prop.normalizedValue?.moneyValue?.amount != null) {
              tableItemAmount = prop.normalizedValue.moneyValue.amount;
              console.log(`[Normalization] Found amount from moneyValue: ${tableItemAmount}`);
            } else {
              tableItemAmount = normalizeNumber(prop.mentionText);
              console.log(`[Normalization] Found amount from mentionText: "${prop.mentionText}" -> ${tableItemAmount}`);
            }
          }
          // Description extraction - look for _description suffix
          else if (propType.includes("_description") || propType.includes("description") || propType.includes("merchant") || propType.includes("payee")) {
            tableItemDescription = prop.mentionText || prop.normalizedValue?.text || "";
            console.log(`[Normalization] Found description property: "${tableItemDescription.substring(0, 50)}"`);
          }
          // Balance extraction
          else if (propType.includes("balance")) {
            if (prop.normalizedValue?.moneyValue?.amount != null) {
              tableItemBalance = prop.normalizedValue.moneyValue.amount;
            } else {
              tableItemBalance = normalizeNumber(prop.mentionText);
            }
          }
        }
        
        // Fallback to entity mentionText if description is missing
        if (!tableItemDescription && entity.mentionText) {
          tableItemDescription = entity.mentionText;
          console.log(`[Normalization] Using entity mentionText as description: "${tableItemDescription.substring(0, 50)}"`);
        }
        
        console.log(`[Normalization] Extracted values: date="${tableItemDate}", amount=${tableItemAmount}, description="${tableItemDescription.substring(0, 50)}"`);
        
        // Only create transaction if we have required fields
        if (tableItemAmount != null && tableItemDescription) {
          const normalizedDate = normalizeDateString(tableItemDate, statementYear);
          
          // ========== DOLLAR BANK FIX ==========
          // For Dollar Bank: ALWAYS apply our custom sign logic instead of trusting Document AI labels
          // Document AI often mislabels POS purchases as "deposits" and ATM withdrawals as wrong column
          if (bankType === 'dollar_bank') {
            const customSign = getDollarBankSign(tableItemDescription);
            // Override the amount with correct sign based on our transaction pattern analysis
            tableItemAmount = customSign * Math.abs(tableItemAmount);
            console.log(`[Normalization] Dollar Bank sign override: "${tableItemDescription.substring(0, 30)}" -> sign=${customSign}, amount=${tableItemAmount}`);
          }
          // ========== END DOLLAR BANK FIX ==========
          
          const direction = inferDirectionFromEntity(entity);
          
          // Determine debit/credit based on amount sign and direction
          // For Dollar Bank, tableItemAmount now has the correct sign from getDollarBankSign
          if (tableItemAmount < 0 || (bankType !== 'dollar_bank' && direction === "debit")) {
            debit = Math.abs(tableItemAmount);
            credit = 0;
          } else {
            debit = 0;
            credit = Math.abs(tableItemAmount);
          }
          
          const transaction = {
            date: normalizedDate,
            posted_date: normalizedDate,
            description: tableItemDescription.trim(),
            payee: null,
            debit,
            credit,
            balance: tableItemBalance,
            account_id: null,
            source_bank: bankType,
            statement_period: {
              start: null,
              end: null,
            },
          };
          
          transactions.push(transaction);
          console.log(`[Normalization] ✅ Created transaction: ${transaction.description.substring(0, 30)} - ${transaction.debit > 0 ? `Debit: $${transaction.debit}` : `Credit: $${transaction.credit}`}`);
        } else {
          console.log(`[Normalization] ❌ Skipping transaction - missing required fields: amount=${tableItemAmount}, description="${tableItemDescription.substring(0, 30)}"`);
        }
        continue; // Skip to bank-specific parsing
      }
      
      // Bank-specific parsing for table_item entities (legacy format with mentionText)
      let parsed: { date: string; amount: string; description: string } | null = null;
      
      if (bankType === 'capital_one') {
        // Capital One format: "Sep 23 ACI*UPMC HEALTH PLANPITTSBURGHPA $176.56"
        // Filter out payment coupon text BEFORE parsing
        if (entity.mentionText && isCapitalOneGarbage(entity.mentionText)) {
          continue; // Skip this entity
        }
        parsed = parseCapitalOneTableItem(entity.mentionText, entity.properties, statementYear, fileName);
      } else if (bankType === 'amex') {
        // Amex format: "08/21/22 AMERICAN EXPRESS TRAVEL SEATTLE WA $500.19"
        // Filter out payment coupon addresses BEFORE parsing (prevents zip codes as amounts)
        if (entity.mentionText && isAmexGarbage(entity.mentionText)) {
          continue; // Skip this entity
        }
        parsed = parseAmexTableItem(entity.mentionText, statementYear);
      } else if (bankType === 'dollar_bank') {
        // Dollar Bank format: "06/01 06/01 KFM247 LTD 1813173920 2,633.00"
        parsed = parseDollarBankTableItem(entity.mentionText, statementYear);
      } else if (bankType === 'chase') {
        // Chase format: "06/25 THE LEVITON LAW FIRM B 844-8435290 IL 1,233.96"
        // Filter out payment coupon text BEFORE parsing
        if (entity.mentionText && isChaseGarbage(entity.mentionText)) {
          continue; // Skip this entity
        }
        parsed = parseChaseTableItem(entity.mentionText, statementYear, fileName);
      } else if (bankType === 'citi') {
        // Citi format: "12/03 CONTRACTING.COM    TORONTO    CAN $7,300.00"
        // Filter out section headers and payment coupon text BEFORE parsing
        if (entity.mentionText && isCitiGarbage(entity.mentionText)) {
          continue; // Skip this entity
        }
        parsed = parseCitiTableItem(entity.mentionText, statementYear, fileName, doc.text);
      } else if (bankType === 'amazon-synchrony') {
        // Amazon/Synchrony format: "09/25 F9342008C00CHGDDA AUTOMATIC PAYMENT - THANK YOU -$290.88"
        // Uses explicit minus sign (NOT parentheses like Lowe's)
        // Filter out section headers and order IDs BEFORE parsing
        if (entity.mentionText && isAmazonSynchronyGarbage(entity.mentionText)) {
          continue; // Skip this entity
        }
        parsed = parseAmazonSynchronyTableItem(entity.mentionText, statementYear, doc.text);
      } else if (bankType === 'lowes' || bankType === 'synchrony') {
        // Lowe's/Synchrony format: "09/06 09/06 75306 STORE 1660 MONROEVILLE PA $273.33"
        // Payments use parentheses: "09/20 09/20 ONLINE PAYMENT THANK YOU ($71.45)"
        // Filter out account info and invoice details BEFORE parsing
        if (entity.mentionText && isLowesGarbage(entity.mentionText)) {
          continue; // Skip this entity
        }
        parsed = parseLowesTableItem(entity.mentionText, statementYear, doc.text);
      } else {
        // Citizens Bank and other formats - data is in mentionText
        parsed = parseTableItemMentionText(entity.mentionText);
      }
      
      if (!parsed || !parsed.amount) {
        // Skip if parsing failed (likely a balance-only row)
        continue;
      }
      
      date = normalizeDateString(parsed.date, statementYear);
      amountText = parsed.amount;
      description = parsed.description;
      
      // Infer direction from description - check for "DBT", "DEBIT", "CREDIT", etc.
      const descUpper = description.toUpperCase();
      const isDebit = descUpper.includes("DBT") || descUpper.includes("DEBIT") || descUpper.includes("WITHDRAWAL") || descUpper.includes("PURCHASE") || descUpper.includes("FEE");
      const isCredit = descUpper.includes("CREDIT") || descUpper.includes("DEPOSIT") || descUpper.includes("PAYROLL") || descUpper.includes("PAYMENT") || descUpper.includes("PYMT") || descUpper.includes("PMT");
      
      // For credit cards: purchases are typically positive (debits), payments are negative (credits)
      // For bank accounts: debits are negative, deposits are positive
      let directionHint: "debit" | "credit" | undefined;
      
      if (isCreditCard) {
        // Credit card logic: positive amounts are usually purchases (debits), negative are payments (credits)
        const amountNum = parseFloat(amountText.replace(/[^0-9.-]/g, ""));
        if (!isNaN(amountNum)) {
          if (amountNum < 0 || descUpper.includes("PAYMENT") || descUpper.includes("CREDIT") || descUpper.includes("PYMT") || descUpper.includes("PMT")) {
            directionHint = "credit"; // Payment reduces balance
          } else {
            directionHint = "debit"; // Purchase increases balance
          }
        } else {
          directionHint = isDebit ? "debit" : isCredit ? "credit" : undefined;
        }
      } else if (bankType === 'dollar_bank') {
        // Dollar Bank: parser already applies correct sign based on transaction type
        // The amount string from parser already has the correct sign (e.g., "-$42.79" or "$1037.71")
        // So we should use the sign from the amount string, not override it with direction hints
        // Parse the amount to get the sign
        const amountNum = parseFloat(amountText.replace(/[^0-9.-]/g, ""));
        if (!isNaN(amountNum)) {
          // If amount is negative, it's a debit; if positive, it's a credit
          // Dollar Bank parser already applies correct sign, so trust it
          if (amountNum < 0) {
            directionHint = "debit";
          } else {
            directionHint = "credit";
          }
        } else {
          // Fallback to description hints if amount parsing fails
          // Credits: KFM247, NSM DBAMR, ADJ, or ODD JOBS (not payments)
          if (/KFM247|NSM DBAMR|^ADJ\s/i.test(description) || 
              (/ODD JOBS/i.test(description) && !/PMT|PAYMENT|AUTOPAY/i.test(descUpper))) {
            directionHint = "credit";
          } else {
            // Everything else is a debit
            directionHint = "debit";
          }
        }
      } else {
        // Bank account logic: use description hints
        directionHint = isDebit ? "debit" : isCredit ? "credit" : undefined;
      }
      
      // Parse amount - use direction hint
      const amountResult = normalizeAmount(amountText, directionHint);
      if (!amountResult || (!amountResult.debit && !amountResult.credit)) {
        continue; // Skip if no valid amount
      }
      debit = amountResult.debit;
      credit = amountResult.credit;
    } else {
      // Standard entity parsing with properties
      const amountEntity = pickEntity(entity, ["amount", "total", "net_amount"]);
      const dateEntity = pickEntity(entity, ["posting_date", "transaction_date", "date"]);
      const balanceEntity = pickEntity(entity, ["balance"]);
      const counterpartyEntity = pickEntity(entity, ["merchant_name", "counterparty", "vendor", "payee"]);

      const amountResult = normalizeAmount(
        amountEntity?.mentionText ?? entity.mentionText ?? "",
        inferDirectionFromEntity(entity, amountEntity)
      );
      
      if (!amountResult || (!amountResult.debit && !amountResult.credit)) {
        continue;
      }
      
      debit = amountResult.debit;
      credit = amountResult.credit;
      date = normalizeDateString(dateEntity?.normalizedValue?.text ?? dateEntity?.mentionText ?? null, defaultYear);
      description = collapseWhitespace(entity.mentionText || counterpartyEntity?.mentionText || "Transaction");
      
      // Use balance from entity if available
      const balance = normalizeNumber(balanceEntity?.mentionText);
      
      transactions.push({
        date,
        posted_date: date,
        description,
        payee: collapseWhitespace(counterpartyEntity?.mentionText || entity.mentionText || "Transaction"),
        debit,
        credit,
        balance,
        account_id: null,
        source_bank: null,
        statement_period: { start: null, end: null },
        metadata: {
          documentai: {
            type: entity.type,
            confidence: entity.confidence,
          },
        },
      });
      continue;
    }

    // For table_item entities, create transaction
    transactions.push({
      date,
      posted_date: date,
      description: collapseWhitespace(description || "Transaction"),
      payee: null, // Extract payee from description if needed later
      debit,
      credit,
      balance: null, // Don't extract balance from table_item rows
      account_id: null,
      source_bank: null,
      statement_period: { start: null, end: null },
      metadata: {
        documentai: {
          type: entity.type,
          confidence: entity.confidence,
        },
      },
    });
  }

  // Final summary log
  console.log(`[Normalization] ✅ Complete: Created ${transactions.length} transactions from ${entities.length} entities`);
  if (transactions.length === 0 && tableItems.length > 0) {
    console.error(`[Normalization] ⚠️ WARNING: Found ${tableItems.length} table_item entities but created 0 transactions!`);
  }
  
  return transactions;
}

export function normalizeAmount(
  rawAmount: string | number,
  directionHint?: "debit" | "credit"
): { debit: number; credit: number } | null {
  const asString = String(rawAmount ?? "");
  let cleanedAmount = asString.replace(/[^0-9.,()\-]/g, "").replace(/,/g, "");
  
  // Handle amounts that start with decimal point (e.g., ".69")
  if (cleanedAmount.startsWith('.')) {
    cleanedAmount = '0' + cleanedAmount;
  }
  
  const negative = /-/.test(cleanedAmount) || /\(.*\)/.test(cleanedAmount);
  const parsed = parseFloat(cleanedAmount.replace(/[()]/g, ""));

  if (Number.isNaN(parsed)) return null;

  const value = Math.abs(parsed);
  const isDebit = directionHint === "debit" || (!directionHint && negative);
  const debit = isDebit ? value : 0;
  const credit = isDebit ? 0 : value;

  return { debit, credit };
}

export function collapseWhitespace(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

export function normalizeDateString(value: string | null | undefined, defaultYear?: string | number): string | null {
  if (!value) return null;
  const trimmed = value.trim();

  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) return trimmed;

  const mdYMatch = trimmed.match(/^(\d{1,2})[\/-](\d{1,2})(?:[\/-](\d{2,4}))?$/);
  if (!mdYMatch) return null;

  const [, m, d, y] = mdYMatch;
  // Use provided year, or parsed year, or current year as last resort
  const year = y 
    ? (y.length === 2 ? `20${y}` : y.padStart(4, "0"))
    : defaultYear 
      ? String(defaultYear).padStart(4, "0")
      : new Date().getFullYear().toString();
  return `${year}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function pickEntity(entity: DocumentAiEntity, types: string[]): DocumentAiEntity | undefined {
  if (!entity.properties) return undefined;
  const lower = types.map(t => t.toLowerCase());
  return entity.properties.find(prop => prop.type && lower.includes(prop.type.toLowerCase()));
}

/**
 * Filter out Chase payment coupon text and other garbage entries
 */
function isChaseGarbage(text: string): boolean {
  const garbagePatterns = [
    /P\.?O\.?\s*Box\s*\d+/i,
    /Carol Stream IL/i,
    /Wilmington.*DE/i,
    /CARDMEMBER SERVICE/i,
    /Payment Due Date/i,
    /New Balance/i,
    /Minimum Payment/i,
    /Account Number/i,
    /Credit Access Line/i,
    /Available Credit/i,
    /Previous Balance/i,
    /TOTAL.*FOR THIS PERIOD/i,
    /Year-to-date totals/i,
    /Annual Percentage Rate/i,
    /Balance Subject To/i,
    /Interest Charges?$/i,
    /ULTIMATE REWARDS/i,
    /Total points/i,
  ];
  return garbagePatterns.some(p => p.test(text));
}

/**
 * Extract year and month from Chase filename
 * Format: 20240710-statements-2073-.pdf → YYYYMMDD = July 2024
 */
export function getYearFromChaseFilename(filename: string | undefined): { year: number; month: number } | null {
  if (!filename) return null;
  // 20240710-statements-2073-.pdf → YYYYMMDD
  const match = filename.match(/^(\d{4})(\d{2})(\d{2})-statements/i);
  if (match) {
    return { year: parseInt(match[1], 10), month: parseInt(match[2], 10) };
  }
  return null;
}

/**
 * Parse Chase table_item format
 * Format: "06/25 THE LEVITON LAW FIRM B 844-8435290 IL 1,233.96" (purchase)
 *         "07/01 ANNUAL MEMBERSHIP FEE 95.00" (fee)
 * Pattern: MM/DD MERCHANT NAME [PHONE] [LOCATION] [STATE] AMOUNT
 * 
 * Sign convention: TRUST Chase - statements already have correct signs
 * - Purchases/Fees/Interest: positive (adds to balance) - "1,233.96"
 * - Payments: negative (reduces balance) - "-500.00"
 */
export function parseChaseTableItem(
  mentionText: string | undefined,
  statementYear?: number,
  fileName?: string
): { date: string; amount: string; description: string } | null {
  if (!mentionText) return null;
  
  // Filter garbage FIRST
  if (isChaseGarbage(mentionText)) {
    return null;
  }
  
  // Flatten newlines
  const text = mentionText.replace(/\n/g, ' ').trim();
  
  // Extract statement year/month from filename if available
  let inferredYear = statementYear;
  const filenameInfo = getYearFromChaseFilename(fileName);
  if (filenameInfo) {
    inferredYear = filenameInfo.year;
  }
  
  // Extract date from start: "06/25" or "07/01" format (MM/DD, no year)
  const dateMatch = text.match(/^(\d{2})\/(\d{2})\s+/);
  if (!dateMatch) return null;
  
  const month = parseInt(dateMatch[1], 10);
  const day = parseInt(dateMatch[2], 10);
  const year = inferredYear || new Date().getFullYear();
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Extract amount from end - NO dollar sign, just number with optional comma
  // Negative amounts have minus: -500.00
  const amountMatch = text.match(/(-?[\d,]+\.\d{2})$/);
  if (!amountMatch) return null;
  
  // Parse amount - TRUST the sign (Chase already has correct signs)
  let amount = parseFloat(amountMatch[1].replace(/,/g, ''));
  if (isNaN(amount)) return null;
  
  // Description is between date and amount
  let description = text
    .replace(/^(\d{2}\/\d{2})\s+/, '')  // Remove date
    .replace(/(-?[\d,]+\.\d{2})$/, '')   // Remove amount
    .trim();
  
  if (!description) return null;
  
  // Format amount as string (keep sign as-is - Chase statements are already correct)
  const amountString = amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
  
  return {
    date,
    amount: amountString,
    description,
  };
}

/**
 * Filter out Citi payment coupon text, section headers, and other garbage entries
 */
export function isCitiGarbage(text: string): boolean {
  const garbagePatterns = [
    /^Standard Purchases$/i,
    /^Balance Transfer-Offer/i,
    /^Payments, Credits and Adjustments$/i,
    /^Fees charged$/i,
    /^Interest charged$/i,
    /^Total.*charged/i,
    /P\.?O\.?\s*Box\s*\d+/i,
    /Sioux Falls.*SD/i,
    /Philadelphia PA/i,
    /Louisville.*KY/i,
    /CITI CARDS/i,
    /Payment due date/i,
    /New balance/i,
    /Minimum payment/i,
    /Account number ending/i,
    /Credit Limit/i,
    /Available credit/i,
    /Previous balance/i,
    /Interest charge calculation/i,
    /Annual.*Percentage.*Rate/i,
    /Balance subject to interest/i,
    /ThankYou.*Points/i,
    /Member ID:/i,
    /How You (Earn|Redeem)/i,
    /Billing Period:/i,
    /www\.citicards\.com/i,
    /Customer Service/i,
    /Days in billing cycle/i,
    /^\d{4} totals year-to-date$/i,
  ];
  return garbagePatterns.some(p => p.test(text));
}

/**
 * Extract billing period from Citi statement text
 * Format: "Billing Period: 12/03/24-01/01/25"
 * Returns: { startMonth, startYear, endMonth, endYear }
 */
export function getCitiBillingPeriod(text: string | undefined): { startMonth: number; startYear: number; endMonth: number; endYear: number } | null {
  if (!text) return null;
  // Format: "Billing Period: 12/03/24-01/01/25"
  const match = text.match(/Billing Period:\s*(\d{2})\/(\d{2})\/(\d{2})-(\d{2})\/(\d{2})\/(\d{2})/i);
  if (match) {
    const startMonth = parseInt(match[1], 10);
    const startDay = parseInt(match[2], 10);
    const startYear = 2000 + parseInt(match[3], 10);
    const endMonth = parseInt(match[4], 10);
    const endDay = parseInt(match[5], 10);
    const endYear = 2000 + parseInt(match[6], 10);
    return { startMonth, startYear, endMonth, endYear };
  }
  return null;
}

/**
 * Infer transaction year from billing period
 * Handles year boundary correctly (e.g., Dec 2024 - Jan 2025)
 */
export function getCitiTransactionYear(
  transMonth: number,
  billingPeriod: { startMonth: number; startYear: number; endMonth: number; endYear: number } | null
): number | undefined {
  if (!billingPeriod) return undefined;
  
  // If billing period spans same year
  if (billingPeriod.startYear === billingPeriod.endYear) {
    return billingPeriod.startYear;
  }
  
  // If billing period spans year boundary (e.g., Dec 2024 - Jan 2025)
  // Transactions in start month or months before end month use start year
  // Transactions in end month use end year
  if (transMonth === billingPeriod.endMonth) {
    return billingPeriod.endYear;
  }
  if (transMonth >= billingPeriod.startMonth || transMonth < billingPeriod.endMonth) {
    return billingPeriod.startYear;
  }
  
  return billingPeriod.startYear;
}

/**
 * Parse Citi table_item format
 * Format: "12/03 CONTRACTING.COM    TORONTO    CAN $7,300.00" (purchase)
 *         "12/05 PAYMENT RECEIVED - THANK YOU -$100.00" (payment)
 *         "12/10 ANNUAL FEE $128.25" (fee)
 * Pattern: MM/DD MERCHANT [CITY] [COUNTRY] [-]$AMOUNT
 * 
 * Sign convention: TRUST Citi - statements already have correct signs
 * - Purchases/Fees/Interest: positive (adds to balance) - "$7,300.00"
 * - Payments/Credits: negative (reduces balance) - "-$100.00"
 */
export function parseCitiTableItem(
  mentionText: string | undefined,
  statementYear?: number,
  fileName?: string,
  documentText?: string
): { date: string; amount: string; description: string } | null {
  if (!mentionText) return null;
  
  // Filter garbage FIRST (section headers, payment coupon text)
  if (isCitiGarbage(mentionText)) {
    return null;
  }
  
  // Flatten newlines
  const text = mentionText.replace(/\n/g, ' ').trim();
  
  // Extract billing period from document text for year inference
  const billingPeriod = getCitiBillingPeriod(documentText);
  
  // Extract date from start: "12/03" or "01/01" format (MM/DD, no year)
  const dateMatch = text.match(/^(\d{2})\/(\d{2})\s+/);
  if (!dateMatch) return null;
  
  const month = parseInt(dateMatch[1], 10);
  const day = parseInt(dateMatch[2], 10);
  
  // Infer year from billing period or use provided statementYear
  let year: number;
  if (billingPeriod) {
    const inferredYear = getCitiTransactionYear(month, billingPeriod);
    year = inferredYear || statementYear || new Date().getFullYear();
  } else {
    year = statementYear || new Date().getFullYear();
  }
  
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Extract amount from end: "-$100.00" or "$7,300.00"
  const amountMatch = text.match(/(-?\$[\d,]+\.\d{2})$/);
  if (!amountMatch) return null;
  
  // Parse amount - TRUST the sign (Citi already has correct signs)
  let amountStr = amountMatch[1].replace(/[$,]/g, '');
  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return null;
  
  // Description is between date and amount
  let description = text
    .replace(/^(\d{2}\/\d{2})\s+/, '')  // Remove date
    .replace(/(-?\$[\d,]+\.\d{2})$/, '')  // Remove amount
    .trim();
  
  if (!description) return null;
  
  // Format amount as string (keep sign as-is - Citi statements are already correct)
  const amountString = amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
  
  return {
    date,
    amount: amountString,
    description,
  };
}

/**
 * Filter out Lowe's/Synchrony account info, invoice details, and other garbage entries
 */
export function isLowesGarbage(text: string): boolean {
  const garbagePatterns = [
    /P\.?O\.?\s*Box\s*\d+/i,
    /DALLAS.*TX/i,
    /Philadelphia.*PA.*19176/i,
    /LOWES BUSINESS ACCT/i,
    /SYNCB|Synchrony/i,
    /Payment Due Date/i,
    /New Balance/i,
    /Total Minimum Payment/i,
    /Account Number/i,
    /Credit Limit/i,
    /Available Credit/i,
    /Previous Balance/i,
    /Statement Closing Date/i,
    /Promotional Purchase Summary/i,
    /No Interest With Payment/i,
    /Interest Charge Calculation/i,
    /Annual Percentage Rate/i,
    /Balance Subject/i,
    /Type of Balance/i,
    /Regular Purchases/i,
    /SIMMS INC/i,  // Account holder name in invoices
    /ACCOUNT\s*#/i,
    /INVOICE\s*#/i,
    /S\.K\.U/i,
    /DESCRIPTION\s+QUANTITY/i,
    /SUB\s+\$|TAX\s+\$|TOTAL INVOICE/i,
    /CREDITS TOTAL/i,
    /BALANCE DUE/i,
    /MyLowe.*Pro.*Rewards/i,
    /Important.*Changes.*Terms/i,
  ];
  return garbagePatterns.some(p => p.test(text));
}

/**
 * Extract year from Lowe's/Synchrony statement closing date
 * Format: "Statement Closing Date: 10/02/2025"
 */
export function getYearFromLowesStatement(text: string | undefined): number | null {
  if (!text) return null;
  // Statement Closing Date 10/02/2025
  const match = text.match(/Statement Closing Date\s*(\d{2})\/(\d{2})\/(\d{4})/i);
  if (match) {
    return parseInt(match[3], 10);
  }
  return null;
}

/**
 * Parse Lowe's/Synchrony table_item format
 * Format: "09/06 09/06 75306 STORE 1660 MONROEVILLE PA $273.33" (purchase)
 *         "09/20 09/20 ONLINE PAYMENT THANK YOU ($71.45)" (payment)
 * Pattern: MM/DD MM/DD [INVOICE#] DESCRIPTION ($)AMOUNT
 * 
 * Sign convention: UNIQUE - parentheses = negative (accounting style)
 * - Purchases: positive with $ sign - "$273.33"
 * - Payments/Credits: negative with parentheses - "($71.45)"
 */
export function parseLowesTableItem(
  mentionText: string | undefined,
  statementYear?: number,
  documentText?: string
): { date: string; amount: string; description: string } | null {
  if (!mentionText) return null;
  
  // Filter garbage FIRST (account info, invoice details, payment coupon text)
  if (isLowesGarbage(mentionText)) {
    return null;
  }
  
  // Flatten newlines
  const text = mentionText.replace(/\n/g, ' ').trim();
  
  // Extract year from statement closing date if available
  let inferredYear = statementYear;
  const statementYearFromText = getYearFromLowesStatement(documentText);
  if (statementYearFromText) {
    inferredYear = statementYearFromText;
  }
  
  // Extract date from start: "09/06" format (MM/DD, no year)
  // Lowe's shows both tran date and post date - keep tran date (first one)
  const dateMatch = text.match(/^(\d{2})\/(\d{2})\s+/);
  if (!dateMatch) return null;
  
  const month = parseInt(dateMatch[1], 10);
  const day = parseInt(dateMatch[2], 10);
  const year = inferredYear || new Date().getFullYear();
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Extract amount - KEY: parentheses = negative (accounting style)
  // Matches: $273.33 or ($71.45)
  const amountMatch = text.match(/(\(?\$[\d,]+\.\d{2}\)?)$/);
  if (!amountMatch) return null;
  
  let amountStr = amountMatch[1];
  const isNegative = amountStr.startsWith('(') && amountStr.endsWith(')');
  
  // Remove parentheses and $ sign
  amountStr = amountStr.replace(/[()$,]/g, '');
  let amount = parseFloat(amountStr);
  if (isNaN(amount)) return null;
  
  if (isNegative) {
    amount = -amount;
  }
  
  // Description is between dates/invoice and amount
  let description = text
    .replace(/^(\d{2}\/\d{2})\s+/, '')  // Remove tran date
    .replace(/^(\d{2}\/\d{2})\s+/, '')  // Remove post date
    .replace(/^\d+\s+/, '')              // Remove invoice number (if present)
    .replace(/(\(?\$[\d,]+\.\d{2}\)?)$/, '')  // Remove amount
    .trim();
  
  if (!description) return null;
  
  // Format amount as string (keep sign as-is - Lowe's statements use accounting style)
  const amountString = amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
  
  return {
    date,
    amount: amountString,
    description,
  };
}

/**
 * Filter out Amazon/Synchrony section headers, order IDs, and other garbage entries
 */
export function isAmazonSynchronyGarbage(text: string): boolean {
  const garbagePatterns = [
    /P\.?O\.?\s*Box\s*\d+/i,
    /PHILADELPHIA.*PA.*19176/i,
    /SYNCHRONY BANK/i,
    /Payment Due Date/i,
    /New Balance/i,
    /Total Minimum Payment/i,
    /Account Number/i,
    /Credit Limit/i,
    /Available Credit/i,
    /Previous Balance/i,
    /Rewards (Detail|Summary|Earned)/i,
    /Account Balance Summary/i,
    /Promotional Purchase Summary/i,
    /Interest Charge Calculation/i,
    /Annual Percentage Rate/i,
    /Balance Subject/i,
    /Type of Balance/i,
    /Billing Cycle from/i,
    /Year-to-Date/i,
    /Cardholder News/i,
    /Important Changes/i,
    /amazon\.syf\.com/i,
    /^\s*Payments\s*-?\$[\d,]+\.\d{2}\s*$/i,  // Section header with total
    /^\s*Other Credits\s*-?\$[\d,]+\.\d{2}\s*$/i,
    /^\s*Purchases and Other Debits\s*\$[\d,]+\.\d{2}\s*$/i,
    /^[A-Za-z0-9]{12}$/,  // Order IDs like "CUKvSAYETXSK" (standalone)
  ];
  return garbagePatterns.some(p => p.test(text));
}

/**
 * Extract year from Amazon/Synchrony statement
 * Format: "30 Day Billing Cycle from 09/03/2025 to 10/02/2025"
 *         or "New Balance as of 10/02/2025"
 */
export function getYearFromAmazonSynchrony(text: string | undefined): number | null {
  if (!text) return null;
  // Match any date in MM/DD/YYYY format
  const match = text.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (match) {
    return parseInt(match[3], 10);
  }
  return null;
}

/**
 * Parse Amazon/Synchrony table_item format
 * Format: "09/25 F9342008C00CHGDDA AUTOMATIC PAYMENT - THANK YOU -$290.88" (payment)
 *         "09/04 P9342007REHM6B7Y0 AMAZON RETAIL SEATTLE WA $37.57" (purchase)
 *         "09/09 P9342007WEHMB5QK9 AMAZON MARKETPLACE SEATTLE WA -$16.94" (credit)
 * Pattern: MM/DD REFERENCE# DESCRIPTION [LOCATION] [-]$AMOUNT
 * 
 * Sign convention: Explicit minus sign (NOT parentheses like Lowe's)
 * - Payments/Credits: negative with explicit minus - "-$290.88"
 * - Purchases/Interest: positive - "$37.57"
 */
export function parseAmazonSynchronyTableItem(
  mentionText: string | undefined,
  statementYear?: number,
  documentText?: string
): { date: string; amount: string; description: string } | null {
  if (!mentionText) return null;
  
  // Filter garbage FIRST (section headers, order IDs, payment coupon text)
  if (isAmazonSynchronyGarbage(mentionText)) {
    return null;
  }
  
  // Flatten newlines
  const text = mentionText.replace(/\n/g, ' ').trim();
  
  // Extract year from billing cycle or statement date if available
  let inferredYear = statementYear;
  const statementYearFromText = getYearFromAmazonSynchrony(documentText);
  if (statementYearFromText) {
    inferredYear = statementYearFromText;
  }
  
  // Extract date from start: "09/25" format (MM/DD, no year)
  const dateMatch = text.match(/^(\d{2})\/(\d{2})\s+/);
  if (!dateMatch) return null;
  
  const month = parseInt(dateMatch[1], 10);
  const day = parseInt(dateMatch[2], 10);
  const year = inferredYear || new Date().getFullYear();
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Extract amount - explicit minus sign (NOT parentheses like Lowe's)
  // Matches: $37.57 or -$290.88
  const amountMatch = text.match(/(-?\$[\d,]+\.\d{2})$/);
  if (!amountMatch) return null;
  
  let amountStr = amountMatch[1].replace(/[$,]/g, '');
  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return null;
  
  // Description is between reference# and amount
  let description = text
    .replace(/^(\d{2}\/\d{2})\s+/, '')           // Remove date
    .replace(/^[A-Z0-9]{16,}\s+/, '')            // Remove reference number (16+ chars)
    .replace(/(-?\$[\d,]+\.\d{2})$/, '')         // Remove amount
    .trim();
  
  // Clean up multi-line product descriptions - keep just merchant name
  // Product descriptions appear after merchant name with extra spaces
  // Example: "AMAZON RETAIL SEATTLE WA    BYDAVLbNIXEj    GoodSense Coated..."
  // Keep only the first part (merchant + location)
  description = description.split(/\s{2,}/)[0] || description;
  
  // Filter out standalone order IDs that might have slipped through
  if (/^[A-Za-z0-9]{12}$/.test(description)) {
    return null;
  }
  
  if (!description) return null;
  
  // Format amount as string (keep sign as-is - Amazon uses explicit minus)
  const amountString = amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
  
  return {
    date,
    amount: amountString,
    description,
  };
}

/**
 * Filter out Capital One payment coupon text and other garbage entries
 */
export function isCapitalOneGarbage(text: string): boolean {
  const garbagePatterns = [
    /P\.?O\.?\s*Box\s*\d+/i,
    /Charlotte NC 28272/i,
    /Salt Lake City/i,
    /Payment Due Date/i,
    /New Balance/i,
    /Minimum Payment/i,
    /Account ending in/i,
    /Amount Enclosed/i,
    /Customer Service/i,
    /Total.*for This Period/i,
    /Interest Charge Calculation/i,
  ];
  return garbagePatterns.some(p => p.test(text));
}

/**
 * Extract year and month from Capital One filename
 * Format: Statement_MMYYYY_XXXX.pdf → Statement_102025_9163.pdf = October 2025
 */
export function getYearFromCapitalOneFilename(filename: string | undefined): { year: number; month: number } | null {
  if (!filename) return null;
  // Statement_MMYYYY_XXXX.pdf → Statement_102025_9163.pdf
  const match = filename.match(/Statement_(\d{2})(\d{4})_\d+\.pdf/i);
  if (match) {
    return { month: parseInt(match[1], 10), year: parseInt(match[2], 10) };
  }
  return null;
}

/**
 * Parse Capital One table_item format
 * Format: "Sep 23 ACI*UPMC HEALTH PLANPITTSBURGHPA $176.56" (purchase)
 *         "Sep 29 CAPITAL ONE ONLINE PYMT - $1,000.00" (payment)
 *         "Oct 1 CREDIT-CASH BACK REWARD - $5.01" (credit)
 *         "Jun 13 CAPITAL ONE ONLINE PYMTAuthDate 13-Jun - $38.52" (payment with AuthDate)
 * Pattern: MMM DD [MMM DD] DESCRIPTION [-]$AMOUNT
 * 
 * Sign convention: TRUST Capital One - statements already have correct signs
 * - Payments/Credits: negative (reduces balance) - "- $1,000.00"
 * - Purchases/Fees/Interest: positive (adds to balance) - "$176.56"
 */
export function parseCapitalOneTableItem(
  mentionText: string | undefined,
  properties: DocumentAiEntity[] | undefined,
  statementYear?: number,
  fileName?: string
): { date: string; amount: string; description: string } | null {
  if (!mentionText) return null;
  
  // Filter garbage FIRST
  if (isCapitalOneGarbage(mentionText)) {
    return null;
  }
  
  // Flatten newlines
  const text = mentionText.replace(/\n/g, ' ').trim();
  
  // Extract statement month/year from filename if available
  let statementMonth: number | undefined;
  let inferredYear = statementYear;
  const filenameInfo = getYearFromCapitalOneFilename(fileName);
  if (filenameInfo) {
    statementMonth = filenameInfo.month;
    inferredYear = filenameInfo.year;
  }
  
  // Remove duplicate dates at start (e.g., "Sep 23 Sep 24" → "Sep 23")
  // Capital One shows both trans date and post date - keep trans date
  const cleanedText = text.replace(/^((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s*)+/, (match) => {
    // Keep only the first date (trans date)
    const firstDate = match.match(/(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i);
    return firstDate ? firstDate[0] + ' ' : '';
  });
  
  // Extract date from start: "Sep 23" or "Jun 4" format (MMM DD, no year)
  const dateMatch = cleanedText.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+/i);
  if (!dateMatch) return null;
  
  const monthName = dateMatch[1];
  const day = parseInt(dateMatch[2], 10);
  
  // Convert month name to number
  const monthMap: Record<string, number> = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
    jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12
  };
  const month = monthMap[monthName.toLowerCase()];
  if (!month) return null;
  
  // Year inference (Capital One): some early-year statements (Jan–Mar) can include
  // late-year transactions (Oct–Dec) from the prior year. Only roll back the year
  // for that specific wraparound case.
  let year = inferredYear || new Date().getFullYear();
  if (statementMonth !== undefined) {
    const isEarlyYearStatement = statementMonth <= 3; // Jan–Mar
    const isLateYearTransaction = month >= 10; // Oct–Dec
    if (isEarlyYearStatement && isLateYearTransaction) year -= 1;
  }
  
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Extract amount from end: "- $1,000.00" or "$176.56"
  // Capital One uses space-dash-space for negatives: "- $1,000.00"
  const amountMatch = cleanedText.match(/(-\s*)?\$\s*([\d,]+\.\d{2})$/);
  if (!amountMatch) return null;
  
  // Parse amount - TRUST the sign (Capital One already has correct signs)
  const isNegative = !!amountMatch[1]; // Has "- " prefix
  let amount = parseFloat(amountMatch[2].replace(/,/g, ''));
  if (isNegative) {
    amount = -amount;
  }
  
  // Description is between date(s) and amount
  let description = cleanedText
    .replace(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+/i, '')  // Remove trans date
    .replace(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+/i, '')  // Remove post date if present
    .replace(/(-\s*)?\$\s*[\d,]+\.\d{2}$/, '')  // Remove amount
    .replace(/AuthDate\s*\d{1,2}-[A-Za-z]+/i, '')  // Remove AuthDate suffix (e.g., "AuthDate 13-Jun")
    .trim();
  
  if (!description) return null;
  
  // Format amount as string (keep sign as-is - Capital One statements are already correct)
  const amountString = amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
  
  return {
    date,
    amount: amountString,
    description,
  };
}

/**
 * Filter out Amex payment coupon addresses and other garbage entries
 * These are the source of zip codes being parsed as amounts (e.g., -$603M)
 */
export function isAmexGarbage(text: string): boolean {
  const garbagePatterns = [
    /PO BOX \d+/i,
    /CAROL STREAM/i,
    /NEWARK NJ/i,
    /EL PASO.*TX/i,
    /P\.O\. BOX/i,
    /79998-1535/,  // Amex PO Box zip
    /60197-6031/,  // Carol Stream zip
    /07101-1270/,  // Newark zip
    /Account Ending/i,
    /Payment Due Date/i,
    /New Balance/i,
    /Minimum Payment/i,
  ];
  return garbagePatterns.some(p => p.test(text));
}

/**
 * Parse Amex table_item format
 * Format: "08/21/22 AMERICAN EXPRESS TRAVEL SEATTLE WA $500.19" (charge)
 *         "09/06/22* AUTOPAY PAYMENT RECEIVED - THANK YOU -$2,000.00" (payment)
 *         "08/22/22 INTUIT QUICKBOOKS 800-446-8848 CA -$5.54" (credit/refund)
 * Pattern: MM/DD/YY[*] DESCRIPTION [LOCATION] [STATE] [-]$AMOUNT
 * 
 * Sign convention: TRUST Amex - statements already have correct signs
 * - Payments/Credits: negative (reduces what you owe)
 * - Purchases/Fees/Interest: positive (adds to what you owe)
 */
export function parseAmexTableItem(
  mentionText: string | undefined,
  statementYear?: number
): { date: string; amount: string; description: string } | null {
  if (!mentionText) return null;
  
  // Filter garbage FIRST - prevents zip codes from being parsed as amounts
  if (isAmexGarbage(mentionText)) {
    return null;
  }
  
  // Flatten newlines to spaces
  const text = mentionText.replace(/\n/g, ' ').trim();
  
  // Extract date from start: MM/DD/YY with optional *
  const dateMatch = text.match(/^(\d{2})\/(\d{2})\/(\d{2})\*?\s+/);
  if (!dateMatch) {
    // Try truncated date: MM/DD/ (no year)
    const truncatedMatch = text.match(/^(\d{2})\/(\d{2})\/\s+/);
    if (truncatedMatch) {
      const month = parseInt(truncatedMatch[1], 10);
      const day = parseInt(truncatedMatch[2], 10);
      const year = statementYear || new Date().getFullYear();
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      
      // Extract amount from end
      const amountMatch = text.match(/(-?\$[\d,]+\.\d{2})$/);
      if (!amountMatch) return null;
      
      // Parse amount - TRUST the sign (Amex already has correct signs)
      let amountStr = amountMatch[1].replace(/[$,]/g, '');
      const amount = parseFloat(amountStr);
      if (isNaN(amount)) return null;
      
      // Description is between date and amount
      let description = text
        .replace(/^(\d{2}\/\d{2}\/\s+)/, '')  // Remove date
        .replace(/(-?\$[\d,]+\.\d{2})$/, '')  // Remove amount
        .trim();
      
      if (!description) return null;
      
      // Format amount as string (keep sign as-is)
      const amountString = amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
      
      return {
        date,
        amount: amountString,
        description,
      };
    }
    return null; // No date found
  }
  
  const month = parseInt(dateMatch[1], 10);
  const day = parseInt(dateMatch[2], 10);
  const year = 2000 + parseInt(dateMatch[3], 10); // "22" -> 2022
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Extract amount from end: -$1,000.00 or $500.19
  const amountMatch = text.match(/(-?\$[\d,]+\.\d{2})$/);
  if (!amountMatch) return null;
  
  // Parse amount - TRUST the sign (Amex already has correct signs)
  let amountStr = amountMatch[1].replace(/[$,]/g, '');
  const amount = parseFloat(amountStr);
  if (isNaN(amount)) return null;
  
  // Description is between date and amount
  let description = text
    .replace(/^(\d{2}\/\d{2}\/\d{2}\*?\s+)/, '')  // Remove date
    .replace(/(-?\$[\d,]+\.\d{2})$/, '')          // Remove amount
    .trim();
  
  if (!description) return null;
  
  // Format amount as string (keep sign as-is - Amex statements are already correct)
  const amountString = amount < 0 ? `-$${Math.abs(amount).toFixed(2)}` : `$${amount.toFixed(2)}`;
  
  return {
    date,
    amount: amountString,
    description,
  };
}

/**
 * Determine sign for Dollar Bank transactions based on description
 * Returns: 1 for credits (positive/deposits), -1 for debits (negative/withdrawals)
 * 
 * Key insight: Dollar Bank statements show DEBITS (money out) and CREDITS (money in)
 * We determine which based on transaction description patterns.
 * 
 * DEBITS (money OUT, negative):
 *   - POS purchases (POS SUNOCO, POS FEDEX, etc.)
 *   - ATM withdrawals (ATM DB - PENN HILLS)
 *   - ACH payments (CAPITAL ONE PMT, AMEX EPAYMENT, CHASE AUTOPAY)
 *   - Fees (MONTHLY SERVICE FEE, OVERDRAFT FEE)
 *   - Checks (CHECKS CLEARED)
 *   - Online payments (ONLINE PMT)
 *   - Transfers out (PAYPAL INST XFER when paying someone)
 * 
 * CREDITS (money IN, positive):
 *   - Business income deposits (KFM247 LTD, ACH deposits with ODD JOBS)
 *   - Payroll/direct deposits (PAYROLL, EDI PYMNTS)
 *   - Venmo payments received (VENMO...PAYMENT...ODD JOBS)
 *   - Bank adjustments (ADJ)
 *   - Deposits (DEPOSIT)
 */
export function getDollarBankSign(description: string): number {
  const descUpper = description.toUpperCase();
  
  // ===== DEBITS (money OUT) - Check these patterns FIRST =====
  
  // POS purchases are ALWAYS debits
  if (/^POS\s/i.test(description)) return -1;
  
  // ATM withdrawals are ALWAYS debits
  if (/^ATM\s/i.test(description) || /ATM DB\s*-/i.test(description)) return -1;
  
  // Overdraft fees are debits
  if (/OVERDRAFT FEE/i.test(description)) return -1;
  
  // Monthly service fees are debits
  if (/MONTHLY SERVICE FEE/i.test(description)) return -1;
  
  // Credit card payments are debits (money going OUT to pay cards)
  if (/CAPITAL ONE.*PMT|CAPITAL ONE.*PAYMENT/i.test(description)) return -1;
  if (/AMEX.*EPAYMENT|AMEX.*PAYMENT/i.test(description)) return -1;
  if (/CHASE.*AUTOPAY|CHASE.*PAYMENT/i.test(description)) return -1;
  if (/UPGRADE.*PAYMENT/i.test(description)) return -1;
  if (/CITI.*PAYMENT|CITI.*PMT/i.test(description)) return -1;
  
  // Online payments are debits
  if (/ONLINE PMT|ONLINE PAYMENT/i.test(description)) return -1;
  
  // ACH debits (payments to vendors/services)
  if (/ACH.*DEBIT/i.test(description)) return -1;
  
  // Checks cleared are debits
  if (/CHECKS? CLEARED/i.test(description)) return -1;
  
  // PayPal instant transfers OUT are debits (unless receiving payment)
  if (/PAYPAL.*INST XFER/i.test(description) && !/ODD JOBS/i.test(description)) return -1;
  
  // Insurance payments are debits
  if (/ACUITY.*INS/i.test(description)) return -1;
  
  // Tax payments are debits
  if (/IRS.*USATAXPYMT/i.test(description)) return -1;
  
  // Springwise payments TO the business are credits, but payments FROM are debits
  if (/SPRINGWISE/i.test(description) && !/ODD JOBS/i.test(description)) return -1;
  
  // ===== CREDITS (money IN) =====
  
  // KFM247 is business income (deposits from property management)
  if (/KFM247/i.test(description)) return 1;
  
  // NSM DBAMR is mortgage/deposit related
  if (/NSM DBAMR/i.test(description)) return 1;
  
  // Bank adjustments are typically credits (refunds, corrections)
  if (/^ADJ\s/i.test(description)) return 1;
  
  // Deposits are credits
  if (/\bDEPOSIT\b/i.test(description)) return 1;
  
  // Payroll/direct deposit is credit
  if (/PAYROLL|EDI PYMNTS/i.test(description)) return 1;
  
  // Venmo payments TO ODD JOBS are credits (business income)
  if (/VENMO/i.test(description) && /ODD JOBS/i.test(description)) return 1;
  
  // Springwise payments TO ODD JOBS are credits (business income)
  if (/SPRINGWISE/i.test(description) && /ODD JOBS/i.test(description)) return 1;
  
  // Generic ODD JOBS mentions that aren't payments OUT are credits (business income)
  // But NOT if it's a payment (PMT, PAYMENT, AUTOPAY)
  if (/ODD JOBS/i.test(description) && !/PMT|PAYMENT|AUTOPAY|EPAYMENT/i.test(descUpper)) {
    return 1;
  }
  
  // ACH credits are deposits
  if (/ACH.*CREDIT/i.test(description)) return 1;
  
  // ===== DEFAULT: Debit (money OUT) =====
  // If we can't determine the type, assume it's a debit (safer for expense tracking)
  console.log(`[DollarBank] Unknown transaction type, defaulting to DEBIT: "${description.substring(0, 50)}"`);
  return -1;
}

/**
 * Parse Dollar Bank table_item format
 * 
 * Dollar Bank checking statements have TWO amount columns: DEBIT (withdrawals) and CREDIT (deposits)
 * The format varies:
 *   - Single date: "06/01 MONTHLY SERVICE FEE 2.00"
 *   - Double date: "06/01 06/01 KFM247 LTD 1813173920 2,633.00"
 *   - Multi-line: "03/01 VENMO 3264681992\nPAYMENT 1025529988381 ODD JOBS 195.00"
 *   - Card suffix: "04/05 POS SUNOCO 07303589 9099 5.30" (9099 is card last 4)
 * 
 * Amount is at the END, NO dollar sign, just number with optional comma
 * The 4-digit card number (9099) appears before amounts for card transactions
 */
export function parseDollarBankTableItem(
  mentionText: string | undefined,
  statementYear?: number
): { date: string; amount: string; description: string } | null {
  if (!mentionText) return null;
  
  // Filter out branch addresses and phone numbers BEFORE parsing
  // Must run at the very start to prevent parsing garbage entries
  if (/PENN HILLS OFFICE|218 RODI ROAD|\(412\) 244-8589|MCKENZIE DR.*15235/i.test(mentionText)) {
    return null;
  }
  
  // Filter out header rows and summary lines
  if (/^LEDGER BALANCE|^AVAILABLE BALANCE|^DAILY BALANCE|^DATE\s+DESCRIPTION/i.test(mentionText)) {
    return null;
  }
  
  // Flatten newlines to single line
  const text = mentionText.replace(/\n/g, ' ').trim();
  
  // Extract date from start: MM/DD or MM/DD MM/DD (duplicated posting/transaction date)
  const dateMatch = text.match(/^(\d{2})\/(\d{2})(?:\s+\d{2}\/\d{2})?\s+/);
  if (!dateMatch) return null;
  
  const month = parseInt(dateMatch[1], 10);
  const day = parseInt(dateMatch[2], 10);
  const year = statementYear || new Date().getFullYear();
  const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  
  // Remove date(s) from start to get remainder
  let remainder = text.replace(/^(\d{2}\/\d{2}\s*)+/, '').trim();
  
  // Remove phone number patterns that could interfere with amount extraction
  const phonePatterns = [
    /\(\d{3}\)\s*\d{3}-\d{4}/g,           // (412) 244-8589
    /\d{3}-\d{3}-\d{4}/g,                 // 412-244-8589
    /\d{3}\.\d{3}\.\d{4}/g,               // 412.244.8589
  ];
  
  let cleanedRemainder = remainder;
  for (const pattern of phonePatterns) {
    cleanedRemainder = cleanedRemainder.replace(pattern, ' ');
  }
  
  // Extract amount from end - NO dollar sign, just number with optional comma
  // Handles: "2,633.00", "195.00", "5.30", ".69"
  // The card number (4 digits like 9099) appears BEFORE the amount, not after
  // Pattern: optional card number (4 digits + space), then amount at end
  const amountMatch = cleanedRemainder.match(/(?:\s+\d{4}\s+)?([\d,]*\.?\d{1,2})$/);
  if (!amountMatch) return null;
  
  let amountStr = amountMatch[1].replace(/,/g, '');
  
  // Handle decimal amounts starting with "." (e.g., ".69" -> "0.69")
  if (amountStr.startsWith('.')) {
    amountStr = '0' + amountStr;
  }
  
  const amount = parseFloat(amountStr);
  
  if (isNaN(amount) || amount === 0) return null;
  
  // Validate amount is reasonable (filter out phone numbers and account numbers)
  // Phone numbers don't have decimal points, but account numbers might look like amounts
  // Valid transaction amounts are typically < $100,000
  if (amount > 100000) {
    console.log(`[DollarBank] Rejecting suspicious amount: ${amount} from "${cleanedRemainder.substring(0, 50)}"`);
    return null;
  }
  
  // Description is everything between date and amount
  // Also remove the card number (4 digits) if present at the end before amount
  let description = cleanedRemainder
    .replace(/(?:\s+\d{4})?\s*([\d,]*\.?\d{1,2})$/, '')  // Remove card# and amount
    .trim();
  
  // Clean up description - remove trailing card numbers that might be left
  description = description.replace(/\s+\d{4}$/, '').trim();
  
  if (!description) return null;
  
  // Determine sign based on transaction type using our pattern analysis
  const sign = getDollarBankSign(description);
  const signedAmount = sign * amount;
  
  // Format amount as string with correct sign
  const amountString = signedAmount < 0 
    ? `-$${Math.abs(signedAmount).toFixed(2)}` 
    : `$${signedAmount.toFixed(2)}`;
  
  console.log(`[DollarBank] Parsed: "${description.substring(0, 40)}" -> ${amountString} (sign=${sign})`);
  
  return {
    date,
    amount: amountString,
    description,
  };
}

/**
 * Parse table_item mentionText format: "MM/DD <amount> <description>"
 * Example: "08/07 1.59 8433 DBT PURCHASE - 999999 TJ MAXX #822 HOMESTEAD PA"
 * Returns: { date: "08/07", amount: "1.59", description: "8433 DBT PURCHASE - 999999 TJ MAXX #822 HOMESTEAD PA" }
 * 
 * Filters out balance-only rows (rows without MM/DD pattern or that are just numbers).
 */
function parseTableItemMentionText(mentionText: string | undefined): {
  date: string;
  amount: string;
  description: string;
} | null {
  if (!mentionText) return null;
  
  const trimmed = mentionText.trim();
  
  // Filter out rows that are just numbers (likely balances)
  // If the entire string is just a number with optional negative sign, skip it
  if (/^-?\d+\.?\d*$/.test(trimmed)) {
    return null;
  }
  
  // Match MM/DD pattern at the start
  const dateMatch = trimmed.match(/^(\d{1,2}\/\d{1,2})\s+/);
  if (!dateMatch) {
    // If no date pattern, this might be a balance-only row - skip it
    return null;
  }
  
  const date = dateMatch[1];
  const afterDate = trimmed.substring(dateMatch[0].length).trim();
  
  // Extract amount - first number after the date
  // Match: optional negative sign, digits, optional decimal point and digits
  const amountMatch = afterDate.match(/^(-?\d+\.?\d*)\s+/);
  if (!amountMatch) {
    // If no amount found, this might be malformed - skip it
    return null;
  }
  
  const amount = amountMatch[1];
  const description = afterDate.substring(amountMatch[0].length).trim();
  
  // Ensure we have a valid description
  if (!description) {
    return null;
  }
  
  return {
    date,
    amount,
    description,
  };
}

function isTransactionEntity(entity: DocumentAiEntity, docType: CanonicalDocument["documentType"]): boolean {
  const type = (entity.type || "").toLowerCase();
  if (type.includes("transaction")) return true;
  // table_item entities contain transaction data in bank statements
  if (type.includes("table_item") || type.includes("tableitem")) return true;
  // Bank Statement Parser may also return line_item entities for transactions
  if (docType === "bank_statement" && (type.includes("line_item") || type.includes("lineitem"))) return true;
  if (docType === "invoice" && (type.includes("line_item") || type.includes("lineitem"))) return true;
  if (docType === "bank_statement" && type.includes("bank")) return true;
  if (docType === "receipt" && type.includes("purchase")) return true;
  return false;
}

function inferDirectionFromEntity(
  entity: DocumentAiEntity,
  amountEntity?: DocumentAiEntity
): "debit" | "credit" | undefined {
  const type = (entity.type || "").toLowerCase();
  if (type.includes("credit")) return "credit";
  if (type.includes("debit")) return "debit";

  const amountText = amountEntity?.mentionText ?? entity.mentionText ?? "";
  if (/-|\(/.test(amountText)) return "debit";
  return undefined;
}

function normalizeNumber(value: string | number | null | undefined): number | null {
  if (value == null) return null;
  const parsed = typeof value === "number" ? value : parseFloat(value.toString().replace(/[^0-9.-]/g, ""));
  return Number.isNaN(parsed) ? null : parsed;
}