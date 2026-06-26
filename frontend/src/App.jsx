import React, { useEffect, useState, createContext, useContext } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import axios from 'axios';
import './App.css';

// Use env variable; fallback to relative /api path (works in production)
// For local dev: set VITE_API_URL=http://localhost:4000/api
const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Theme context (light / dark)
const ThemeContext = createContext(null);
function useTheme() {
  return useContext(ThemeContext);
}
function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState(() => {
    try {
      return localStorage.getItem('theme') || 'dark';
    } catch {
      return 'dark';
    }
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try {
      localStorage.setItem('theme', theme);
    } catch (_) {}
  }, [theme]);
  const setTheme = (t) => setThemeState(t === 'light' ? 'light' : 'dark');
  const toggleTheme = () => setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// Export data as CSV (Excel-compatible)
function downloadCSV(filename, rows, headers) {
  const escape = (v) => {
    const s = String(v ?? '');
    if (s.includes(',') || s.includes('"') || s.includes('\n')) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };
  const headerLine = headers.map(escape).join(',');
  const dataLines = rows.map((row) => headers.map((h) => escape(row[h])).join(','));
  const csv = [headerLine, ...dataLines].join('\r\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Simple auth context
const AuthContext = createContext(null);

function useAuth() {
  return useContext(AuthContext);
}

function AuthProvider({ children }) {
  const [user, setUser] = useState(() => {
    const stored = localStorage.getItem('auth');
    return stored ? JSON.parse(stored) : null;
  });

  const login = (data) => {
    setUser(data);
    localStorage.setItem('auth', JSON.stringify(data));
  };

  const logout = () => {
    setUser(null);
    localStorage.removeItem('auth');
  };

  const value = { user, login, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Axios helper with auth
function useApi() {
  const { user } = useAuth();
  const instance = axios.create({
    baseURL: API_BASE,
  });
  instance.interceptors.request.use((config) => {
    if (user?.token) {
      config.headers.Authorization = `Bearer ${user.token}`;
    }
    return config;
  });
  return instance;
}

function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [serverUp, setServerUp] = useState(true);
  const [checking, setChecking] = useState(true);
  const api = axios.create({ baseURL: API_BASE });
  const { login } = useAuth();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();

  // Check if backend server is running before allowing login
  useEffect(() => {
    const checkServer = async () => {
      try {
        setChecking(true);
        await api.get('/health');
        setServerUp(true);
      } catch {
        setServerUp(false);
      } finally {
        setChecking(false);
      }
    };
    checkServer();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!serverUp) {
      setError('Server is down. Please wait for it to start and try again.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const res = await api.post('/auth/login', { username, password });
      login(res.data);
      if (res.data.user.role === 'admin') {
        navigate('/admin');
      } else {
        navigate('/employee');
      }
    } catch (err) {
      setError(err.response?.data?.message || 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app-shell">
      <div className="auth-card">
        <div className="auth-card-header">
          <h1>MoonRow Real Estate</h1>
          <button
            type="button"
            className="secondary theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Light mode' : 'Dark mode'}
            aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
          >
            {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
          </button>
        </div>
        <form onSubmit={handleSubmit} className="form">
          <label>
            Username
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          {(!serverUp || error) && (
            <div className="error">
              {!serverUp
                ? 'Server is down. Please wait for it to run again.'
                : error}
            </div>
          )}
          <button type="submit" disabled={loading || !serverUp || checking}>
            {checking ? 'Checking server...' : loading ? 'Signing in...' : 'Login'}
          </button>
        </form>
      </div>
    </div>
  );
}

function PrivateRoute({ children, role }) {
  const { user } = useAuth();
  if (!user) {
    return <Navigate to="/" replace />;
  }
  if (role && user.user.role !== role) {
    return <Navigate to="/" replace />;
  }
  return children;
}

function AccountDrawer({ open, onClose }) {
  const { user } = useAuth();
  const api = useApi();
  const [activeTab, setActiveTab] = useState('password');
  const [pwForm, setPwForm] = useState({
    current_password: '',
    new_password: '',
    confirm_password: '',
  });
  const [pwMsg, setPwMsg] = useState('');

  if (!open || !user) return null;

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwMsg('');
    if (!pwForm.current_password || !pwForm.new_password) {
      setPwMsg('Please fill in all password fields.');
      return;
    }
    if (pwForm.new_password !== pwForm.confirm_password) {
      setPwMsg('New password and confirmation do not match.');
      return;
    }
    try {
      await api.patch('/me/password', {
        current_password: pwForm.current_password,
        new_password: pwForm.new_password,
      });
      setPwMsg('Password changed successfully.');
      setPwForm({ current_password: '', new_password: '', confirm_password: '' });
    } catch (err) {
      setPwMsg(err.response?.data?.message || 'Failed to change password');
    }
  };

  const info = user.user;

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer" onClick={(e) => e.stopPropagation()}>
        <div className="drawer-header">
          <h3>Account</h3>
          <button className="secondary" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="drawer-tabs">
          <button
            className={activeTab === 'info' ? 'drawer-tab active' : 'drawer-tab'}
            onClick={() => setActiveTab('info')}
          >
            Info
          </button>
          <button
            className={activeTab === 'password' ? 'drawer-tab active' : 'drawer-tab'}
            onClick={() => setActiveTab('password')}
          >
            Password
          </button>
        </div>

        {activeTab === 'info' && (
          <div className="drawer-section">
            <p>
              <strong>Username:</strong> {info.username}
            </p>
            <p>
              <strong>Full name:</strong> {info.full_name || '—'}
            </p>
            <p>
              <strong>Designation:</strong> {info.designation || '—'}
            </p>
            <p>
              <strong>Role:</strong> {info.role}
            </p>
          </div>
        )}

        {activeTab === 'password' && (
          <form className="form" onSubmit={handleChangePassword}>
            <label>
              Current password
              <input
                type="password"
                value={pwForm.current_password}
                onChange={(e) => setPwForm({ ...pwForm, current_password: e.target.value })}
                required
              />
            </label>
            <label>
              New password
              <input
                type="password"
                value={pwForm.new_password}
                onChange={(e) => setPwForm({ ...pwForm, new_password: e.target.value })}
                required
              />
            </label>
            <label>
              Confirm new password
              <input
                type="password"
                value={pwForm.confirm_password}
                onChange={(e) =>
                  setPwForm({ ...pwForm, confirm_password: e.target.value })
                }
                required
              />
            </label>
            <button type="submit">Change Password</button>
            {pwMsg && <p className="hint">{pwMsg}</p>}
          </form>
        )}
      </aside>
    </>
  );
}

function TopBar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { theme, toggleTheme } = useTheme();
  const handleLogout = () => {
    logout();
    navigate('/');
  };
  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <span className="app-title">Budget & Finance Manager</span>
        </div>
        <div className="topbar-right">
          {user && (
            <>
              <button
                type="button"
                className="secondary theme-toggle"
                onClick={toggleTheme}
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
                aria-label={theme === 'dark' ? 'Light mode' : 'Dark mode'}
              >
                {theme === 'dark' ? '☀️ Light' : '🌙 Dark'}
              </button>
              <span className="user-pill">
                {user.user.full_name || user.user.username} (
                {user.user.designation || user.user.role})
              </span>
              <button className="secondary" onClick={() => setDrawerOpen(true)}>
                Account
              </button>
              <button className="secondary" onClick={handleLogout}>
                Logout
              </button>
            </>
          )}
        </div>
      </header>
      <AccountDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </>
  );
}

const PROPOSAL_CATEGORIES = ['Transportation', 'Meals', 'Office Supplies', 'Miscellaneous'];

function EmployeeDashboard() {
  const api = useApi();
  const { user } = useAuth();
  const [empTab, setEmpTab] = useState('proposals');
  const [proposals, setProposals] = useState([]);
  const [loading, setLoading] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState({
    description: '',
    amount: '',
    category: 'Transportation',
    use_date: '',
  });
  const [error, setError] = useState('');
  const [lots, setLots] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [lotViewMode, setLotViewMode] = useState('grid');
  const [saleModalLot, setSaleModalLot] = useState(null);
  const [saleForm, setSaleForm] = useState({
    receipt_no: '',
    amount: '',
    buyer_name: '',
    remarks: '',
    buying_process: 'Full cash',
    applicant_status: 'New applicant',
  });
  const [saleError, setSaleError] = useState('');
  const [remittances, setRemittances] = useState([]);
  const [remittancesLoading, setRemittancesLoading] = useState(false);
  const [remittanceFormOpen, setRemittanceFormOpen] = useState(false);
  const [remittanceForm, setRemittanceForm] = useState({
    collection: '',
    amount: '',
    date: '',
    receipt_no: '',
  });
  const [remittanceError, setRemittanceError] = useState('');

  const loadProposals = async () => {
    setLoading(true);
    try {
      const res = await api.get('/proposals');
      setProposals(res.data);
    } catch (err) {
      setError('Failed to load proposals');
    } finally {
      setLoading(false);
    }
  };

  const loadLots = async () => {
    setLotsLoading(true);
    try {
      const res = await api.get('/lots');
      setLots(res.data);
    } catch (err) {
      setError('Failed to load lots');
    } finally {
      setLotsLoading(false);
    }
  };

  const loadRemittances = async () => {
    setRemittancesLoading(true);
    try {
      const res = await api.get('/remittances');
      setRemittances(res.data);
    } catch (err) {
      setError('Failed to load remittances');
    } finally {
      setRemittancesLoading(false);
    }
  };

  const handleCreateRemittance = async (e) => {
    e.preventDefault();
    setRemittanceError('');
    try {
      await api.post('/remittances', remittanceForm);
      setRemittanceFormOpen(false);
      setRemittanceForm({ collection: '', amount: '', date: '', receipt_no: '' });
      loadRemittances();
    } catch (err) {
      setRemittanceError(err.response?.data?.message || 'Failed to create remittance');
    }
  };

  useEffect(() => {
    loadProposals();
  }, []);

  useEffect(() => {
    if (empTab === 'lots') loadLots();
    if (empTab === 'remittances') loadRemittances();
  }, [empTab]);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    try {
      await api.post('/proposals', {
        ...form,
        amount: parseFloat(form.amount),
      });
      setForm({
        description: '',
        amount: '',
        category: 'Transportation',
        use_date: '',
      });
      setFormOpen(false);
      loadProposals();
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to create proposal');
    }
  };

  const openSaleModal = (lot) => {
    setSaleModalLot(lot);
    setSaleForm({
      receipt_no: '',
      amount: '',
      buyer_name: '',
      remarks: '',
      buying_process: 'Full cash',
      applicant_status: 'New applicant',
    });
    setSaleError('');
  };

  const handleMarkSold = async (e) => {
    e.preventDefault();
    if (!saleModalLot) return;
    setSaleError('');
    try {
      await api.post(`/lots/${saleModalLot.id}/sale`, {
        ...saleForm,
        amount: parseFloat(saleForm.amount),
      });
      setSaleModalLot(null);
      loadLots();
    } catch (err) {
      setSaleError(err.response?.data?.message || 'Failed to record sale');
    }
  };

  return (
    <div className="page">
      <TopBar />
      <main className="content">
        <div className="tabs">
          <button
            className={empTab === 'proposals' ? 'tab active' : 'tab'}
            onClick={() => setEmpTab('proposals')}
          >
            Your Budget Proposals
          </button>
          <button
            className={empTab === 'remittances' ? 'tab active' : 'tab'}
            onClick={() => setEmpTab('remittances')}
          >
            Remittance Collection Records
          </button>
          <button
            className={empTab === 'lots' ? 'tab active' : 'tab'}
            onClick={() => setEmpTab('lots')}
          >
            Report Overview
          </button>
        </div>

        {empTab === 'proposals' && (
          <>
            <div className="section-header">
              <h2>Your Budget Proposals</h2>
              <div className="button-group">
                <button onClick={() => setFormOpen(true)}>New Proposal</button>
              </div>
            </div>
            {error && <div className="error">{error}</div>}
            {loading ? (
              <p>Loading...</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Date Needed</th>
                      <th>Amount</th>
                      <th>Category</th>
                      <th>Status</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {proposals.map((p) => (
                      <tr key={p.id}>
                        <td>{p.use_date ? new Date(p.use_date).toLocaleDateString() : '-'}</td>
                        <td>₱{Number(p.amount).toFixed(2)}</td>
                        <td>{p.category || '-'}</td>
                        <td>
                          <span className={`status-pill status-${p.status.toLowerCase()}`}>
                            {p.status}
                          </span>
                        </td>
                        <td>{new Date(p.created_at).toLocaleDateString()}</td>
                      </tr>
                    ))}
                    {proposals.length === 0 && (
                      <tr>
                        <td colSpan="5" style={{ textAlign: 'center' }}>
                          No proposals yet. Create your first one!
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {formOpen && (
              <div className="modal-backdrop" onClick={() => setFormOpen(false)}>
                <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <h3>New Budget Proposal</h3>
                  <form className="form" onSubmit={handleCreate}>
                    <label>
                      Description
                      <textarea
                        value={form.description}
                        onChange={(e) => setForm({ ...form, description: e.target.value })}
                      />
                    </label>
                    <label>
                      Amount (Philippine Peso)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={form.amount}
                        onChange={(e) => setForm({ ...form, amount: e.target.value })}
                        required
                      />
                    </label>
                    <label>
                      Category
                      <select
                        value={form.category}
                        onChange={(e) => setForm({ ...form, category: e.target.value })}
                        required
                      >
                        {PROPOSAL_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Date when funds will be used
                      <input
                        type="date"
                        value={form.use_date}
                        onChange={(e) => setForm({ ...form, use_date: e.target.value })}
                        required
                      />
                    </label>
                    <div className="modal-actions">
                      <button type="button" className="secondary" onClick={() => setFormOpen(false)}>
                        Cancel
                      </button>
                      <button type="submit">Submit</button>
                    </div>
                  </form>
                </div>
              </div>
            )}

            {remittanceFormOpen && (
              <div className="modal-backdrop" onClick={() => setRemittanceFormOpen(false)}>
                <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <h3>Add Remittance</h3>
                  <form className="form" onSubmit={handleCreateRemittance}>
                    <label>
                      Collection
                      <input
                        type="text"
                        value={remittanceForm.collection}
                        onChange={(e) => setRemittanceForm({ ...remittanceForm, collection: e.target.value })}
                        required
                      />
                    </label>
                    <label>
                      Amount (Philippine Peso)
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={remittanceForm.amount}
                        onChange={(e) => setRemittanceForm({ ...remittanceForm, amount: e.target.value })}
                        required
                      />
                    </label>
                    <label>
                      Date
                      <input
                        type="date"
                        value={remittanceForm.date}
                        onChange={(e) => setRemittanceForm({ ...remittanceForm, date: e.target.value })}
                        required
                      />
                    </label>
                    <label>
                      Receipt #
                      <input
                        type="text"
                        value={remittanceForm.receipt_no}
                        onChange={(e) => setRemittanceForm({ ...remittanceForm, receipt_no: e.target.value })}
                        required
                      />
                    </label>
                    {remittanceError && <div className="error">{remittanceError}</div>}
                    <div className="modal-actions">
                      <button type="button" className="secondary" onClick={() => setRemittanceFormOpen(false)}>
                        Cancel
                      </button>
                      <button type="submit">Submit</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </>
        )}

        {empTab === 'remittances' && (
          <>
            <div className="section-header">
              <h2>Remittance Collection Records</h2>
              <button onClick={() => setRemittanceFormOpen(true)}>Add Remittance</button>
            </div>
            {error && <div className="error">{error}</div>}
            {remittancesLoading ? (
              <p>Loading...</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Collection</th>
                      <th>Amount</th>
                      <th>Date</th>
                      <th>Receipt #</th>
                      <th>Created</th>
                    </tr>
                  </thead>
                  <tbody>
                    {remittances.map((r) => (
                      <tr key={r.id}>
                        <td>{r.collection}</td>
                        <td>₱{r.amount.toFixed(2)}</td>
                        <td>{r.date ? new Date(r.date).toLocaleDateString() : '-'}</td>
                        <td>{r.receipt_no}</td>
                        <td>{r.created_at ? new Date(r.created_at).toLocaleDateString() : '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {remittances.length === 0 && (
                  <div className="empty-state">
                    <p>No remittance records found.</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {empTab === 'lots' && (
          <>
            <div className="section-header">
              <h2>Report Overview</h2>
              <div className="lot-view-toggle">
                <span className="hint">View:</span>
                <button
                  type="button"
                  className={lotViewMode === 'table' ? 'tab active' : 'tab'}
                  onClick={() => setLotViewMode('table')}
                >
                  Table
                </button>
                <button
                  type="button"
                  className={lotViewMode === 'grid' ? 'tab active' : 'tab'}
                  onClick={() => setLotViewMode('grid')}
                >
                  Grid
                </button>
              </div>
            </div>
            <p className="hint">Lots in your designation ({user?.user?.designation || '-'}). Click a lot to mark as sold.</p>
            {lotsLoading ? (
              <p>Loading lots...</p>
            ) : lotViewMode === 'table' ? (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th className="th-nowrap">Address</th>
                      <th className="th-nowrap">City/Municipality</th>
                      <th className="th-nowrap">Status</th>
                      <th className="th-nowrap">Receipt#</th>
                      <th className="th-nowrap">Amount</th>
                      <th className="th-nowrap">Buyer</th>
                      <th className="th-nowrap">Process</th>
                      <th className="th-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((lot) => (
                      <tr key={lot.id} className={lot.sale_id ? 'lot-row-sold' : ''}>
                        <td>{lot.address}</td>
                        <td>{lot.city_municipality}</td>
                        <td>{lot.sale_id ? 'Sold' : 'Available'}</td>
                        <td>{lot.receipt_no || '—'}</td>
                        <td>{lot.sale_id ? `₱${Number(lot.sale_amount).toFixed(2)}` : '—'}</td>
                        <td>{lot.buyer_name || '—'}</td>
                        <td>{lot.sale_id ? `${lot.buying_process} · ${lot.applicant_status}` : '—'}</td>
                        <td>
                          {!lot.sale_id && (
                            <button type="button" className="secondary" onClick={() => openSaleModal(lot)}>
                              Mark sold
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {lots.length === 0 && (
                      <tr>
                        <td colSpan="8" style={{ textAlign: 'center' }}>No lots in your area.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="lot-grid">
                {lots.map((lot) => (
                  <div
                    key={lot.id}
                    className={`lot-card ${lot.sale_id ? 'lot-sold' : ''}`}
                    onClick={() => !lot.sale_id && openSaleModal(lot)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === 'Enter' && !lot.sale_id && openSaleModal(lot)}
                  >
                    <div className="lot-address">{lot.address}</div>
                    <div className="lot-city">{lot.city_municipality}</div>
                    {lot.sale_id ? (
                      <div className="lot-sale-info">
                        <div>Receipt: {lot.receipt_no}</div>
                        <div>₱{Number(lot.sale_amount).toFixed(2)}</div>
                        <div>{lot.buyer_name}</div>
                        <div>{lot.buying_process} · {lot.applicant_status}</div>
                      </div>
                    ) : (
                      <div className="lot-available">Available — click to mark sold</div>
                    )}
                  </div>
                ))}
                {lots.length === 0 && <p className="hint">No lots in your area.</p>}
              </div>
            )}

            {saleModalLot && (
              <div className="modal-backdrop" onClick={() => setSaleModalLot(null)}>
                <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <h3>Mark as sold: {saleModalLot.address}</h3>
                  <form className="form" onSubmit={handleMarkSold}>
                    <label>Receipt # <input type="text" value={saleForm.receipt_no} onChange={(e) => setSaleForm({ ...saleForm, receipt_no: e.target.value })} required /></label>
                    <label>Amount (₱) <input type="number" min="0" step="0.01" value={saleForm.amount} onChange={(e) => setSaleForm({ ...saleForm, amount: e.target.value })} required /></label>
                    <label>Buyer&apos;s name <input type="text" value={saleForm.buyer_name} onChange={(e) => setSaleForm({ ...saleForm, buyer_name: e.target.value })} required /></label>
                    <label>Remarks (optional) <input type="text" value={saleForm.remarks} onChange={(e) => setSaleForm({ ...saleForm, remarks: e.target.value })} /></label>
                    <label>
                      Buying process
                      <select value={saleForm.buying_process} onChange={(e) => setSaleForm({ ...saleForm, buying_process: e.target.value })} required>
                        <option value="Full cash">Full cash</option>
                        <option value="Reservation fee">Reservation fee (pending down payment balance)</option>
                        <option value="Reservation fee & down payment">Reservation fee & down payment (monthly payment)</option>
                      </select>
                    </label>
                    <label>
                      Status
                      <select value={saleForm.applicant_status} onChange={(e) => setSaleForm({ ...saleForm, applicant_status: e.target.value })} required>
                        <option value="New applicant">New applicant</option>
                        <option value="Member">Member</option>
                      </select>
                    </label>
                    {saleError && <div className="error">{saleError}</div>}
                    <div className="modal-actions">
                      <button type="button" className="secondary" onClick={() => setSaleModalLot(null)}>Cancel</button>
                      <button type="submit">Save</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}

function AdminDashboard() {
  const api = useApi();
  const [tab, setTab] = useState('proposals');
  const [proposals, setProposals] = useState([]);
  const [txs, setTxs] = useState([]);
  const [filters, setFilters] = useState({ month: '', year: '' });
  const [userForm, setUserForm] = useState({
    username: '',
    password: '',
    full_name: '',
    designation: 'Koronadal',
    role: 'employee',
  });
  const [userMsg, setUserMsg] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [accountsMsg, setAccountsMsg] = useState('');
  const [deletionQueue, setDeletionQueue] = useState([]);
  const [queueMsg, setQueueMsg] = useState('');
  const [editingAccount, setEditingAccount] = useState(null);
  const [lots, setLots] = useState([]);
  const [lotsLoading, setLotsLoading] = useState(false);
  const [addLotOpen, setAddLotOpen] = useState(false);
  const [lotForm, setLotForm] = useState({ address: '', city_municipality: 'Koronadal City' });
  const [lotMsg, setLotMsg] = useState('');
  const [lotViewMode, setLotViewMode] = useState('grid');
  const [performance, setPerformance] = useState([]);
  const [performanceLoading, setPerformanceLoading] = useState(false);

  const loadProposals = async () => {
    const res = await api.get('/proposals');
    setProposals(res.data);
  };

  const loadTransactions = async () => {
    const params = {};
    if (filters.month) params.month = filters.month;
    if (filters.year) params.year = filters.year;
    const res = await api.get('/transactions', { params });
    setTxs(res.data);
  };

  const loadAccounts = async () => {
    try {
      const res = await api.get('/admin/users');
      setAccounts(res.data);
    } catch (err) {
      setAccountsMsg('Failed to load accounts');
    }
  };

  const loadDeletionQueue = async () => {
    try {
      const res = await api.get('/admin/deletion-queue');
      setDeletionQueue(res.data);
    } catch (err) {
      setQueueMsg('Failed to load deletion queue');
    }
  };

  const loadLots = async () => {
    setLotsLoading(true);
    try {
      const res = await api.get('/lots');
      setLots(res.data);
    } catch (err) {
      setLotMsg('Failed to load lots');
    } finally {
      setLotsLoading(false);
    }
  };

  useEffect(() => {
    loadProposals();
    loadAccounts();
    loadDeletionQueue();
  }, []);

  useEffect(() => {
    if (tab === 'transactions') {
      loadTransactions();
    }
  }, [tab, filters.month, filters.year]);

  useEffect(() => {
    if (tab === 'lots') loadLots();
  }, [tab]);

  const loadPerformance = async () => {
    setPerformanceLoading(true);
    try {
      const res = await api.get('/admin/performance');
      setPerformance(res.data);
    } catch (err) {
      setLotMsg(err.response?.data?.message || 'Failed to load performance');
    } finally {
      setPerformanceLoading(false);
    }
  };

  useEffect(() => {
    if (tab === 'performance') loadPerformance();
  }, [tab]);

  const handleAddLot = async (e) => {
    e.preventDefault();
    setLotMsg('');
    try {
      await api.post('/lots', lotForm);
      setLotForm({ address: '', city_municipality: 'Koronadal City' });
      setAddLotOpen(false);
      loadLots();
    } catch (err) {
      setLotMsg(err.response?.data?.message || 'Failed to add lot');
    }
  };

  const handleDeleteLot = async (lotId, address) => {
    if (!window.confirm(`Delete lot "${address}"? This cannot be undone.`)) return;
    setLotMsg('');
    try {
      await api.delete(`/lots/${lotId}`);
      loadLots();
    } catch (err) {
      setLotMsg(err.response?.data?.message || 'Failed to delete lot');
    }
  };

  const handleStatusChange = async (id, status) => {
    await api.patch(`/proposals/${id}/status`, { status });
    loadProposals();
    if (tab === 'transactions') {
      loadTransactions();
    }
  };

  const handleCreateUser = async (e) => {
    e.preventDefault();
    setUserMsg('');
    try {
      const res = await api.post('/admin/users', userForm);
      setUserMsg(
        `Created user ${res.data.username} (${res.data.full_name}, ${res.data.designation}) as ${res.data.role}`
      );
      setUserForm({
        username: '',
        password: '',
        full_name: '',
        designation: 'Koronadal',
        role: 'employee',
      });
      loadAccounts();
    } catch (err) {
      setUserMsg(err.response?.data?.message || 'Failed to create user');
    }
  };

  const handleResetPassword = async (id) => {
    setAccountsMsg('');
    try {
      const res = await api.patch(`/admin/users/${id}/reset-password`);
      setAccountsMsg(res.data?.message || 'Password reset.');
      loadAccounts();
    } catch (err) {
      setAccountsMsg(err.response?.data?.message || 'Failed to reset password');
    }
  };

  const handleEditAccountClick = (u) => {
    setEditingAccount({
      id: u.id,
      full_name: u.full_name || '',
      designation: u.designation || 'Koronadal',
    });
  };

  const handleUpdateAccount = async (e) => {
    e.preventDefault();
    if (!editingAccount) return;
    setAccountsMsg('');
    try {
      await api.patch(`/admin/users/${editingAccount.id}`, {
        full_name: editingAccount.full_name,
        designation: editingAccount.designation,
      });
      setAccountsMsg('Account details updated.');
      setEditingAccount(null);
      loadAccounts();
    } catch (err) {
      setAccountsMsg(err.response?.data?.message || 'Failed to update account');
    }
  };

  const handleRequestDelete = async (u) => {
    setQueueMsg('');
    try {
      const res = await api.post(`/admin/users/${u.id}/delete-request`);
      setQueueMsg(res.data?.message || 'Deletion request created.');
      loadDeletionQueue();
    } catch (err) {
      setQueueMsg(err.response?.data?.message || 'Failed to request deletion');
    }
  };

  const handleApproveDeletion = async (id) => {
    setQueueMsg('');
    try {
      const res = await api.patch(`/admin/deletion-queue/${id}/approve`);
      setQueueMsg(res.data?.message || 'Deletion approved.');
      loadDeletionQueue();
      loadAccounts();
    } catch (err) {
      setQueueMsg(err.response?.data?.message || 'Failed to approve deletion');
    }
  };

  const handleRejectDeletion = async (id) => {
    setQueueMsg('');
    try {
      const res = await api.patch(`/admin/deletion-queue/${id}/reject`);
      setQueueMsg(res.data?.message || 'Deletion request rejected.');
      loadDeletionQueue();
    } catch (err) {
      setQueueMsg(err.response?.data?.message || 'Failed to reject deletion');
    }
  };

  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const years = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear - 3; y <= currentYear + 1; y++) years.push(y);

  return (
    <div className="page">
      <TopBar />
      <main className="content">
        <div className="section-header">
          <h2>Admin Dashboard</h2>
        </div>

        <div className="tabs">
          <button
            className={tab === 'proposals' ? 'tab active' : 'tab'}
            onClick={() => setTab('proposals')}
          >
            Budget proposals
          </button>
          <button
            className={tab === 'transactions' ? 'tab active' : 'tab'}
            onClick={() => setTab('transactions')}
          >
            Transactions
          </button>
          <button
            className={tab === 'accounts' ? 'tab active' : 'tab'}
            onClick={() => setTab('accounts')}
          >
            Registered accounts
          </button>
          <button
            className={tab === 'create' ? 'tab active' : 'tab'}
            onClick={() => setTab('create')}
          >
            Create account
          </button>
          <button
            className={tab === 'lots' ? 'tab active' : 'tab'}
            onClick={() => setTab('lots')}
          >
            Report Overview
          </button>
          <button
            className={tab === 'performance' ? 'tab active' : 'tab'}
            onClick={() => setTab('performance')}
          >
            Best Performing
          </button>
        </div>

        {tab === 'performance' && (
          <section className="card">
            <h3>Best Performing Employee</h3>
            <p className="hint">Ranked by total lots sold, total expense (approved proposals), and clients handled.</p>
            {performanceLoading ? (
              <p>Loading...</p>
            ) : (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th>Rank</th>
                      <th>Employee</th>
                      <th>Designation</th>
                      <th className="th-nowrap">Lots sold</th>
                      <th className="th-nowrap">Total expense (₱)</th>
                      <th className="th-nowrap">Clients handled</th>
                    </tr>
                  </thead>
                  <tbody>
                    {performance.map((emp, idx) => (
                      <tr key={emp.id} className={idx === 0 ? 'performance-top' : ''}>
                        <td>{idx + 1}</td>
                        <td>{emp.full_name || emp.username}</td>
                        <td>{emp.designation || '—'}</td>
                        <td>{emp.total_lots_sold ?? 0}</td>
                        <td>₱{Number(emp.total_expense || 0).toFixed(2)}</td>
                        <td>{emp.clients_handled ?? 0}</td>
                      </tr>
                    ))}
                    {performance.length === 0 && !performanceLoading && (
                      <tr>
                        <td colSpan="6" style={{ textAlign: 'center' }}>No employee data yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}

        {tab === 'lots' && (
          <section className="card">
            <h3>Report Overview</h3>
            <div className="section-header">
              <div className="lot-view-toggle">
                <span className="hint">View:</span>
                <button
                  type="button"
                  className={lotViewMode === 'table' ? 'tab active' : 'tab'}
                  onClick={() => setLotViewMode('table')}
                >
                  Table
                </button>
                <button
                  type="button"
                  className={lotViewMode === 'grid' ? 'tab active' : 'tab'}
                  onClick={() => setLotViewMode('grid')}
                >
                  Grid
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    const headers = ['Address', 'City/Municipality', 'Status', 'Receipt No', 'Amount', 'Buyer', 'Process', 'Applicant Status', 'Recorded By'];
                    const rows = lots.map((l) => ({
                      'Address': l.address,
                      'City/Municipality': l.city_municipality,
                      'Status': l.sale_id ? 'Sold' : 'Available',
                      'Receipt No': l.receipt_no || '',
                      'Amount': l.sale_id ? Number(l.sale_amount) : '',
                      'Buyer': l.buyer_name || '',
                      'Process': l.buying_process || '',
                      'Applicant Status': l.applicant_status || '',
                      'Recorded By': l.sold_by_name || '',
                    }));
                    downloadCSV(`report-overview-${new Date().toISOString().slice(0, 10)}.csv`, rows, headers);
                  }}
                  disabled={lots.length === 0}
                >
                  Export to Excel
                </button>
                <button onClick={() => { setLotMsg(''); setAddLotOpen(true); }}>Add Lot</button>
              </div>
            </div>
            <p className="hint">All lots. Sold lots show sale details.</p>
            {lotMsg && <div className="error">{lotMsg}</div>}
            {lotsLoading ? (
              <p>Loading lots...</p>
            ) : lotViewMode === 'table' ? (
              <div className="table-wrapper">
                <table>
                  <thead>
                    <tr>
                      <th className="th-nowrap">Address</th>
                      <th className="th-nowrap">City/Municipality</th>
                      <th className="th-nowrap">Status</th>
                      <th className="th-nowrap">Receipt#</th>
                      <th className="th-nowrap">Amount</th>
                      <th className="th-nowrap">Buyer</th>
                      <th className="th-nowrap">Process</th>
                      <th className="th-nowrap">Recorded by</th>
                      <th className="th-nowrap">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lots.map((lot) => (
                      <tr key={lot.id} className={lot.sale_id ? 'lot-row-sold' : ''}>
                        <td>{lot.address}</td>
                        <td>{lot.city_municipality}</td>
                        <td>{lot.sale_id ? 'Sold' : 'Available'}</td>
                        <td>{lot.receipt_no || '—'}</td>
                        <td>{lot.sale_id ? `₱${Number(lot.sale_amount).toFixed(2)}` : '—'}</td>
                        <td>{lot.buyer_name || '—'}</td>
                        <td>{lot.sale_id ? `${lot.buying_process} · ${lot.applicant_status}` : '—'}</td>
                        <td>{lot.sold_by_name || '—'}</td>
                        <td>
                          <button type="button" className="danger" onClick={() => handleDeleteLot(lot.id, lot.address)}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    ))}
                    {lots.length === 0 && !lotsLoading && (
                      <tr>
                        <td colSpan="9" style={{ textAlign: 'center' }}>No lots yet. Add one above.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="lot-grid">
                {lots.map((lot) => (
                  <div key={lot.id} className={`lot-card ${lot.sale_id ? 'lot-sold' : ''}`}>
                    <div className="lot-card-actions">
                      <button type="button" className="danger lot-delete-btn" onClick={() => handleDeleteLot(lot.id, lot.address)} title="Delete lot">
                        Delete
                      </button>
                    </div>
                    <div className="lot-address">{lot.address}</div>
                    <div className="lot-city">{lot.city_municipality}</div>
                    {lot.sale_id ? (
                      <div className="lot-sale-info">
                        <div><strong>Receipt:</strong> {lot.receipt_no}</div>
                        <div><strong>Amount:</strong> ₱{Number(lot.sale_amount).toFixed(2)}</div>
                        <div><strong>Buyer:</strong> {lot.buyer_name}</div>
                        <div><strong>Process:</strong> {lot.buying_process} · {lot.applicant_status}</div>
                        {lot.sold_by_name && <div className="hint">Recorded by {lot.sold_by_name}</div>}
                      </div>
                    ) : (
                      <div className="lot-available">Available</div>
                    )}
                  </div>
                ))}
                {lots.length === 0 && !lotsLoading && <p className="hint">No lots yet. Add one above.</p>}
              </div>
            )}

            {addLotOpen && (
              <div className="modal-backdrop" onClick={() => setAddLotOpen(false)}>
                <div className="modal" onClick={(e) => e.stopPropagation()}>
                  <h3>Add Lot</h3>
                  <form className="form" onSubmit={handleAddLot}>
                    <label>Address <input type="text" value={lotForm.address} onChange={(e) => setLotForm({ ...lotForm, address: e.target.value })} required /></label>
                    <label>
                      City / Municipality
                      <select value={lotForm.city_municipality} onChange={(e) => setLotForm({ ...lotForm, city_municipality: e.target.value })} required>
                        <option value="Koronadal City">Koronadal City</option>
                        <option value="Surallah">Surallah</option>
                      </select>
                    </label>
                    {lotMsg && <div className="error">{lotMsg}</div>}
                    <div className="modal-actions">
                      <button type="button" className="secondary" onClick={() => setAddLotOpen(false)}>Cancel</button>
                      <button type="submit">Add Lot</button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === 'accounts' && (
          <section className="card">
            <h3>Registered Accounts</h3>
            {accountsMsg && <p className="hint">{accountsMsg}</p>}
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Full name</th>
                    <th>Designation</th>
                    <th>Account type</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((u) => (
                    <React.Fragment key={u.id}>
                      <tr>
                        <td>{u.username}</td>
                        <td>{u.full_name}</td>
                        <td>{u.designation}</td>
                        <td>{u.role === 'admin' ? 'Admin' : 'Employee'}</td>
                        <td>
                          <div className="button-group">
                        <button
                          className="secondary"
                          onClick={() => handleEditAccountClick(u)}
                        >
                          Edit
                        </button>
                            <button
                              className="secondary"
                          onClick={() => handleResetPassword(u.id)}
                            >
                              Reset password to 123
                        </button>
                        <button
                          className="danger"
                          onClick={() => handleRequestDelete(u)}
                        >
                          Request delete
                            </button>
                          </div>
                        </td>
                      </tr>
                      {editingAccount && editingAccount.id === u.id && (
                        <tr>
                          <td colSpan="5">
                            <form className="form" onSubmit={handleUpdateAccount}>
                              <label>
                                Full name
                                <input
                                  type="text"
                                  value={editingAccount.full_name}
                                  onChange={(e) =>
                                    setEditingAccount({
                                      ...editingAccount,
                                      full_name: e.target.value,
                                    })
                                  }
                                  required
                                />
                              </label>
                              <label>
                                Designation
                                <select
                                  value={editingAccount.designation}
                                  onChange={(e) =>
                                    setEditingAccount({
                                      ...editingAccount,
                                      designation: e.target.value,
                                    })
                                  }
                                  required
                                >
                                  <option value="Koronadal">Koronadal</option>
                                  <option value="Surallah">Surallah</option>
                                </select>
                              </label>
                              <div className="button-group">
                                <button
                                  type="button"
                                  className="secondary"
                                  onClick={() => setEditingAccount(null)}
                                >
                                  Cancel
                                </button>
                                <button type="submit">Save</button>
                              </div>
                            </form>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  ))}
                  {accounts.length === 0 && (
                    <tr>
                      <td colSpan="5" style={{ textAlign: 'center' }}>
                        No accounts found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

          <div style={{ marginTop: '1.25rem' }}>
            <h4>Deletion queue (requires second admin)</h4>
            {queueMsg && <p className="hint">{queueMsg}</p>}
            <div className="table-wrapper" style={{ marginTop: '0.5rem' }}>
              <table>
                <thead>
                  <tr>
                    <th>Username</th>
                    <th>Full name</th>
                    <th>Designation</th>
                    <th>Requested by</th>
                    <th>Requested at</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {deletionQueue.map((r) => (
                    <tr key={r.id}>
                      <td>{r.user_username}</td>
                      <td>{r.user_full_name}</td>
                      <td>{r.user_designation}</td>
                      <td>{r.requested_by_username}</td>
                      <td>{new Date(r.created_at).toLocaleString()}</td>
                      <td>
                        <div className="button-group">
                          <button
                            className="success"
                            onClick={() => handleApproveDeletion(r.id)}
                          >
                            Approve
                          </button>
                          <button
                            className="secondary"
                            onClick={() => handleRejectDeletion(r.id)}
                          >
                            Reject
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {deletionQueue.length === 0 && (
                    <tr>
                      <td colSpan="6" style={{ textAlign: 'center' }}>
                        No pending deletions.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
          </section>
        )}

        {tab === 'create' && (
          <section className="card">
            <h3>Create User Account</h3>
            <form className="form" onSubmit={handleCreateUser}>
              <label>
                Username
                <input
                  type="text"
                  value={userForm.username}
                  onChange={(e) => setUserForm({ ...userForm, username: e.target.value })}
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  value={userForm.password}
                  onChange={(e) => setUserForm({ ...userForm, password: e.target.value })}
                  required
                />
              </label>
              <label>
                Full name
                <input
                  type="text"
                  value={userForm.full_name}
                  onChange={(e) => setUserForm({ ...userForm, full_name: e.target.value })}
                  required
                />
              </label>
              <label>
                Designation
                <select
                  value={userForm.designation}
                  onChange={(e) => setUserForm({ ...userForm, designation: e.target.value })}
                  required
                >
                  <option value="Koronadal">Koronadal</option>
                  <option value="Surallah">Surallah</option>
                </select>
              </label>
              <label>
                Role
                <select
                  value={userForm.role}
                  onChange={(e) => setUserForm({ ...userForm, role: e.target.value })}
                >
                  <option value="employee">Employee</option>
                  <option value="admin">Admin</option>
                </select>
              </label>
              <button type="submit">Create User</button>
              {userMsg && <p className="hint">{userMsg}</p>}
            </form>
          </section>
        )}

        {tab === 'proposals' && (
          <section className="card">
            <h3>All Budget Proposals</h3>
            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Employee</th>
                    <th>Designation</th>
                    <th>Date Needed</th>
                    <th>Amount</th>
                    <th>Category</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map((p) => (
                    <tr key={p.id}>
                      <td>{p.title}</td>
                      <td>{p.employee_full_name || p.employee_username}</td>
                      <td>{p.employee_designation || '-'}</td>
                      <td>{p.use_date ? new Date(p.use_date).toLocaleDateString() : '-'}</td>
                      <td>₱{Number(p.amount).toFixed(2)}</td>
                      <td>{p.category}</td>
                      <td>
                        <span className={`status-pill status-${p.status.toLowerCase()}`}>
                          {p.status}
                        </span>
                      </td>
                      <td>
                        {p.status === 'PENDING' && (
                          <div className="button-group">
                            <button
                              className="success"
                              onClick={() => handleStatusChange(p.id, 'APPROVED')}
                            >
                              Approve
                            </button>
                            <button
                              className="danger"
                              onClick={() => handleStatusChange(p.id, 'REJECTED')}
                            >
                              Reject
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                  {proposals.length === 0 && (
                    <tr>
                      <td colSpan="8" style={{ textAlign: 'center' }}>
                        No proposals yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {tab === 'transactions' && (
          <section className="card">
            <h3>Transactions</h3>
            <div className="form inline-form" style={{ marginBottom: '0.75rem' }}>
              <label>
                Month
                <select
                  value={filters.month}
                  onChange={(e) => setFilters({ ...filters, month: e.target.value })}
                >
                  <option value="">Any</option>
                  {months.map((m) => {
                    const date = new Date(2000, m - 1, 1);
                    const label = date.toLocaleString(undefined, { month: 'long' });
                    return (
                      <option key={m} value={m}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label>
                Year
                <select
                  value={filters.year}
                  onChange={(e) => setFilters({ ...filters, year: e.target.value })}
                >
                  <option value="">Any</option>
                  {years.map((y) => (
                    <option key={y} value={y}>
                      {y}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="hint">Filter the transactions list by month and year.</p>
            <div className="section-header" style={{ marginTop: '0.5rem' }}>
              <span />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const headers = ['Date', 'Type', 'Amount', 'Description', 'Proposal', 'Proposed By', 'Approved By'];
                  const rows = txs.map((t) => ({
                    Date: new Date(t.date).toLocaleDateString(),
                    Type: t.type,
                    Amount: t.amount,
                    Description: t.description || '',
                    Proposal: t.proposal_title || '',
                    'Proposed By': t.proposed_by_name || '',
                    'Approved By': t.approved_by_name || '',
                  }));
                  downloadCSV(`transactions-${new Date().toISOString().slice(0, 10)}.csv`, rows, headers);
                }}
                disabled={txs.length === 0}
              >
                Export to Excel
              </button>
            </div>

            <div className="table-wrapper">
              <table>
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Amount (₱)</th>
                    <th>Description</th>
                    <th>Proposal</th>
                    <th>Proposed By</th>
                    <th>Approved By</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((t) => (
                    <tr key={t.id}>
                      <td>{new Date(t.date).toLocaleDateString()}</td>
                      <td>{t.type}</td>
                      <td>₱{t.amount.toFixed(2)}</td>
                      <td>{t.description}</td>
                      <td>{t.proposal_title || '-'}</td>
                      <td>{t.proposed_by_name || '-'}</td>
                      <td>{t.approved_by_name || '-'}</td>
                    </tr>
                  ))}
                  {txs.length === 0 && (
                    <tr>
                      <td colSpan="7" style={{ textAlign: 'center' }}>
                        No transactions for selected period.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <Router>
          <Routes>
            <Route path="/" element={<LoginPage />} />
            <Route
              path="/employee"
              element={
                <PrivateRoute role="employee">
                  <EmployeeDashboard />
                </PrivateRoute>
              }
            />
            <Route
              path="/admin"
              element={
                <PrivateRoute role="admin">
                  <AdminDashboard />
                </PrivateRoute>
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Router>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
