CREATE OR REPLACE FUNCTION ledger_assert_transaction_balanced()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  entry_count INTEGER;
  debit_total NUMERIC;
  credit_total NUMERIC;
  customer_count INTEGER;
  system_count INTEGER;
  expected_customer_count INTEGER;
  expected_system_count INTEGER;
  amount_match_count INTEGER;
BEGIN
  IF NEW.status = 'COMPLETED' THEN
    SELECT COUNT(*),
      COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'DEBIT'), 0),
      COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'CREDIT'), 0),
      COUNT(*) FILTER (WHERE account_id = NEW.account_id),
      COUNT(*) FILTER (WHERE system_ledger_account_id IS NOT NULL),
      COUNT(*) FILTER (WHERE account_id = NEW.account_id AND entry_side =
        CASE WHEN NEW.transaction_type = 'DEPOSIT' THEN 'CREDIT' ELSE 'DEBIT' END),
      COUNT(*) FILTER (WHERE system_ledger_account_id IS NOT NULL AND entry_side =
        CASE WHEN NEW.transaction_type = 'DEPOSIT' THEN 'DEBIT' ELSE 'CREDIT' END),
      COUNT(*) FILTER (WHERE amount_paise = NEW.amount_paise)
    INTO entry_count, debit_total, credit_total, customer_count, system_count,
         expected_customer_count, expected_system_count, amount_match_count
    FROM ledger_entries WHERE transaction_id = NEW.id;
    IF entry_count <> 2 OR debit_total <= 0 OR debit_total <> credit_total
       OR customer_count <> 1 OR system_count <> 1
       OR expected_customer_count <> 1 OR expected_system_count <> 1
       OR amount_match_count <> 2 THEN
      RAISE EXCEPTION 'Completed transaction is not balanced' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS transactions_balanced_trigger ON transactions;
CREATE CONSTRAINT TRIGGER transactions_balanced_trigger
AFTER INSERT OR UPDATE ON transactions DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_assert_transaction_balanced();

CREATE OR REPLACE FUNCTION ledger_assert_account_projection()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  ledger_balance NUMERIC;
BEGIN
  SELECT COALESCE(SUM(CASE WHEN entry_side = 'CREDIT' THEN amount_paise ELSE -amount_paise END), 0)
  INTO ledger_balance
  FROM ledger_entries
  WHERE account_id = NEW.id;
  IF ledger_balance <> NEW.balance_paise THEN
    RAISE EXCEPTION 'Account projection does not match ledger' USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS account_ledger_projection_trigger ON accounts;
CREATE CONSTRAINT TRIGGER account_ledger_projection_trigger
AFTER INSERT OR UPDATE ON accounts DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION ledger_assert_account_projection();
