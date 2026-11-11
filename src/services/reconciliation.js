async function reconcileLedger(db) {
  const completed = await db.query(
    `SELECT t.id, t.reference, t.transaction_type, t.amount_paise,
       COALESCE(SUM(le.amount_paise) FILTER (WHERE le.entry_side = 'DEBIT'), 0)::text AS debit_total,
       COALESCE(SUM(le.amount_paise) FILTER (WHERE le.entry_side = 'CREDIT'), 0)::text AS credit_total,
       COUNT(le.id)::int AS entry_count,
       COUNT(*) FILTER (WHERE t.transaction_type = 'TRANSFER' AND le.account_id = t.account_id AND le.entry_side = 'DEBIT')::int AS source_debits,
       COUNT(*) FILTER (WHERE t.transaction_type = 'TRANSFER' AND le.account_id = t.destination_account_id AND le.entry_side = 'CREDIT')::int AS destination_credits,
       COUNT(*) FILTER (WHERE t.transaction_type = 'TRANSFER' AND le.system_ledger_account_id IS NOT NULL)::int AS transfer_system_entries
     FROM transactions t LEFT JOIN ledger_entries le ON le.transaction_id = t.id
     WHERE t.status = 'COMPLETED' GROUP BY t.id
     HAVING COALESCE(SUM(le.amount_paise) FILTER (WHERE le.entry_side = 'DEBIT'), 0) <>
            COALESCE(SUM(le.amount_paise) FILTER (WHERE le.entry_side = 'CREDIT'), 0)
        OR COUNT(le.id) <> 2
        OR COUNT(*) FILTER (WHERE le.amount_paise = t.amount_paise) <> 2
        OR (t.transaction_type = 'TRANSFER' AND (
          COUNT(*) FILTER (WHERE le.account_id = t.account_id AND le.entry_side = 'DEBIT') <> 1 OR
          COUNT(*) FILTER (WHERE le.account_id = t.destination_account_id AND le.entry_side = 'CREDIT') <> 1 OR
          COUNT(*) FILTER (WHERE le.system_ledger_account_id IS NOT NULL) <> 0 OR
          COALESCE(SUM(le.amount_paise),0) <> t.amount_paise * 2))
        OR (t.transaction_type = 'DEPOSIT' AND (
          COUNT(*) FILTER (WHERE le.account_id = t.account_id AND le.entry_side = 'CREDIT') <> 1 OR
          COUNT(*) FILTER (WHERE le.system_ledger_account_id IS NOT NULL AND le.entry_side = 'DEBIT') <> 1))
        OR (t.transaction_type = 'WITHDRAWAL' AND (
          COUNT(*) FILTER (WHERE le.account_id = t.account_id AND le.entry_side = 'DEBIT') <> 1 OR
          COUNT(*) FILTER (WHERE le.system_ledger_account_id IS NOT NULL AND le.entry_side = 'CREDIT') <> 1))`
  );
  const projections = await db.query(
    `SELECT a.id AS account_id, a.balance_paise::text AS balance_paise,
       COALESCE(SUM(CASE WHEN le.entry_side = 'CREDIT' THEN le.amount_paise ELSE -le.amount_paise END), 0)::text AS ledger_balance_paise
     FROM accounts a LEFT JOIN ledger_entries le ON le.account_id = a.id
     GROUP BY a.id HAVING a.balance_paise <> COALESCE(SUM(CASE WHEN le.entry_side = 'CREDIT' THEN le.amount_paise ELSE -le.amount_paise END), 0)`
  );
  const negatives = await db.query('SELECT id AS account_id, balance_paise::text FROM accounts WHERE balance_paise < 0');
  return {
    checkedAt: new Date().toISOString(),
    discrepancies: [
      ...completed.rows.map((r) => ({ type: r.transaction_type === 'TRANSFER' ? 'UNBALANCED_TRANSFER' : 'UNBALANCED_TRANSACTION', transactionId: r.id, reference: r.reference, debitPaise: r.debit_total, creditPaise: r.credit_total })),
      ...projections.rows.map((r) => ({ type: 'ACCOUNT_PROJECTION_MISMATCH', accountId: r.account_id, balancePaise: r.balance_paise, ledgerBalancePaise: r.ledger_balance_paise })),
      ...negatives.rows.map((r) => ({ type: 'NEGATIVE_ACCOUNT_BALANCE', accountId: r.account_id, balancePaise: r.balance_paise }))
    ]
  };
}
module.exports = { reconcileLedger };
