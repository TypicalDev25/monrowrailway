const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';
const isProduction = process.env.NODE_ENV === 'production';

const FRONTEND_URL = process.env.FRONTEND_URL;
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (origin.includes('localhost') || origin.includes('127.0.0.1')) return callback(null, true);
    const localNetwork = /^https?:\/\/(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)/;
    if (localNetwork.test(origin)) return callback(null, true);
    if (FRONTEND_URL && origin === FRONTEND_URL) return callback(null, true);
    return callback(null, true);
  },
  credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isProduction ? { rejectUnauthorized: false } : false,
  max: 1,
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

const query = (text, params) => pool.query(text, params);

async function initializeDatabase() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        full_name TEXT,
        designation TEXT,
        role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
        is_deleted INTEGER DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS proposals (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES users(id),
        title TEXT NOT NULL,
        description TEXT,
        amount DECIMAL(10,2) NOT NULL,
        category TEXT,
        use_date TEXT NOT NULL,
        month TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        decided_at TIMESTAMP,
        decided_by INTEGER REFERENCES users(id)
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        proposal_id INTEGER REFERENCES proposals(id),
        created_by INTEGER NOT NULL REFERENCES users(id),
        type TEXT NOT NULL CHECK (type IN ('BUDGET', 'EXPENSE', 'INCOME')),
        amount DECIMAL(10,2) NOT NULL,
        description TEXT,
        date TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS deletion_requests (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        requested_by INTEGER NOT NULL REFERENCES users(id),
        approved_by INTEGER REFERENCES users(id),
        status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        decided_at TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS lots (
        id SERIAL PRIMARY KEY,
        address TEXT NOT NULL,
        city_municipality TEXT NOT NULL CHECK (city_municipality IN ('Koronadal City', 'Surallah')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS lot_sales (
        id SERIAL PRIMARY KEY,
        lot_id INTEGER NOT NULL REFERENCES lots(id),
        sold_by INTEGER NOT NULL REFERENCES users(id),
        receipt_no TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        buyer_name TEXT NOT NULL,
        remarks TEXT,
        buying_process TEXT NOT NULL,
        applicant_status TEXT NOT NULL CHECK (applicant_status IN ('New applicant', 'Member')),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    await query(`
      CREATE TABLE IF NOT EXISTS remittances (
        id SERIAL PRIMARY KEY,
        employee_id INTEGER NOT NULL REFERENCES users(id),
        collection TEXT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        date TEXT NOT NULL,
        receipt_no TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables created successfully');

    const adminCheck = await query(`SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_deleted = 0`);
    if (adminCheck.rows[0].count === 0) {
      const passwordHash = bcrypt.hashSync('admin123', 10);
      await query(
        `INSERT INTO users (username, password_hash, full_name, designation, role) VALUES ($1, $2, $3, $4, 'admin')`,
        ['admin', passwordHash, 'Default Admin', 'Koronadal']
      );
      console.log('Seeded default admin user: username=admin, password=admin123');
    }
  } catch (err) {
    console.error('Error initializing database:', err);
  }
}

initializeDatabase();

function generateToken(user) {
  return jwt.sign(
    {
      id: user.id,
      role: user.role,
      username: user.username,
      full_name: user.full_name,
      designation: user.designation,
    },
    JWT_SECRET,
    { expiresIn: '8h' }
  );
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) return res.status(401).json({ message: 'Missing Authorization header' });

  const [scheme, token] = authHeader.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ message: 'Invalid Authorization header' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid or expired token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ message: 'Admin access required' });
  }
  next();
}

// Auth routes
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  try {
    const result = await query(`SELECT * FROM users WHERE username = $1 AND is_deleted = 0`, [username]);
    const user = result.rows[0];

    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const ok = bcrypt.compareSync(password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    const token = generateToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        full_name: user.full_name,
        designation: user.designation,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.post('/api/admin/users', authMiddleware, requireAdmin, async (req, res) => {
  const { username, password, role, full_name, designation } = req.body;
  if (!username || !password || !full_name || !designation) {
    return res.status(400).json({ message: 'Username, password, full name and designation are required' });
  }
  const userRole = role === 'admin' ? 'admin' : 'employee';
  const passwordHash = bcrypt.hashSync(password, 10);

  try {
    const result = await query(
      `INSERT INTO users (username, password_hash, full_name, designation, role) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [username, passwordHash, full_name, designation, userRole]
    );
    res.status(201).json({ id: result.rows[0].id, username, full_name, designation, role: userRole });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(400).json({ message: 'Username already exists' });
    }
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

const PROPOSAL_CATEGORIES = ['Transportation', 'Meals', 'Office Supplies', 'Miscellaneous'];

app.post('/api/proposals', authMiddleware, async (req, res) => {
  if (req.user.role !== 'employee') {
    return res.status(403).json({ message: 'Only employees can create proposals' });
  }
  const { description, amount, category, use_date } = req.body;
  if (!amount || !use_date) {
    return res.status(400).json({ message: 'Amount and date are required' });
  }
  const cat = (category || '').trim();
  if (cat && !PROPOSAL_CATEGORIES.includes(cat)) {
    return res.status(400).json({ message: `Category must be one of: ${PROPOSAL_CATEGORIES.join(', ')}` });
  }
  const title = description ? String(description).slice(0, 200) : 'Budget request';
  const month = use_date.slice(0, 7);
  const now = new Date().toISOString();

  try {
    const result = await query(
      `INSERT INTO proposals (employee_id, title, description, amount, category, use_date, month, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'PENDING', $8, $9) RETURNING *`,
      [req.user.id, title, description || '', amount, cat || '', use_date, month, now, now]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.get('/api/proposals', authMiddleware, async (req, res) => {
  const { status, month } = req.query;
  let baseQuery = `SELECT p.*, u.username as employee_username, u.full_name as employee_full_name, u.designation as employee_designation
                   FROM proposals p
                   JOIN users u ON p.employee_id = u.id`;
  const params = [];
  const where = [];

  if (req.user.role === 'employee') {
    where.push(`p.employee_id = $${params.length + 1}`);
    params.push(req.user.id);
  }
  if (status) {
    where.push(`p.status = $${params.length + 1}`);
    params.push(status.toUpperCase());
  }
  if (month) {
    where.push(`p.month = $${params.length + 1}`);
    params.push(month);
  }
  if (where.length > 0) {
    baseQuery += ' WHERE ' + where.join(' AND ');
  }
  baseQuery += ' ORDER BY p.created_at DESC';

  try {
    const result = await query(baseQuery, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.patch('/api/proposals/:id/status', authMiddleware, requireAdmin, async (req, res) => {
  const { status } = req.body;
  const validStatuses = ['APPROVED', 'REJECTED'];
  if (!validStatuses.includes((status || '').toUpperCase())) {
    return res.status(400).json({ message: 'Status must be APPROVED or REJECTED' });
  }
  const finalStatus = status.toUpperCase();
  const id = req.params.id;
  const now = new Date().toISOString();

  try {
    const updateResult = await query(
      `UPDATE proposals
       SET status = $1, updated_at = $2, decided_at = $3, decided_by = $4
       WHERE id = $5 RETURNING *`,
      [finalStatus, now, now, req.user.id, id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: 'Proposal not found' });
    }

    if (finalStatus === 'APPROVED') {
      const proposal = updateResult.rows[0];
      const txNow = new Date().toISOString();
      await query(
        `INSERT INTO transactions (proposal_id, created_by, type, amount, description, date, created_at)
         VALUES ($1, $2, 'BUDGET', $3, $4, $5, $6)`,
        [
          proposal.id,
          req.user.id,
          proposal.amount,
          `Budget approved: ${proposal.title}`,
          proposal.use_date || proposal.month + '-01',
          txNow,
        ]
      );
    }

    res.json({ message: 'Proposal updated', status: finalStatus });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.post('/api/transactions', authMiddleware, requireAdmin, async (req, res) => {
  const { proposal_id, type, amount, description, date } = req.body;
  if (!type || !amount || !date) {
    return res.status(400).json({ message: 'Type, amount and date are required' });
  }
  const txType = type.toUpperCase();
  const validTypes = ['BUDGET', 'EXPENSE', 'INCOME'];
  if (!validTypes.includes(txType)) {
    return res.status(400).json({ message: 'Invalid transaction type' });
  }
  const now = new Date().toISOString();

  try {
    const result = await query(
      `INSERT INTO transactions (proposal_id, created_by, type, amount, description, date, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [proposal_id || null, req.user.id, txType, amount, description || '', date, now]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.get('/api/transactions', authMiddleware, async (req, res) => {
  const { month, year } = req.query;

  let baseQuery = `SELECT t.*, p.title as proposal_title,
                   emp.full_name as proposed_by_name,
                   approver.full_name as approved_by_name
                   FROM transactions t
                   LEFT JOIN proposals p ON t.proposal_id = p.id
                   LEFT JOIN users emp ON p.employee_id = emp.id
                   LEFT JOIN users approver ON t.created_by = approver.id`;
  const params = [];
  const where = [];

  if (month && year) {
    const monthPadded = String(month).padStart(2, '0');
    where.push(`substr(t.date, 1, 7) = $${params.length + 1}`);
    params.push(`${year}-${monthPadded}`);
  } else if (month) {
    where.push(`substr(t.date, 1, 7) = $${params.length + 1}`);
    params.push(month);
  }

  if (where.length > 0) {
    baseQuery += ' WHERE ' + where.join(' AND ');
  }
  baseQuery += ' ORDER BY t.date DESC';

  try {
    const result = await query(baseQuery, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.get('/api/admin/summary', authMiddleware, requireAdmin, async (req, res) => {
  const { month, year } = req.query;
  let monthKey = null;

  if (month && year) {
    const monthPadded = String(month).padStart(2, '0');
    monthKey = `${year}-${monthPadded}`;
  } else if (month) {
    monthKey = month;
  }

  try {
    const proposalsParams = monthKey ? [monthKey] : [];
    const proposalsQuery = `
      SELECT status, COUNT(*) as count, SUM(amount) as total_amount
      FROM proposals
      ${monthKey ? `WHERE month = $1` : ''}
      GROUP BY status
    `;
    const pRows = (await query(proposalsQuery, proposalsParams)).rows;

    let txQuery = `
      SELECT type, COUNT(*) as count, SUM(amount) as total_amount
      FROM transactions
    `;
    const txWhere = [];
    const txParams = [];
    if (monthKey) {
      txWhere.push(`substr(date, 1, 7) = $${txParams.length + 1}`);
      txParams.push(monthKey);
    }
    if (txWhere.length > 0) {
      txQuery += ' WHERE ' + txWhere.join(' AND ');
    }
    txQuery += ' GROUP BY type';

    const tRows = (await query(txQuery, txParams)).rows;

    res.json({
      month: monthKey,
      proposals: pRows,
      transactions: tRows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.get('/api/admin/users', authMiddleware, requireAdmin, async (req, res) => {
  try {
    const result = await query(
      `SELECT id, username, full_name, designation, role, created_at
       FROM users
       WHERE is_deleted = 0
       ORDER BY created_at DESC`
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.get('/api/admin/performance', authMiddleware, requireAdmin, async (req, res) => {
  const sql = `
    SELECT
      u.id,
      u.username,
      u.full_name,
      u.designation,
      COALESCE(lots.total_lots_sold, 0) AS total_lots_sold,
      COALESCE(expense.total_expense, 0) AS total_expense,
      COALESCE(lots.clients_handled, 0) AS clients_handled
    FROM users u
    LEFT JOIN (
      SELECT sold_by AS employee_id,
             COUNT(*) AS total_lots_sold,
             COUNT(*) AS clients_handled
      FROM lot_sales
      GROUP BY sold_by
    ) lots ON lots.employee_id = u.id
    LEFT JOIN (
      SELECT employee_id,
             SUM(amount) AS total_expense
      FROM proposals
      WHERE status = 'APPROVED'
      GROUP BY employee_id
    ) expense ON expense.employee_id = u.id
    WHERE u.role = 'employee' AND u.is_deleted = 0
    ORDER BY total_lots_sold DESC, total_expense DESC, clients_handled DESC
  `;

  try {
    const result = await query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.patch('/api/admin/users/:id', authMiddleware, requireAdmin, async (req, res) => {
  const id = req.params.id;
  const { full_name, designation } = req.body;

  if (!full_name || !designation) {
    return res.status(400).json({ message: 'Full name and designation are required' });
  }

  try {
    const updateResult = await query(
      `UPDATE users SET full_name = $1, designation = $2 WHERE id = $3 RETURNING id, username, full_name, designation, role, created_at`,
      [full_name, designation, id]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json(updateResult.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.post('/api/admin/users/:id/delete-request', authMiddleware, requireAdmin, async (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  const requestedBy = req.user.id;

  if (Number.isNaN(targetUserId)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  try {
    const userResult = await query(
      `SELECT id, username, role, is_deleted FROM users WHERE id = $1`,
      [targetUserId]
    );

    if (!userResult.rows[0] || userResult.rows[0].is_deleted) {
      return res.status(404).json({ message: 'User not found' });
    }

    const existingResult = await query(
      `SELECT id FROM deletion_requests WHERE user_id = $1 AND status = 'PENDING'`,
      [targetUserId]
    );

    if (existingResult.rows[0]) {
      return res.status(400).json({ message: 'Deletion already pending for this account' });
    }

    const now = new Date().toISOString();
    const insertResult = await query(
      `INSERT INTO deletion_requests (user_id, requested_by, status, created_at)
       VALUES ($1, $2, 'PENDING', $3) RETURNING *`,
      [targetUserId, requestedBy, now]
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.get('/api/admin/deletion-queue', authMiddleware, requireAdmin, async (req, res) => {
  const sql = `
    SELECT
      dr.id,
      dr.user_id,
      u.username as user_username,
      u.full_name as user_full_name,
      u.designation as user_designation,
      u.role as user_role,
      dr.requested_by,
      rb.username as requested_by_username,
      dr.status,
      dr.created_at
    FROM deletion_requests dr
    JOIN users u ON dr.user_id = u.id
    JOIN users rb ON dr.requested_by = rb.id
    WHERE dr.status = 'PENDING'
    ORDER BY dr.created_at ASC
  `;

  try {
    const result = await query(sql);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.patch('/api/admin/deletion-queue/:id/approve', authMiddleware, requireAdmin, async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const approverId = req.user.id;

  if (Number.isNaN(requestId)) {
    return res.status(400).json({ message: 'Invalid request id' });
  }

  try {
    const drResult = await query(
      `SELECT * FROM deletion_requests WHERE id = $1`,
      [requestId]
    );
    const dr = drResult.rows[0];

    if (!dr || dr.status !== 'PENDING') {
      return res.status(404).json({ message: 'Deletion request not found or not pending' });
    }
    if (dr.requested_by === approverId) {
      return res.status(400).json({ message: 'A different admin must approve this deletion' });
    }

    const userResult = await query(
      `SELECT id, role, is_deleted FROM users WHERE id = $1`,
      [dr.user_id]
    );
    const user = userResult.rows[0];

    if (!user || user.is_deleted) {
      return res.status(404).json({ message: 'User not found' });
    }

    if (user.role === 'admin') {
      const countResult = await query(
        `SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_deleted = 0 AND id != $1`,
        [user.id]
      );
      if (!countResult.rows[0] || countResult.rows[0].count === 0) {
        return res.status(400).json({ message: 'Cannot delete the last remaining admin account' });
      }
    }

    const now = new Date().toISOString();
    await query(
      `UPDATE users SET is_deleted = 1 WHERE id = $1`,
      [dr.user_id]
    );
    await query(
      `UPDATE deletion_requests
       SET status = 'APPROVED', approved_by = $1, decided_at = $2
       WHERE id = $3`,
      [approverId, now, requestId]
    );

    res.json({ message: 'Account deleted (soft delete).' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.patch('/api/admin/deletion-queue/:id/reject', authMiddleware, requireAdmin, async (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const approverId = req.user.id;

  if (Number.isNaN(requestId)) {
    return res.status(400).json({ message: 'Invalid request id' });
  }

  try {
    const drResult = await query(
      `SELECT * FROM deletion_requests WHERE id = $1`,
      [requestId]
    );
    const dr = drResult.rows[0];

    if (!dr || dr.status !== 'PENDING') {
      return res.status(404).json({ message: 'Deletion request not found or not pending' });
    }

    const now = new Date().toISOString();
    await query(
      `UPDATE deletion_requests
       SET status = 'REJECTED', approved_by = $1, decided_at = $2
       WHERE id = $3`,
      [approverId, now, requestId]
    );

    res.json({ message: 'Deletion request rejected.' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.patch('/api/admin/users/:id/reset-password', authMiddleware, requireAdmin, async (req, res) => {
  const id = req.params.id;
  const defaultPassword = '123';
  const passwordHash = bcrypt.hashSync(defaultPassword, 10);

  try {
    const result = await query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [passwordHash, id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.json({ message: 'Password reset to default (123).' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.patch('/api/me/password', authMiddleware, async (req, res) => {
  const userId = req.user.id;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Current password and new password are required' });
  }

  try {
    const userResult = await query(
      `SELECT password_hash FROM users WHERE id = $1`,
      [userId]
    );
    const user = userResult.rows[0];

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const ok = bcrypt.compareSync(current_password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const newHash = bcrypt.hashSync(new_password, 10);
    await query(
      `UPDATE users SET password_hash = $1 WHERE id = $2`,
      [newHash, userId]
    );

    res.json({ message: 'Password updated successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

// ----- Lot Sale -----
app.post('/api/lots', authMiddleware, requireAdmin, async (req, res) => {
  const { address, city_municipality } = req.body;
  if (!address || !city_municipality) {
    return res.status(400).json({ message: 'Address and city/municipality are required' });
  }
  const validCities = ['Koronadal City', 'Surallah'];
  if (!validCities.includes(city_municipality)) {
    return res.status(400).json({ message: 'City/municipality must be Koronadal City or Surallah' });
  }
  const now = new Date().toISOString();

  try {
    const result = await query(
      `INSERT INTO lots (address, city_municipality, created_at) VALUES ($1, $2, $3) RETURNING *`,
      [address.trim(), city_municipality, now]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.get('/api/lots', authMiddleware, async (req, res) => {
  const isAdmin = req.user.role === 'admin';
  let sql = `SELECT l.*, ls.id as sale_id, ls.receipt_no, ls.amount as sale_amount, ls.buyer_name, ls.remarks,
             ls.buying_process, ls.applicant_status, ls.created_at as sold_at,
             u.full_name as sold_by_name
             FROM lots l
             LEFT JOIN lot_sales ls ON ls.lot_id = l.id
             LEFT JOIN users u ON ls.sold_by = u.id`;
  const params = [];
  if (!isAdmin) {
    const designation = (req.user.designation || '').trim();
    const city = designation === 'Surallah' ? 'Surallah' : 'Koronadal City';
    sql += ' WHERE l.city_municipality = $1';
    params.push(city);
  }
  sql += ' ORDER BY l.city_municipality, l.address';

  try {
    const result = await query(sql, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.post('/api/lots/:id/sale', authMiddleware, async (req, res) => {
  if (req.user.role !== 'employee') {
    return res.status(403).json({ message: 'Only employees can record lot sales' });
  }
  const lotId = parseInt(req.params.id, 10);
  if (Number.isNaN(lotId)) {
    return res.status(400).json({ message: 'Invalid lot id' });
  }
  const { receipt_no, amount, buyer_name, remarks, buying_process, applicant_status } = req.body;
  if (!receipt_no || amount == null || !buyer_name || !buying_process || !applicant_status) {
    return res.status(400).json({ message: 'Receipt #, amount, buyer name, buying process and status are required' });
  }
  const validStatus = ['New applicant', 'Member'];
  if (!validStatus.includes(applicant_status)) {
    return res.status(400).json({ message: 'Applicant status must be "New applicant" or "Member"' });
  }
  const validProcess = ['Full cash', 'Reservation fee', 'Reservation fee & down payment'];
  if (!validProcess.includes(buying_process)) {
    return res.status(400).json({ message: 'Buying process must be Full cash, Reservation fee, or Reservation fee & down payment' });
  }

  try {
    const lotResult = await query(
      `SELECT id, city_municipality FROM lots WHERE id = $1`,
      [lotId]
    );
    const lot = lotResult.rows[0];

    if (!lot) {
      return res.status(404).json({ message: 'Lot not found' });
    }
    const designation = (req.user.designation || '').trim();
    const allowedCity = designation === 'Surallah' ? 'Surallah' : 'Koronadal City';
    if (lot.city_municipality !== allowedCity) {
      return res.status(403).json({ message: 'You can only record sales for lots in your designation area' });
    }

    const saleResult = await query(
      `SELECT id FROM lot_sales WHERE lot_id = $1`,
      [lotId]
    );
    if (saleResult.rows[0]) {
      return res.status(400).json({ message: 'This lot is already marked as sold' });
    }

    const now = new Date().toISOString();
    const insertResult = await query(
      `INSERT INTO lot_sales (lot_id, sold_by, receipt_no, amount, buyer_name, remarks, buying_process, applicant_status, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [lotId, req.user.id, receipt_no.trim(), parseFloat(amount), buyer_name.trim(), remarks || null, buying_process, applicant_status, now]
    );

    res.status(201).json(insertResult.rows[0]);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.delete('/api/lots/:id', authMiddleware, requireAdmin, async (req, res) => {
  const lotId = parseInt(req.params.id, 10);
  if (Number.isNaN(lotId)) {
    return res.status(400).json({ message: 'Invalid lot id' });
  }

  try {
    await query('DELETE FROM lot_sales WHERE lot_id = $1', [lotId]);
    const deleteResult = await query('DELETE FROM lots WHERE id = $1', [lotId]);

    if (deleteResult.rowCount === 0) {
      return res.status(404).json({ message: 'Lot not found' });
    }

    res.json({ message: 'Lot deleted' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.post('/api/remittances', authMiddleware, async (req, res) => {
  if (req.user.role !== 'employee') {
    return res.status(403).json({ message: 'Only employees can create remittances' });
  }
  const { collection, amount, date, receipt_no } = req.body;
  if (!collection || !amount || !date || !receipt_no) {
    return res.status(400).json({ message: 'Collection, amount, date and receipt number are required' });
  }
  const now = new Date().toISOString();

  try {
    const result = await query(
      `INSERT INTO remittances (employee_id, collection, amount, date, receipt_no, created_at) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [req.user.id, collection, parseFloat(amount), date, receipt_no, now]
    );
    res.json({ id: result.rows[0].id, message: 'Remittance created successfully' });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.get('/api/remittances', authMiddleware, async (req, res) => {
  if (req.user.role !== 'employee') {
    return res.status(403).json({ message: 'Only employees can view remittances' });
  }

  try {
    const result = await query(
      `SELECT * FROM remittances WHERE employee_id = $1 ORDER BY created_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ message: 'Database error' });
  }
});

app.post('/api/reseed-admin', async (req, res) => {
  try {
    const passwordHash = bcrypt.hashSync('admin123', 10);
    await query(
      `INSERT INTO users (username, password_hash, full_name, designation, role)
       VALUES ($1, $2, $3, $4, 'admin')
       ON CONFLICT (username) DO UPDATE SET password_hash = $2, is_deleted = 0`,
      ['admin', passwordHash, 'Default Admin', 'Koronadal']
    );
    res.json({ message: 'Admin reseeded. Login with admin/admin123' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to reseed admin' });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

app.get(/.*/i, (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

if (!process.env.VERCEL) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Backend API listening on http://localhost:${PORT} (and on your network IP for mobile access)`);
  });
}

module.exports = app;
