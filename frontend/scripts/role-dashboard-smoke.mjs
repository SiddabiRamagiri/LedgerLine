import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { chromium } from 'playwright';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
dotenv.config({ path: path.join(root, '.env') });
const require = createRequire(import.meta.url);
const pool = require('../../src/db/pool.js');
const config = require('../../src/config/env.js');
const apiUrl = process.env.LEDGERLINE_API_URL || 'http://localhost:3000';
const webUrl = process.env.LEDGERLINE_WEB_URL || 'http://localhost:5173';
const chromePath = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const suffix = crypto.randomUUID();
const seeded = [];
let browser;

async function createIdentity(role, label = role.toLowerCase()) {
  const email = `ledgerline-ui-${label}-${suffix}@example.test`;
  const result = await pool.query(
    'INSERT INTO users (full_name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id, full_name, email, role, is_active, created_at, updated_at',
    [`UI Smoke ${role}`, email, '!non-login-smoke-fixture', role]
  );
  const user = result.rows[0];
  seeded.push(user.id);
  const token = jwt.sign({ role }, config.jwtSecret, { subject: String(user.id), expiresIn: '10m', algorithm: 'HS256' });
  return { token, user };
}

async function apiRequest(pathname, { token, method = 'GET', body } = {}) {
  const response = await fetch(apiUrl + pathname, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  const payload = await response.json().catch(() => ({}));
  assert.ok(response.ok, `API ${method} ${pathname} returned HTTP ${response.status}`);
  return payload;
}

async function openDashboard(identity) {
  const context = await browser.newContext();
  await context.addInitScript((session) => sessionStorage.setItem('ledgerline.session', JSON.stringify(session)), {
    token: identity.token,
    user: {
      id: identity.user.id, fullName: identity.user.full_name, email: identity.user.email,
      role: identity.user.role, isActive: identity.user.is_active,
      createdAt: identity.user.created_at, updatedAt: identity.user.updated_at
    }
  });
  const page = await context.newPage();
  const failures = [];
  page.on('response', (response) => { if (response.url().includes('/api/') && response.status() >= 400) failures.push(`${response.status()} ${response.url()}`); });
  await page.goto(webUrl, { waitUntil: 'networkidle' });
  await page.locator('.page-heading h1').waitFor();
  await page.getByRole('heading', { name: /^Overview/ }).waitFor();
  return { context, page, failures };
}

async function main() {
  assert.notEqual(config.nodeEnv, 'production', 'Role smoke checks create synthetic test transactions; do not run against production');
  assert.ok(config.jwtSecret, 'JWT_SECRET must be configured for role smoke checks');
  const admin = await createIdentity('ADMIN');
  const auditor = await createIdentity('AUDITOR');
  const recipient = await createIdentity('ACCOUNT_HOLDER', 'recipient');
  const recipientAccount = await apiRequest('/api/accounts', { token: recipient.token, method: 'POST', body: {} });

  browser = await chromium.launch({ headless: true, executablePath: chromePath });
  const holderContext = await browser.newContext();
  const holderPage = await holderContext.newPage();
  const holderFailures = [];
  holderPage.on('response', (response) => { if (response.url().includes('/api/') && response.status() >= 400) holderFailures.push(`${response.status()} ${response.url()}`); });
  await holderPage.goto(webUrl, { waitUntil: 'networkidle' });
  await holderPage.getByRole('heading', { name: 'Sign in to your account' }).waitFor();
  await holderPage.getByRole('button', { name: 'Create an account', exact: true }).click();
  const holderEmail = `ledgerline-ui-holder-${suffix}@example.test`;
  const holderPassword = `Browser-smoke-${suffix}`;
  await holderPage.getByLabel('Full name').fill('UI Smoke Account Holder');
  await holderPage.getByLabel('Email address').fill(holderEmail);
  await holderPage.getByLabel('Password').fill(holderPassword);
  await holderPage.getByRole('button', { name: /Create account/ }).click();
  await holderPage.getByRole('status').getByText('Your account is ready. Sign in to continue.').waitFor();
  await holderPage.getByLabel('Password').fill(holderPassword);
  await holderPage.getByRole('button', { name: /Sign in/ }).click();
  await holderPage.getByRole('heading', { name: /^Overview/ }).waitFor();
  const holderUser = (await pool.query('SELECT id,full_name,email,role,is_active,created_at,updated_at FROM users WHERE email=$1', [holderEmail])).rows[0];
  assert.ok(holderUser);
  seeded.push(holderUser.id);
  const browserSession = await holderPage.evaluate(() => JSON.parse(sessionStorage.getItem('ledgerline.session')));
  const holder = { token: browserSession.token, user: holderUser };

  assert.equal(await holderPage.getByRole('button', { name: 'Users' }).count(), 0);
  await holderPage.getByRole('button', { name: 'My accounts' }).click();
  await holderPage.getByRole('button', { name: /Create account/ }).click();
  await holderPage.getByText('Account created and ready to use.').waitFor();
  const holderAccounts = await apiRequest('/api/accounts', { token: holder.token });
  const source = { account: holderAccounts.accounts[0] };
  await holderPage.getByText(source.account.accountNumber, { exact: true }).waitFor();
  await holderPage.getByRole('button', { name: 'Move money', exact: true }).click();
  await holderPage.getByRole('tab', { name: 'Deposit' }).click();
  await holderPage.locator('.amount-input input').fill('12.34');
  await holderPage.getByRole('button', { name: /Confirm deposit/ }).click();
  await holderPage.getByText('Deposit posted').waitFor();
  await holderPage.getByRole('tab', { name: 'Withdraw' }).click();
  await holderPage.locator('.amount-input input').fill('1.00');
  await holderPage.getByRole('button', { name: /Confirm withdrawal/ }).click();
  await holderPage.getByText('Withdrawal posted').waitFor();
  await holderPage.getByRole('tab', { name: 'Transfer' }).click();
  await holderPage.getByPlaceholder('Paste the recipient account UUID').fill(recipientAccount.account.id);
  await holderPage.locator('.amount-input input').fill('2.34');
  await holderPage.getByRole('button', { name: /Confirm transfer/ }).click();
  await holderPage.getByText('Transfer posted').waitFor();
  await holderPage.getByRole('button', { name: 'Transactions', exact: true }).click();
  await holderPage.getByText('Ledger activity').waitFor();
  await holderPage.getByText('Deposit', { exact: true }).waitFor();
  await holderPage.getByText('Withdrawal', { exact: true }).waitFor();
  await holderPage.getByText('Transfer sent', { exact: true }).waitFor();
  assert.equal(holderFailures.length, 0, `Account-holder API errors: ${holderFailures.join(', ')}`);

  const recipientView = await openDashboard(recipient);
  await recipientView.page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await recipientView.page.getByText('Transfer received', { exact: true }).waitFor();
  assert.equal(recipientView.failures.length, 0, `Recipient API errors: ${recipientView.failures.join(', ')}`);

  const adminView = await openDashboard(admin);
  await adminView.page.getByRole('button', { name: 'Users' }).click();
  await adminView.page.getByText('People & roles').waitFor();
  await adminView.page.getByText(holder.user.email).waitFor();
  await adminView.page.getByRole('button', { name: 'Accounts' }).click();
  await adminView.page.getByText('Account directory').waitFor();
  await adminView.page.getByRole('button', { name: 'Freeze' }).first().waitFor();
  await adminView.page.getByRole('button', { name: 'Audit & controls' }).click();
  await adminView.page.getByText('Audit log').waitFor();
  await adminView.page.getByText('Ledger reconciliation').waitFor();
  assert.equal(adminView.failures.length, 0, `Admin API errors: ${adminView.failures.join(', ')}`);

  const auditorView = await openDashboard(auditor);
  assert.equal(await auditorView.page.getByRole('button', { name: 'Move money' }).count(), 0);
  assert.equal(await auditorView.page.getByRole('button', { name: 'Add auditor' }).count(), 0);
  await auditorView.page.getByRole('button', { name: 'Accounts' }).click();
  await auditorView.page.getByText('Account directory').waitFor();
  await auditorView.page.getByRole('button', { name: 'Transactions', exact: true }).click();
  await auditorView.page.getByText('Ledger activity').waitFor();
  await auditorView.page.getByRole('button', { name: 'Audit & controls' }).click();
  await auditorView.page.getByText('Audit log').waitFor();
  assert.equal(auditorView.failures.length, 0, `Auditor API errors: ${auditorView.failures.join(', ')}`);

  const recipientState = await apiRequest(`/api/accounts/${recipientAccount.account.id}`, { token: recipient.token });
  assert.equal(recipientState.account.balancePaise, '234');
  const sourceState = await apiRequest(`/api/accounts/${source.account.id}`, { token: holder.token });
  assert.equal(sourceState.account.balancePaise, '900');
  console.log('Role dashboard smoke checks passed: account holder (create/deposit/withdraw/transfer/history), admin (users/accounts/audit/reconciliation), auditor (read-only accounts/history/audit/reconciliation).');
  await Promise.all([holderContext.close(), recipientView.context.close(), adminView.context.close(), auditorView.context.close()]);
}

try { await main(); }
finally {
  if (browser) await browser.close();
  if (seeded.length) {
    await pool.query('DELETE FROM ledger_entries WHERE transaction_id IN (SELECT id FROM transactions WHERE initiated_by = ANY($1::bigint[]))', [seeded]);
    await pool.query('DELETE FROM transactions WHERE initiated_by = ANY($1::bigint[])', [seeded]);
    await pool.query('DELETE FROM accounts WHERE owner_user_id = ANY($1::bigint[])', [seeded]);
    await pool.query('DELETE FROM users WHERE id = ANY($1::bigint[])', [seeded]);
  }
  await pool.end();
}
