import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Transaction } from '@/lib/pdfParser';

interface TransactionTableProps {
  transactions: Transaction[];
}

export default function TransactionTable({ transactions }: TransactionTableProps) {
  if (transactions.length === 0) {
    return null;
  }

  return (
    <div className="rounded-xl border border-border bg-card/50 backdrop-blur-md overflow-hidden shadow-lg">
      <div className="px-6 py-4 border-b border-border bg-card/30">
        <h2 className="text-lg font-semibold text-foreground">
          Extracted Transactions
        </h2>
        <p className="text-sm text-muted-foreground mt-1">
          {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} found
        </p>
      </div>
      
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent border-border">
              <TableHead className="font-semibold text-foreground">Date</TableHead>
              <TableHead className="font-semibold text-foreground">Transaction Type</TableHead>
              <TableHead className="font-semibold text-foreground">Payee / Payor</TableHead>
              <TableHead className="font-semibold text-foreground text-right">Amount</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {transactions.map((transaction, index) => (
              <TableRow 
                key={index}
                className="hover:bg-accent/30 transition-colors border-border"
              >
                <TableCell className="font-medium tabular-nums">
                  {transaction.date}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {transaction.type}
                </TableCell>
                <TableCell className="max-w-md truncate" title={transaction.payee}>
                  {transaction.payee}
                </TableCell>
                <TableCell className={`text-right font-semibold tabular-nums ${
                  transaction.amount.startsWith('-') 
                    ? 'text-destructive' 
                    : 'text-green-600 dark:text-green-400'
                }`}>
                  {transaction.amount}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
