import { useCallback, useEffect, useRef, useState } from 'react';
import { api, clearSession, formatDate, formatPaise, paiseFromRupees, readSession, saveSession } from './api.js';

const ROLE_NAMES = { ACCOUNT_HOLDER: 'Account holder', ADMIN: 'Administrator', AUDITOR: 'Auditor' };
const NAV = {
  ACCOUNT_HOLDER: [['overview', 'Overview', '⌂'], ['accounts', 'My accounts', '▤'], ['money', 'Move money', '⇄'], ['history', 'Transactions', '↗']],
  ADMIN: [['overview', 'Overview', '⌂'], ['accounts', 'Accounts', '▤'], ['users', 'Users', '♙'], ['audit', 'Audit & controls', '◷']],
  AUDITOR: [['overview', 'Overview', '⌂'], ['accounts', 'Accounts', '▤'], ['history', 'Transactions', '↗'], ['audit', 'Audit & controls', '◷']]
};
const PAGE_TITLES = { overview: 'Overview', accounts: 'Accounts', money: 'Move money', history: 'Transaction history', users: 'People & access', audit: 'Audit & controls' };

function Icon({ children, className = '' }) { return <span aria-hidden="true" className={`icon ${className}`}>{children}</span>; }
function Notice({ message, onClose }) { if (!message) return null; return <div className="notice" role="alert"><span>{message}</span>{onClose && <button className="notice-close" onClick={onClose} aria-label="Dismiss">×</button>}</div>; }
function Loading({ label = 'Loading your LedgerLine data…' }) { return <div className="loading"><span className="spinner" />{label}</div>; }
function StatusPill({ status }) { return <span className={`status status-${String(status).toLowerCase()}`}>{String(status).toLowerCase()}</span>; }

function AuthPage({ onLogin, initialError }) {
  const [mode, setMode] = useState('login');
  const [form, setForm] = useState({ fullName: '', email: '', password: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  useEffect(() => { if (initialError) setError(initialError); }, [initialError]);
  const change = (key) => (event) => setForm((current) => ({ ...current, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault(); setError(''); setSuccess(''); setBusy(true);
    try {
      if (mode === 'register') {
        await api('/api/auth/register', { method: 'POST', body: { fullName: form.fullName.trim(), email: form.email.trim(), password: form.password } });
        setMode('login'); setSuccess('Your account is ready. Sign in to continue.'); setForm((current) => ({ ...current, password: '' }));
      } else {
        const result = await api('/api/auth/login', { method: 'POST', body: { email: form.email.trim(), password: form.password } });
        onLogin({ token: result.token, user: result.user });
      }
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="auth-shell">
    <section className="auth-brand">
      <div className="brand brand-light"><span className="brand-mark">L</span><span>Ledger<span>Line</span></span></div>
      <div className="auth-story"><span className="eyebrow">A clearer view of your money</span><h1>Money moves.<br /><em>Clarity stays.</em></h1><p>A thoughtful place to manage accounts, follow every transaction, and keep your financial picture in focus.</p></div>
      <div className="auth-footnote"><span className="secure-dot" /> Secure access · Built for confidence</div>
      <div className="auth-orbit orbit-one" /><div className="auth-orbit orbit-two" />
    </section>
    <section className="auth-panel">
      <div className="auth-mobile-brand brand"><span className="brand-mark">L</span><span>Ledger<span>Line</span></span></div>
      <div className="auth-card">
        <span className="eyebrow">{mode === 'login' ? 'Welcome back' : 'Get started'}</span>
        <h2>{mode === 'login' ? 'Sign in to your account' : 'Create your account'}</h2>
        <p className="muted">{mode === 'login' ? 'Enter your details to access your secure workspace.' : 'Registration creates an account-holder profile.'}</p>
        <Notice message={error} />{success && <div className="success-notice" role="status">{success}</div>}
        <form onSubmit={submit} className="form-stack">
          {mode === 'register' && <label>Full name<input autoComplete="name" required minLength="2" maxLength="120" value={form.fullName} onChange={change('fullName')} placeholder="e.g. Aanya Sharma" /></label>}
          <label>Email address<input type="email" autoComplete="email" required maxLength="254" value={form.email} onChange={change('email')} placeholder="you@example.com" /></label>
          <label>Password<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 12} maxLength="72" value={form.password} onChange={change('password')} placeholder={mode === 'login' ? 'Enter your password' : 'At least 12 characters'} /></label>
          <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}<span>→</span></button>
        </form>
        <p className="auth-switch">{mode === 'login' ? 'New to LedgerLine?' : 'Already have an account?'} <button onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); setSuccess(''); }}> {mode === 'login' ? 'Create an account' : 'Sign in'}</button></p>
        {mode === 'register' && <p className="auth-note">Public registration is for account holders. Administrator and auditor access is provisioned separately.</p>}
      </div>
      <div className="auth-legal">LedgerLine · Secure financial workspace</div>
    </section>
  </main>;
}

function App() {
  const [session, setSession] = useState(() => readSession());
  const [page, setPage] = useState('overview');
  const [mobileNav, setMobileNav] = useState(false);
  const [globalError, setGlobalError] = useState('');
  const [authNotice, setAuthNotice] = useState('');
  const user = session?.user;
  const signOut = useCallback(() => { clearSession(); setSession(null); setPage('overview'); setAuthNotice(''); }, []);
  const expireSession = useCallback((event) => { clearSession(); setSession(null); setPage('overview'); setAuthNotice(event.detail); }, []);
  const onLogin = (value) => { saveSession(value); setSession(value); setPage('overview'); setAuthNotice(''); };
  useEffect(() => { if (user) setPage('overview'); }, [user?.id]);
  useEffect(() => { window.addEventListener('ledgerline:unauthorized', expireSession); return () => window.removeEventListener('ledgerline:unauthorized', expireSession); }, [expireSession]);
  if (!session?.token || !user) return <AuthPage onLogin={onLogin} initialError={authNotice} />;
  const menu = NAV[user.role] || [];
  const pageTitle = PAGE_TITLES[page] || 'Overview';
  return <div className="app-shell">
    <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
      <div className="sidebar-brand"><div className="brand"><span className="brand-mark">L</span><span>Ledger<span>Line</span></span></div><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation">×</button></div>
      <div className="workspace-label">WORKSPACE</div>
      <nav className="side-nav" aria-label="Main navigation">{menu.map(([key, title, glyph]) => <button key={key} className={`nav-item ${page === key ? 'nav-active' : ''}`} onClick={() => { setPage(key); setMobileNav(false); setGlobalError(''); }}><Icon>{glyph}</Icon><span>{title}</span>{page === key && <span className="nav-indicator" />}</button>)}</nav>
      <div className="sidebar-bottom"><div className="support-card"><div className="support-icon">✦</div><strong>Your finances, in focus.</strong><span>Every entry accounted for.</span></div><div className="profile-row"><div className="avatar">{(user.fullName || 'U').split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase()}</div><div className="profile-copy"><strong>{user.fullName}</strong><span>{ROLE_NAMES[user.role] || user.role}</span></div><button className="logout-icon" title="Sign out" onClick={signOut}>↗</button></div></div>
    </aside>
    {mobileNav && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <div className="main-shell">
      <header className="topbar"><button className="menu-toggle" onClick={() => setMobileNav(true)} aria-label="Open navigation">☰</button><div className="breadcrumb"><span>LedgerLine</span><b>/</b>{pageTitle}</div><div className="topbar-right"><span className="live-indicator"><i /> Live workspace</span><div className="top-avatar">{(user.fullName || 'U')[0].toUpperCase()}</div></div></header>
      <main className="content-area"><div className="page-heading"><div><span className="eyebrow">{new Intl.DateTimeFormat('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date())}</span><h1>{pageTitle}{page === 'overview' ? <span>, {user.fullName?.split(' ')[0]}</span> : null}</h1><p>{pageSubtitle(page, user.role)}</p></div><div className="heading-badge"><span className="secure-dot" />{ROLE_NAMES[user.role]}</div></div>
        <Notice message={globalError} onClose={() => setGlobalError('')} />
        {page === 'overview' && <Dashboard user={user} token={session.token} onNavigate={setPage} onError={setGlobalError} />}
        {page === 'accounts' && <AccountsPage user={user} token={session.token} onError={setGlobalError} />}
        {page === 'money' && <MoneyPage token={session.token} onError={setGlobalError} />}
        {page === 'history' && <HistoryPage token={session.token} onError={setGlobalError} />}
        {page === 'users' && <UsersPage token={session.token} onError={setGlobalError} />}
        {page === 'audit' && <AuditPage token={session.token} onError={setGlobalError} />}
      </main>
      <footer className="footer"><span>LedgerLine</span><span>Numbers you can follow.</span><span className="footer-secure">● Encrypted session</span></footer>
    </div>
  </div>;
}

function pageSubtitle(page, role) {
  if (page === 'overview') return role === 'ACCOUNT_HOLDER' ? 'A simple snapshot of your accounts and recent activity.' : role === 'ADMIN' ? 'Monitor account activity and manage your workspace.' : 'Read-only visibility across accounts and ledger activity.';
  return ({ accounts: 'Explore accounts available to your access level.', money: 'Move funds between accounts using the secure ledger.', history: 'Review posted activity from newest to oldest.', users: 'Review user access and provision auditor accounts.', audit: 'Review the audit trail and reconcile ledger records.' })[page] || '';
}

function useLoad(loader, deps, onError) {
  const [state, setState] = useState({ loading: true, data: null, error: '' });
  const reload = useCallback(async () => {
    setState((current) => ({ ...current, loading: true, error: '' }));
    try { const data = await loader(); setState({ loading: false, data, error: '' }); return data; }
    catch (error) { setState({ loading: false, data: null, error: error.message }); onError?.(error.message); return null; }
    // The loader and deps identify each page's refresh context.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

function Dashboard({ user, token, onNavigate, onError }) {
  const role = user.role;
  const loader = useCallback(async () => {
    const [accountResult, userResult] = await Promise.all([
      api('/api/accounts', { token }),
      role === 'ADMIN' ? api('/api/admin/users', { token }) : Promise.resolve(null)
    ]);
    return { accounts: accountResult.accounts, users: userResult?.users || [] };
  }, [token, role]);
  const { data, loading, reload } = useLoad(loader, [loader], onError);
  if (loading && !data) return <Loading />;
  const accounts = data?.accounts || [];
  const total = accounts.reduce((sum, account) => sum + BigInt(account.balancePaise || 0), 0n).toString();
  const active = accounts.filter((account) => account.status === 'ACTIVE').length;
  return <>
    {role === 'ACCOUNT_HOLDER' && <div className="balance-banner"><div className="balance-orb" /><div className="banner-copy"><span>Total account balance</span><strong>{formatPaise(total)}</strong><small>Across {accounts.length} {accounts.length === 1 ? 'account' : 'accounts'}</small></div><button className="button button-light" onClick={() => onNavigate('money')}>Move money <span>→</span></button></div>}
    <div className="stats-grid">
      <StatCard label={role === 'ACCOUNT_HOLDER' ? 'My accounts' : 'Total accounts'} value={accounts.length} note={`${active} active`} icon="▤" tint="teal" />
      <StatCard label="Total balances" value={formatPaise(total)} note="Live account balances" icon="₹" tint="blue" />
      {role === 'ADMIN' && <StatCard label="Registered users" value={data?.users.length || 0} note="Across all roles" icon="♙" tint="lavender" />}
      {role === 'AUDITOR' && <StatCard label="Review access" value="Read-only" note="Ledger and account records" icon="◷" tint="lavender" />}
    </div>
    <div className="section-head"><div><h2>{role === 'ACCOUNT_HOLDER' ? 'Your accounts' : 'Accounts overview'}</h2><p>Balances and status from the live account service.</p></div><div className="section-actions"><button className="button button-outline button-sm" onClick={reload}>↻ Refresh</button>{role === 'ACCOUNT_HOLDER' && <button className="button button-primary button-sm" onClick={() => onNavigate('accounts')}>＋ New account</button>}</div></div>
    {accounts.length ? <div className="account-grid">{accounts.slice(0, 4).map((account) => <AccountCard key={account.id} account={account} />)}</div> : <EmptyState title="No accounts yet" text={role === 'ACCOUNT_HOLDER' ? 'Create your first account to get started.' : 'No accounts are available.'} action={role === 'ACCOUNT_HOLDER' ? <button className="button button-primary button-sm" onClick={() => onNavigate('accounts')}>Create account</button> : null} />}
    <div className="quick-grid"><QuickCard icon="⇄" title={role === 'ACCOUNT_HOLDER' ? 'Move money' : 'Review activity'} description={role === 'ACCOUNT_HOLDER' ? 'Deposit, withdraw or transfer between accounts.' : 'Open transaction history for ledger entries.'} action={role === 'ACCOUNT_HOLDER' ? 'Open money tools' : 'View transactions'} onClick={() => onNavigate(role === 'ACCOUNT_HOLDER' ? 'money' : 'history')} /><QuickCard icon="◷" title={role === 'ACCOUNT_HOLDER' ? 'Recent activity' : 'Audit & controls'} description={role === 'ACCOUNT_HOLDER' ? 'See each posted transaction in detail.' : 'Review audit events and reconciliation checks.'} action={role === 'ACCOUNT_HOLDER' ? 'View transactions' : 'Open controls'} onClick={() => onNavigate(role === 'ACCOUNT_HOLDER' ? 'history' : 'audit')} /></div>
  </>;
}

function StatCard({ label, value, note, icon, tint }) { return <article className="stat-card"><div className={`stat-icon tint-${tint}`}>{icon}</div><span className="stat-label">{label}</span><strong className="stat-value">{value}</strong><span className="stat-note">{note}</span></article>; }
function QuickCard({ icon, title, description, action, onClick }) { return <article className="quick-card"><div className="quick-icon">{icon}</div><h3>{title}</h3><p>{description}</p><button onClick={onClick}>{action} <span>→</span></button></article>; }
function EmptyState({ title, text, action }) { return <div className="empty-state"><div className="empty-mark">◇</div><strong>{title}</strong><p>{text}</p>{action}</div>; }
function AccountCard({ account, onSelect }) { return <button className="account-card" onClick={() => onSelect?.(account)}><div className="account-card-top"><span className="card-brand-mark">L</span><StatusPill status={account.status} /></div><span className="account-number-label">ACCOUNT NUMBER</span><strong className="account-number">{account.accountNumber}</strong><div className="account-card-bottom"><span>Available balance</span><strong>{formatPaise(account.balancePaise)}</strong></div></button>; }

function AccountsPage({ user, token, onError }) {
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const loader = useCallback(() => api('/api/accounts', { token }), [token]);
  const { data, loading, reload } = useLoad(loader, [loader, refresh], onError);
  async function createAccount() {
    setBusy(true); setNotice('');
    try { await api('/api/accounts', { token, method: 'POST', body: {} }); setNotice('Account created and ready to use.'); setRefresh((x) => x + 1); }
    catch (error) { setNotice(error.message); }
    finally { setBusy(false); }
  }
  async function updateStatus(account, status) {
    setNotice('');
    try { await api(`/api/accounts/${account.id}/status`, { token, method: 'PATCH', body: { status } }); setNotice(`Account ${status.toLowerCase()} successfully.`); setRefresh((x) => x + 1); }
    catch (error) { setNotice(error.message); }
  }
  const accounts = data?.accounts || [];
  const [selected, setSelected] = useState(null);
  const detailLoader = useCallback(() => selected ? api(`/api/accounts/${selected}`, { token }) : Promise.resolve(null), [selected, token]);
  const detail = useLoad(detailLoader, [detailLoader], onError);
  return <>
    <div className="section-head page-section-head"><div><h2>Account directory</h2><p>{user.role === 'ACCOUNT_HOLDER' ? 'Only your own accounts are shown here.' : 'Account records visible to your role.'}</p></div>{user.role === 'ACCOUNT_HOLDER' && <button className="button button-primary" onClick={createAccount} disabled={busy}>{busy ? 'Creating…' : '＋ Create account'}</button>}</div>
    {notice && <Notice message={notice} onClose={() => setNotice('')} />}
    {loading && !data ? <Loading /> : accounts.length ? <div className="account-grid account-grid-wide">{accounts.map((account) => <div className="account-card-wrap" key={account.id}><AccountCard account={account} onSelect={() => setSelected(account.id)} />{user.role === 'ADMIN' && account.status !== 'CLOSED' && <div className="account-admin-actions"><button onClick={() => updateStatus(account, 'FROZEN')} disabled={account.status === 'FROZEN'}>Freeze</button><button onClick={() => updateStatus(account, 'CLOSED')}>Close</button></div>}</div>)}</div> : <EmptyState title="No accounts found" text={user.role === 'ACCOUNT_HOLDER' ? 'Create an account to see it here.' : 'No accounts are available to display.'} />}
    {selected && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}><section className="modal-card"><button className="modal-close" onClick={() => setSelected(null)} aria-label="Close">×</button><span className="eyebrow">Account details</span><h2>Account overview</h2>{detail.loading && !detail.data ? <Loading /> : detail.data?.account && <div className="detail-list"><DetailRow label="Account number" value={detail.data.account.accountNumber} /><DetailRow label="Account ID" value={detail.data.account.id} /><DetailRow label="Owner user ID" value={detail.data.account.ownerUserId} /><DetailRow label="Balance" value={formatPaise(detail.data.account.balancePaise)} /><DetailRow label="Currency" value={detail.data.account.currency} /><DetailRow label="Status" value={<StatusPill status={detail.data.account.status} />} /><DetailRow label="Created" value={formatDate(detail.data.account.createdAt)} /></div>}</section></div>}
    <button className="button button-outline button-sm refresh-floating" onClick={reload}>↻ Refresh accounts</button>
  </>;
}

function DetailRow({ label, value }) { return <div className="detail-row"><span>{label}</span><strong>{value}</strong></div>; }

function MoneyPage({ token, onError }) {
  const loader = useCallback(() => api('/api/accounts', { token }), [token]);
  const { data, loading } = useLoad(loader, [loader], onError);
  const accounts = data?.accounts || [];
  const eligible = accounts.filter((account) => account.status === 'ACTIVE');
  const [mode, setMode] = useState('deposit');
  const [sourceId, setSourceId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState(null);
  const idempotencyKey = useRef(null);
  useEffect(() => { if (!sourceId && eligible.length) setSourceId(eligible[0].id); }, [eligible, sourceId]);
  function invalidateKey() { idempotencyKey.current = null; setResult(null); setError(''); }
  async function submit(event) {
    event.preventDefault(); setBusy(true); setError(''); setResult(null);
    try {
      if (!idempotencyKey.current) idempotencyKey.current = crypto.randomUUID();
      const amountPaise = paiseFromRupees(amount);
      let path; let body = { amount_paise: amountPaise };
      if (mode === 'transfer') {
        if (!destinationId) throw new Error('Enter the destination account ID.');
        if (destinationId.trim().toLowerCase() === sourceId.toLowerCase()) throw new Error('Source and destination accounts must differ.');
        path = `/api/accounts/${sourceId}/transfers`;
        body = { ...body, destination_account_id: destinationId.trim() };
      } else path = `/api/accounts/${sourceId}/${mode === 'deposit' ? 'deposits' : 'withdrawals'}`;
      const response = await api(path, { token, method: 'POST', body, headers: { 'Idempotency-Key': idempotencyKey.current } });
      setResult(response.transaction); setAmount(''); idempotencyKey.current = null;
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  if (loading) return <Loading />;
  if (!eligible.length) return <EmptyState title="An active account is required" text="Create or activate an account before making a money movement." />;
  return <div className="money-layout"><section className="panel money-panel"><div className="panel-heading"><span className="eyebrow">SECURE LEDGER ENTRY</span><h2>{mode === 'deposit' ? 'Add funds' : mode === 'withdrawal' ? 'Withdraw funds' : 'Transfer funds'}</h2><p>Amounts are entered in rupees and recorded as integer paise.</p></div>
    <div className="segmented-control" role="tablist">{[['deposit', 'Deposit'], ['withdrawal', 'Withdraw'], ['transfer', 'Transfer']].map(([value, label]) => <button key={value} role="tab" aria-selected={mode === value} className={mode === value ? 'segment-active' : ''} onClick={() => { setMode(value); invalidateKey(); }}>{label}</button>)}</div>
    <Notice message={error} />
    <form className="form-stack money-form" onSubmit={submit}>
      <label>{mode === 'transfer' ? 'From account' : 'Account'}<select required value={sourceId} onChange={(event) => { setSourceId(event.target.value); invalidateKey(); }}>{eligible.map((account) => <option key={account.id} value={account.id}>{account.accountNumber} · {formatPaise(account.balancePaise)}</option>)}</select></label>
      {mode === 'transfer' && <label>Destination account ID<input required value={destinationId} onChange={(event) => { setDestinationId(event.target.value); invalidateKey(); }} placeholder="Paste the recipient account UUID" /><small>Transfers use the destination account ID. Confirm it with the recipient.</small></label>}
      <label>Amount in rupees<div className="amount-input"><span>₹</span><input inputMode="decimal" required value={amount} onChange={(event) => { setAmount(event.target.value); invalidateKey(); }} placeholder="0.00" /></div><small>Minimum ₹0.01 · Maximum ₹10,00,000.00 per transaction</small></label>
      <div className="money-note"><span>♧</span><p><strong>Recorded securely</strong><br />Your request is protected against duplicate submissions.</p></div>
      <button className="button button-primary button-wide" disabled={busy}>{busy ? 'Processing securely…' : mode === 'deposit' ? 'Confirm deposit' : mode === 'withdrawal' ? 'Confirm withdrawal' : 'Confirm transfer'}<span>→</span></button>
    </form>
    {result && <div className="result-card" role="status"><div className="result-check">✓</div><div><strong>{mode === 'transfer' ? 'Transfer posted' : mode === 'deposit' ? 'Deposit posted' : 'Withdrawal posted'}</strong><span>Reference {result.reference}</span><span>{formatPaise(result.amountPaise)} · {formatDate(result.createdAt)}</span></div></div>}
  </section><aside className="money-aside"><div className="aside-art"><div className="art-ring ring-a"/><div className="art-ring ring-b"/><span>₹</span></div><div className="aside-copy"><span className="eyebrow">LEDGERLINE STANDARD</span><h3>Every rupee has a record.</h3><p>Each completed movement is stored in the ledger and reflected in the account balance as one atomic operation.</p></div><div className="aside-points"><span><i>✓</i> Integer-paise accounting</span><span><i>✓</i> Duplicate request protection</span><span><i>✓</i> Ledger-backed balances</span></div></aside></div>;
}

function HistoryPage({ token, onError }) {
  const accountLoader = useCallback(() => api('/api/accounts', { token }), [token]);
  const accountState = useLoad(accountLoader, [accountLoader], onError);
  const accounts = accountState.data?.accounts || [];
  const [accountId, setAccountId] = useState('');
  const [page, setPage] = useState(1);
  useEffect(() => { if (!accountId && accounts.length) setAccountId(accounts[0].id); }, [accounts, accountId]);
  const loader = useCallback(() => accountId ? api(`/api/accounts/${accountId}/transactions?page=${page}&limit=20`, { token }) : Promise.resolve(null), [accountId, page, token]);
  const { data, loading, error } = useLoad(loader, [loader], onError);
  return <section className="panel table-panel"><div className="table-toolbar"><div><h2>Ledger activity</h2><p>Completed transactions, newest first.</p></div><label className="compact-select">Account<select value={accountId} onChange={(event) => { setAccountId(event.target.value); setPage(1); }}>{accounts.map((account) => <option key={account.id} value={account.id}>{account.accountNumber}</option>)}</select></label></div>
    {loading && !data ? <Loading /> : error ? <Notice message={error} /> : !accounts.length ? <EmptyState title="No accounts to show" text="Transaction history is available when an account exists." /> : data?.transactions?.length ? <><div className="table-scroll"><table><thead><tr><th>Transaction</th><th>Reference</th><th>Date</th><th>Account</th><th className="align-right">Amount</th><th>Status</th></tr></thead><tbody>{data.transactions.map((transaction) => { const incoming = transaction.type === 'TRANSFER' && transaction.destinationAccountId === accountId; const label = transaction.type === 'TRANSFER' ? incoming ? 'Transfer received' : 'Transfer sent' : titleCase(transaction.type); const accountLabel = transaction.type === 'TRANSFER' ? `${incoming ? 'From' : 'To'} ${(incoming ? transaction.accountId : transaction.destinationAccountId).slice(0, 8)}…` : transaction.accountId.slice(0, 8) + '…'; return <tr key={transaction.id}><td><span className={`type-icon type-${transaction.type.toLowerCase()}`}>{transaction.type === 'DEPOSIT' ? '↓' : transaction.type === 'WITHDRAWAL' ? '↑' : '⇄'}</span><span className="type-label">{label}</span></td><td className="mono">{transaction.reference}</td><td>{formatDate(transaction.createdAt)}</td><td className="mono">{accountLabel}</td><td className="align-right amount-cell">{formatPaise(transaction.amountPaise)}</td><td><StatusPill status={transaction.status} /></td></tr>; })}</tbody></table></div><div className="pagination"><span>{data.pagination.total} transaction{data.pagination.total === '1' ? '' : 's'}</span><div><button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>← Previous</button><span>Page {page}</span><button disabled={page * 20 >= Number(data.pagination.total)} onClick={() => setPage((p) => p + 1)}>Next →</button></div></div></> : <EmptyState title="No activity yet" text="Completed deposits, withdrawals and transfers will appear here." />}
  </section>;
}

function UsersPage({ token, onError }) {
  const [refresh, setRefresh] = useState(0);
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const loader = useCallback(() => api('/api/admin/users', { token }), [token]);
  const { data, loading, reload } = useLoad(loader, [loader, refresh], onError);
  async function createAuditor(event) {
    event.preventDefault(); setBusy(true); setMessage('');
    const formData = new FormData(event.currentTarget);
    try { await api('/api/admin/auditors', { token, method: 'POST', body: { fullName: formData.get('fullName'), email: formData.get('email'), password: formData.get('password') } }); setMessage('Auditor account created.'); setShowForm(false); setRefresh((n) => n + 1); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  }
  return <><div className="section-head page-section-head"><div><h2>Workspace users</h2><p>Account access and assigned roles.</p></div><button className="button button-primary" onClick={() => setShowForm((v) => !v)}>{showForm ? 'Close form' : '＋ Add auditor'}</button></div>
    {message && <Notice message={message} onClose={() => setMessage('')} />}
    {showForm && <form className="panel auditor-form" onSubmit={createAuditor}><div><span className="eyebrow">ADMINISTRATOR ACTION</span><h3>Create an auditor</h3><p>Auditor accounts are read-only.</p></div><label>Full name<input name="fullName" required minLength="2" maxLength="120" /></label><label>Email<input name="email" type="email" required maxLength="254" /></label><label>Temporary password<input name="password" type="password" required minLength="12" maxLength="72" /></label><button className="button button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create auditor'}</button></form>}
    <section className="panel table-panel"><div className="table-toolbar"><div><h2>People & roles</h2><p>Personal details returned by the existing admin users API.</p></div><button className="button button-outline button-sm" onClick={reload}>↻ Refresh</button></div>{loading && !data ? <Loading /> : data?.users?.length ? <div className="table-scroll"><table><thead><tr><th>User</th><th>Email</th><th>Role</th><th>Account status</th><th>Joined</th></tr></thead><tbody>{data.users.map((person) => <tr key={person.id}><td><div className="user-cell"><span className="mini-avatar">{person.fullName.slice(0, 1).toUpperCase()}</span><strong>{person.fullName}</strong></div></td><td>{person.email}</td><td><span className={`role-tag role-${person.role.toLowerCase()}`}>{ROLE_NAMES[person.role] || person.role}</span></td><td><StatusPill status={person.isActive ? 'ACTIVE' : 'INACTIVE'} /></td><td>{formatDate(person.createdAt)}</td></tr>)}</tbody></table></div> : <EmptyState title="No users found" text="There are no users to display." />}</section></>;
}

function AuditPage({ token, onError }) {
  const [filters, setFilters] = useState({ action: '', user_id: '', from: '', to: '' });
  const [query, setQuery] = useState('');
  const auditLoader = useCallback(() => api(`/api/admin/audit-logs?page=1&limit=50${query}`, { token }), [token, query]);
  const reconciliationLoader = useCallback(() => api('/api/admin/reconciliation', { token }), [token]);
  const audit = useLoad(auditLoader, [auditLoader], onError);
  const reconciliation = useLoad(reconciliationLoader, [reconciliationLoader], onError);
  const logs = audit.data?.auditLogs || [];
  const discrepancies = reconciliation.data?.discrepancies || [];
  function applyFilters(event) {
    event.preventDefault();
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(filters)) if (value) params.set(key, ['from', 'to'].includes(key) ? new Date(value).toISOString() : value);
    setQuery(params.toString() ? `&${params.toString()}` : '');
  }
  const hasDiscrepancy = discrepancies.length > 0;
  return <>
    <section className={`recon-card ${hasDiscrepancy ? 'recon-warning' : ''}`}><div className="recon-symbol">{hasDiscrepancy ? '!' : '✓'}</div><div className="recon-copy"><span className="eyebrow">LEDGER RECONCILIATION</span><h2>{reconciliation.loading ? 'Checking ledger…' : hasDiscrepancy ? `${discrepancies.length} discrepancy${discrepancies.length === 1 ? '' : 'ies'} found` : 'Ledger checks passed'}</h2><p>{reconciliation.loading ? 'Comparing posted transactions and account balances.' : hasDiscrepancy ? 'Review the records below. Reconciliation reports only; it does not alter financial data.' : 'Completed entries balance and account projections match the ledger.'}</p></div><button className="button button-outline button-sm" onClick={reconciliation.reload}>↻ Run again</button></section>
    {hasDiscrepancy && <section className="panel discrepancy-panel"><div className="table-scroll"><table><thead><tr><th>Issue</th><th>Record</th><th>Ledger value</th><th>Account value</th></tr></thead><tbody>{discrepancies.map((d, i) => <tr key={`${d.type}-${i}`}><td><StatusPill status="REVIEW" /> <span className="type-label">{titleCase(d.type.replaceAll('_', ' '))}</span></td><td className="mono">{d.transactionId || d.accountId || '—'}</td><td>{d.debitPaise !== undefined ? `${d.debitPaise} debit / ${d.creditPaise} credit paise` : d.ledgerBalancePaise !== undefined ? `${d.ledgerBalancePaise} paise` : '—'}</td><td>{d.balancePaise !== undefined ? `${d.balancePaise} paise` : '—'}</td></tr>)}</tbody></table></div></section>}
    <section className="panel audit-panel"><div className="table-toolbar"><div><span className="eyebrow">SECURITY RECORD</span><h2>Audit log</h2><p>System events, newest first. This view is read-only.</p></div><button className="button button-outline button-sm" onClick={audit.reload}>↻ Refresh</button></div>
      <form className="filter-row" onSubmit={applyFilters}><label>Action<input value={filters.action} onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))} placeholder="e.g. TRANSFER_COMPLETED" /></label><label>User ID<input inputMode="numeric" value={filters.user_id} onChange={(e) => setFilters((f) => ({ ...f, user_id: e.target.value }))} placeholder="Optional" /></label><label>From<input type="datetime-local" value={filters.from} onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))} /></label><label>To<input type="datetime-local" value={filters.to} onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))} /></label><button className="button button-primary button-sm">Apply filters</button></form>
      {audit.loading && !audit.data ? <Loading /> : audit.error ? <Notice message={audit.error} /> : logs.length ? <div className="table-scroll"><table><thead><tr><th>Event</th><th>Actor</th><th>Entity</th><th>Request ID</th><th>Time</th></tr></thead><tbody>{logs.map((log) => <tr key={log.id}><td><span className="audit-action">{titleCase(log.action.replaceAll('_', ' '))}</span><small className="audit-meta">{Object.entries(log.metadata || {}).map(([key, value]) => `${key}: ${value}`).join(' · ') || 'No additional metadata'}</small></td><td>{log.actor_user_id || 'System'}</td><td>{log.entity_type}{log.entity_id ? <small className="audit-meta mono">{log.entity_id}</small> : ''}</td><td className="mono request-id">{log.request_id}</td><td>{formatDate(log.event_timestamp)}</td></tr>)}</tbody></table></div> : <EmptyState title="No audit events found" text="Events matching these filters will appear here." />}
      {audit.data && <div className="pagination"><span>{audit.data.pagination.total} matching event{audit.data.pagination.total === '1' ? '' : 's'}</span><span>Showing up to 50</span></div>}
    </section>
  </>;
}

function titleCase(value) { return value.toLowerCase().replace(/\b\w/g, (letter) => letter.toUpperCase()); }

export default App;
