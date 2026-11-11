async function lockActiveAccount(client, accountId) {
  const result = await client.query(
    "SELECT id, account_number, owner_user_id, balance_paise, currency, status FROM accounts WHERE id = $1 AND status = 'ACTIVE' FOR UPDATE",
    [accountId]
  );
  if (!result.rows[0]) {
    const error = new Error('Account is not active');
    error.status = 409;
    throw error;
  }
  return result.rows[0];
}
async function lockAccountsInOrder(client, accountIds) {
  const orderedIds = [...new Set(accountIds.map((id) => id.toLowerCase()))].sort();
  const locked = new Map();
  for (const id of orderedIds) {
    const result = await client.query(
      'SELECT id, account_number, owner_user_id, balance_paise, currency, status FROM accounts WHERE id = $1 FOR UPDATE',
      [id]
    );
    if (result.rows[0]) locked.set(id, result.rows[0]);
  }
  return locked;
}
module.exports = { lockActiveAccount, lockAccountsInOrder };

