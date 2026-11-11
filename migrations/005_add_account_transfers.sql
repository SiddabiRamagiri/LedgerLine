ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS destination_account_id UUID,
  ADD COLUMN IF NOT EXISTS destination_balance_after_paise BIGINT;
ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_transaction_type_check;
ALTER TABLE transactions ADD CONSTRAINT transactions_transaction_type_check CHECK (transaction_type IN ('DEPOSIT', 'WITHDRAWAL', 'TRANSFER'));
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_destination_account_fkey' AND conrelid = 'transactions'::regclass) THEN
    ALTER TABLE transactions ADD CONSTRAINT transactions_destination_account_fkey FOREIGN KEY (destination_account_id) REFERENCES accounts(id) ON DELETE RESTRICT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_destination_account_check' AND conrelid = 'transactions'::regclass) THEN
    ALTER TABLE transactions ADD CONSTRAINT transactions_destination_account_check
      CHECK ((transaction_type = 'TRANSFER' AND destination_account_id IS NOT NULL AND destination_account_id <> account_id)
          OR (transaction_type <> 'TRANSFER' AND destination_account_id IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_destination_balance_check' AND conrelid = 'transactions'::regclass) THEN
    ALTER TABLE transactions ADD CONSTRAINT transactions_destination_balance_check
      CHECK ((transaction_type = 'TRANSFER' AND destination_account_id IS NOT NULL AND (status <> 'COMPLETED' OR destination_balance_after_paise IS NOT NULL))
          OR (transaction_type <> 'TRANSFER' AND destination_balance_after_paise IS NULL));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'transactions_destination_balance_nonnegative' AND conrelid = 'transactions'::regclass) THEN
    ALTER TABLE transactions ADD CONSTRAINT transactions_destination_balance_nonnegative CHECK (destination_balance_after_paise IS NULL OR destination_balance_after_paise >= 0);
  END IF;
END;
$$;
CREATE INDEX IF NOT EXISTS transactions_destination_created_idx ON transactions (destination_account_id, created_at DESC, id DESC) WHERE destination_account_id IS NOT NULL;

CREATE OR REPLACE FUNCTION ledger_assert_transaction_balanced()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  entry_count INTEGER;
  debit_total NUMERIC;
  credit_total NUMERIC;
  source_count INTEGER;
  destination_count INTEGER;
  system_count INTEGER;
  expected_source_count INTEGER;
  expected_destination_count INTEGER;
  expected_system_count INTEGER;
  amount_match_count INTEGER;
BEGIN
  IF NEW.status = 'COMPLETED' THEN
    SELECT COUNT(*),
      COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'DEBIT'), 0),
      COALESCE(SUM(amount_paise) FILTER (WHERE entry_side = 'CREDIT'), 0),
      COUNT(*) FILTER (WHERE account_id = NEW.account_id),
      COUNT(*) FILTER (WHERE NEW.destination_account_id IS NOT NULL AND account_id = NEW.destination_account_id),
      COUNT(*) FILTER (WHERE system_ledger_account_id IS NOT NULL),
      COUNT(*) FILTER (WHERE account_id = NEW.account_id AND entry_side = CASE WHEN NEW.transaction_type = 'DEPOSIT' THEN 'CREDIT' ELSE 'DEBIT' END),
      COUNT(*) FILTER (WHERE NEW.transaction_type = 'TRANSFER' AND account_id = NEW.destination_account_id AND entry_side = 'CREDIT'),
      COUNT(*) FILTER (WHERE system_ledger_account_id IS NOT NULL AND entry_side = CASE WHEN NEW.transaction_type = 'DEPOSIT' THEN 'DEBIT' ELSE 'CREDIT' END),
      COUNT(*) FILTER (WHERE amount_paise = NEW.amount_paise)
    INTO entry_count, debit_total, credit_total, source_count, destination_count, system_count,
         expected_source_count, expected_destination_count, expected_system_count, amount_match_count
    FROM ledger_entries WHERE transaction_id = NEW.id;
    IF entry_count <> 2 OR debit_total <= 0 OR debit_total <> credit_total
       OR expected_source_count <> 1 OR amount_match_count <> 2 THEN
      RAISE EXCEPTION 'Completed transaction is not balanced' USING ERRCODE = '23514';
    END IF;
    IF NEW.transaction_type = 'TRANSFER' THEN
      IF source_count <> 1 OR destination_count <> 1 OR system_count <> 0
         OR expected_destination_count <> 1 OR expected_system_count <> 0 THEN
        RAISE EXCEPTION 'Completed transfer entries are invalid' USING ERRCODE = '23514';
      END IF;
    ELSE
      IF source_count <> 1 OR destination_count <> 0 OR system_count <> 1
         OR expected_destination_count <> 0 OR expected_system_count <> 1 THEN
        RAISE EXCEPTION 'Completed cash transaction entries are invalid' USING ERRCODE = '23514';
      END IF;
    END IF;
  END IF;
  RETURN NULL;
END;
$$;
DROP TRIGGER IF EXISTS transactions_balanced_trigger ON transactions;
CREATE CONSTRAINT TRIGGER transactions_balanced_trigger AFTER INSERT OR UPDATE ON transactions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ledger_assert_transaction_balanced();
