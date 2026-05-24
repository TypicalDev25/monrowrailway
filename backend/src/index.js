const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 4000;
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-key-change-me';

// Middleware – allow same-network access (e.g. mobile on WiFi)
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

// SQLite setup
const dbPath = path.join(__dirname, '..', 'database.sqlite');
const db = new sqlite3.Database(dbPath);

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      full_name TEXT,
      designation TEXT,
      role TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
      is_deleted INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS proposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      amount REAL NOT NULL,
      category TEXT,
      use_date TEXT NOT NULL,
      month TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      decided_at TEXT,
      decided_by INTEGER,
      FOREIGN KEY(employee_id) REFERENCES users(id),
      FOREIGN KEY(decided_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      proposal_id INTEGER,
      created_by INTEGER NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('BUDGET', 'EXPENSE', 'INCOME')),
      amount REAL NOT NULL,
      description TEXT,
      date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(proposal_id) REFERENCES proposals(id),
      FOREIGN KEY(created_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS deletion_requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      requested_by INTEGER NOT NULL,
      approved_by INTEGER,
      status TEXT NOT NULL CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
      created_at TEXT NOT NULL,
      decided_at TEXT,
      FOREIGN KEY(user_id) REFERENCES users(id),
      FOREIGN KEY(requested_by) REFERENCES users(id),
      FOREIGN KEY(approved_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      address TEXT NOT NULL,
      city_municipality TEXT NOT NULL CHECK (city_municipality IN ('Koronadal City', 'Surallah')),
      created_at TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS lot_sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lot_id INTEGER NOT NULL,
      sold_by INTEGER NOT NULL,
      receipt_no TEXT NOT NULL,
      amount REAL NOT NULL,
      buyer_name TEXT NOT NULL,
      remarks TEXT,
      buying_process TEXT NOT NULL,
      applicant_status TEXT NOT NULL CHECK (applicant_status IN ('New applicant', 'Member')),
      created_at TEXT NOT NULL,
      FOREIGN KEY(lot_id) REFERENCES lots(id),
      FOREIGN KEY(sold_by) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS remittances (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      employee_id INTEGER NOT NULL,
      collection TEXT NOT NULL,
      amount REAL NOT NULL,
      date TEXT NOT NULL,
      receipt_no TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(employee_id) REFERENCES users(id)
    )
  `);

  // Seed default admin if none exists
  db.get(`SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_deleted = 0`, (err, row) => {
    if (err) {
      console.error('Error checking admin user:', err);
      return;
    }
    if (row.count === 0) {
      const passwordHash = bcrypt.hashSync('admin123', 10);
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO users (username, password_hash, full_name, designation, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)`,
        ['admin', passwordHash, 'Default Admin', 'Koronadal', now],
        (insertErr) => {
          if (insertErr) {
            console.error('Error seeding admin user:', insertErr);
          } else {
            console.log('Seeded default admin user: username=admin, password=admin123');
          }
        }
      );
    }
  });

  // Lightweight migrations for existing databases: add missing columns
  db.all(`PRAGMA table_info(users)`, (err, rows) => {
    if (err) {
      console.error('Error reading users schema:', err);
      return;
    }
    const cols = rows.map((r) => r.name);
    if (!cols.includes('full_name')) {
      db.run(`ALTER TABLE users ADD COLUMN full_name TEXT`, (e) => {
        if (e) console.error('Error adding full_name column to users:', e);
      });
    }
    if (!cols.includes('designation')) {
      db.run(`ALTER TABLE users ADD COLUMN designation TEXT`, (e) => {
        if (e) console.error('Error adding designation column to users:', e);
      });
    }
    if (!cols.includes('is_deleted')) {
      db.run(`ALTER TABLE users ADD COLUMN is_deleted INTEGER NOT NULL DEFAULT 0`, (e) => {
        if (e) console.error('Error adding is_deleted column to users:', e);
      });
    }
  });

  db.all(`PRAGMA table_info(proposals)`, (err, rows) => {
    if (err) {
      console.error('Error reading proposals schema:', err);
      return;
    }
    const cols = rows.map((r) => r.name);
    if (!cols.includes('use_date')) {
      db.run(`ALTER TABLE proposals ADD COLUMN use_date TEXT`, (e) => {
        if (e) console.error('Error adding use_date column to proposals:', e);
      });
    }
    if (!cols.includes('month')) {
      db.run(`ALTER TABLE proposals ADD COLUMN month TEXT`, (e) => {
        if (e) console.error('Error adding month column to proposals:', e);
      });
    }
  });
});

// Helpers
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
    {
    expiresIn: '8h',
    }
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
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password are required' });
  }

  db.get(`SELECT * FROM users WHERE username = ? AND is_deleted = 0`, [username], (err, user) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Database error' });
    }
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
  });
});

// Admin: create employee accounts
app.post('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  const { username, password, role, full_name, designation } = req.body;
  if (!username || !password || !full_name || !designation) {
    return res.status(400).json({ message: 'Username, password, full name and designation are required' });
  }
  const userRole = role === 'admin' ? 'admin' : 'employee';
  const passwordHash = bcrypt.hashSync(password, 10);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO users (username, password_hash, full_name, designation, role, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [username, passwordHash, full_name, designation, userRole, now],
    function (err) {
      if (err) {
        if (err.message.includes('UNIQUE')) {
          return res.status(400).json({ message: 'Username already exists' });
        }
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({ id: this.lastID, username, full_name, designation, role: userRole });
    }
  );
});

const PROPOSAL_CATEGORIES = ['Transportation', 'Meals', 'Office Supplies', 'Miscellaneous'];

// Employee: create budget proposal (no title; category from fixed list)
app.post('/api/proposals', authMiddleware, (req, res) => {
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
  db.run(
    `INSERT INTO proposals (employee_id, title, description, amount, category, use_date, month, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?)`,
    [req.user.id, title, description || '', amount, cat || '', use_date, month, now, now],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({
        id: this.lastID,
        employee_id: req.user.id,
        title,
        description: description || '',
        amount,
        category: cat || '',
        use_date,
        month,
        status: 'PENDING',
        created_at: now,
        updated_at: now,
      });
    }
  );
});

// Get proposals (employee sees own, admin sees all)
app.get('/api/proposals', authMiddleware, (req, res) => {
  const { status, month } = req.query;
  let baseQuery = `SELECT p.*, u.username as employee_username, u.full_name as employee_full_name, u.designation as employee_designation
                   FROM proposals p
                   JOIN users u ON p.employee_id = u.id`;
  const params = [];
  const where = [];

  if (req.user.role === 'employee') {
    where.push('p.employee_id = ?');
    params.push(req.user.id);
  }
  if (status) {
    where.push('p.status = ?');
    params.push(status.toUpperCase());
  }
  if (month) {
    where.push('p.month = ?');
    params.push(month);
  }
  if (where.length > 0) {
    baseQuery += ' WHERE ' + where.join(' AND ');
  }
  baseQuery += ' ORDER BY p.created_at DESC';

  db.all(baseQuery, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(rows);
  });
});

// Admin: approve / reject proposal
app.patch('/api/proposals/:id/status', authMiddleware, requireAdmin, (req, res) => {
  const { status } = req.body;
  const validStatuses = ['APPROVED', 'REJECTED'];
  if (!validStatuses.includes((status || '').toUpperCase())) {
    return res.status(400).json({ message: 'Status must be APPROVED or REJECTED' });
  }
  const finalStatus = status.toUpperCase();
  const id = req.params.id;
  const now = new Date().toISOString();

  db.run(
    `UPDATE proposals
     SET status = ?, updated_at = ?, decided_at = ?, decided_by = ?
     WHERE id = ?`,
    [finalStatus, now, now, req.user.id, id],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Proposal not found' });
      }

      // Automatically create a BUDGET transaction when approved
      if (finalStatus === 'APPROVED') {
        db.get(`SELECT * FROM proposals WHERE id = ?`, [id], (getErr, proposal) => {
          if (getErr || !proposal) {
            if (getErr) console.error(getErr);
            return res.json({ message: 'Proposal updated', status: finalStatus });
          }
          const txNow = new Date().toISOString();
          db.run(
            `INSERT INTO transactions (proposal_id, created_by, type, amount, description, date, created_at)
             VALUES (?, ?, 'BUDGET', ?, ?, ?, ?)`,
            [
              proposal.id,
              req.user.id,
              proposal.amount,
              `Budget approved: ${proposal.title}`,
              proposal.use_date || proposal.month + '-01',
              txNow,
            ],
            (txErr) => {
              if (txErr) console.error('Error creating budget transaction:', txErr);
              res.json({ message: 'Proposal updated', status: finalStatus });
            }
          );
        });
      } else {
        res.json({ message: 'Proposal updated', status: finalStatus });
      }
    }
  );
});

// Admin: create arbitrary transaction
app.post('/api/transactions', authMiddleware, requireAdmin, (req, res) => {
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
  db.run(
    `INSERT INTO transactions (proposal_id, created_by, type, amount, description, date, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [proposal_id || null, req.user.id, txType, amount, description || '', date, now],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({
        id: this.lastID,
        proposal_id: proposal_id || null,
        created_by: req.user.id,
        type: txType,
        amount,
        description: description || '',
        date,
        created_at: now,
      });
    }
  );
});

// Get transactions with optional monthly filter (proposed_by = employee on proposal, approved_by = admin who created tx)
app.get('/api/transactions', authMiddleware, (req, res) => {
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
    where.push(`substr(t.date, 1, 7) = ?`);
    params.push(`${year}-${monthPadded}`);
  } else if (month) {
    where.push(`substr(t.date, 1, 7) = ?`);
    params.push(month);
  }

  if (where.length > 0) {
    baseQuery += ' WHERE ' + where.join(' AND ');
  }
  baseQuery += ' ORDER BY t.date DESC';

  db.all(baseQuery, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(rows);
  });
});

// Admin summary: proposals, budgets, transactions, monthly filter
app.get('/api/admin/summary', authMiddleware, requireAdmin, (req, res) => {
  const { month, year } = req.query;
  const filters = [];
  const params = [];
  let monthKey = null;

  if (month && year) {
    const monthPadded = String(month).padStart(2, '0');
    monthKey = `${year}-${monthPadded}`;
  } else if (month) {
    monthKey = month;
  }

  const summary = {};

  // Proposals aggregate
  const proposalsQuery = `
    SELECT status, COUNT(*) as count, SUM(amount) as total_amount
    FROM proposals
    ${monthKey ? 'WHERE month = ?' : ''}
    GROUP BY status
  `;
  const proposalsParams = monthKey ? [monthKey] : [];

  db.all(proposalsQuery, proposalsParams, (pErr, pRows) => {
    if (pErr) {
      console.error(pErr);
      return res.status(500).json({ message: 'Database error (proposals)' });
    }
    summary.proposals = pRows;

    // Transactions aggregate
    let txQuery = `
      SELECT type, COUNT(*) as count, SUM(amount) as total_amount
      FROM transactions
    `;
    const txWhere = [];
    const txParams = [];
    if (monthKey) {
      txWhere.push('substr(date, 1, 7) = ?');
      txParams.push(monthKey);
    }
    if (txWhere.length > 0) {
      txQuery += ' WHERE ' + txWhere.join(' AND ');
    }
    txQuery += ' GROUP BY type';

    db.all(txQuery, txParams, (tErr, tRows) => {
      if (tErr) {
        console.error(tErr);
        return res.status(500).json({ message: 'Database error (transactions)' });
      }
      summary.transactions = tRows;

      res.json({
        month: monthKey,
        proposals: summary.proposals,
        transactions: summary.transactions,
      });
    });
  });
});

// Admin: list all user accounts (limited fields)
app.get('/api/admin/users', authMiddleware, requireAdmin, (req, res) => {
  db.all(
    `SELECT id, username, full_name, designation, role, created_at
     FROM users
     WHERE is_deleted = 0
     ORDER BY created_at DESC`,
    [],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json(rows);
    }
  );
});

// Admin: best performing employees (total lots sold, total expense from approved proposals, clients handled)
app.get('/api/admin/performance', authMiddleware, requireAdmin, (req, res) => {
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
  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(rows);
  });
});

// Admin: update employee details (full name, designation)
app.patch('/api/admin/users/:id', authMiddleware, requireAdmin, (req, res) => {
  const id = req.params.id;
  const { full_name, designation } = req.body;

  if (!full_name || !designation) {
    return res
      .status(400)
      .json({ message: 'Full name and designation are required' });
  }

  db.run(
    `UPDATE users SET full_name = ?, designation = ? WHERE id = ?`,
    [full_name, designation, id],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'User not found' });
      }

      db.get(
        `SELECT id, username, full_name, designation, role, created_at FROM users WHERE id = ?`,
        [id],
        (getErr, user) => {
          if (getErr) {
            console.error(getErr);
            return res.status(500).json({ message: 'Database error' });
          }
          res.json(user);
        }
      );
    }
  );
});

// Admin: request deletion of an account (first step of 2FA)
app.post('/api/admin/users/:id/delete-request', authMiddleware, requireAdmin, (req, res) => {
  const targetUserId = parseInt(req.params.id, 10);
  const requestedBy = req.user.id;

  if (Number.isNaN(targetUserId)) {
    return res.status(400).json({ message: 'Invalid user id' });
  }

  db.get(
    `SELECT id, username, role, is_deleted FROM users WHERE id = ?`,
    [targetUserId],
    (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      if (!user || user.is_deleted) {
        return res.status(404).json({ message: 'User not found' });
      }

      db.get(
        `SELECT id FROM deletion_requests WHERE user_id = ? AND status = 'PENDING'`,
        [targetUserId],
        (checkErr, existing) => {
          if (checkErr) {
            console.error(checkErr);
            return res.status(500).json({ message: 'Database error' });
          }
          if (existing) {
            return res.status(400).json({ message: 'Deletion already pending for this account' });
          }

          const now = new Date().toISOString();
          db.run(
            `INSERT INTO deletion_requests (user_id, requested_by, status, created_at)
             VALUES (?, ?, 'PENDING', ?)`,
            [targetUserId, requestedBy, now],
            function (insErr) {
              if (insErr) {
                console.error(insErr);
                return res.status(500).json({ message: 'Database error' });
              }
              res.status(201).json({
                id: this.lastID,
                user_id: targetUserId,
                requested_by: requestedBy,
                status: 'PENDING',
                created_at: now,
              });
            }
          );
        }
      );
    }
  );
});

// Admin: list pending deletion requests queue
app.get('/api/admin/deletion-queue', authMiddleware, requireAdmin, (req, res) => {
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

  db.all(sql, [], (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(rows);
  });
});

// Admin: approve deletion request (second admin)
app.patch('/api/admin/deletion-queue/:id/approve', authMiddleware, requireAdmin, (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const approverId = req.user.id;

  if (Number.isNaN(requestId)) {
    return res.status(400).json({ message: 'Invalid request id' });
  }

  db.get(
    `SELECT * FROM deletion_requests WHERE id = ?`,
    [requestId],
    (err, dr) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      if (!dr || dr.status !== 'PENDING') {
        return res.status(404).json({ message: 'Deletion request not found or not pending' });
      }
      if (dr.requested_by === approverId) {
        return res
          .status(400)
          .json({ message: 'A different admin must approve this deletion' });
      }

      db.get(
        `SELECT id, role, is_deleted FROM users WHERE id = ?`,
        [dr.user_id],
        (userErr, user) => {
          if (userErr) {
            console.error(userErr);
            return res.status(500).json({ message: 'Database error' });
          }
          if (!user || user.is_deleted) {
            return res.status(404).json({ message: 'User not found' });
          }

          const proceed = () => {
            const now = new Date().toISOString();
            db.run(
              `UPDATE users SET is_deleted = 1 WHERE id = ?`,
              [dr.user_id],
              function (updErr) {
                if (updErr) {
                  console.error(updErr);
                  return res.status(500).json({ message: 'Database error' });
                }
                db.run(
                  `UPDATE deletion_requests
                   SET status = 'APPROVED', approved_by = ?, decided_at = ?
                   WHERE id = ?`,
                  [approverId, now, requestId],
                  function (finalErr) {
                    if (finalErr) {
                      console.error(finalErr);
                      return res.status(500).json({ message: 'Database error' });
                    }
                    res.json({ message: 'Account deleted (soft delete).' });
                  }
                );
              }
            );
          };

          if (user.role === 'admin') {
            db.get(
              `SELECT COUNT(*) as count FROM users WHERE role = 'admin' AND is_deleted = 0 AND id != ?`,
              [user.id],
              (countErr, row) => {
                if (countErr) {
                  console.error(countErr);
                  return res.status(500).json({ message: 'Database error' });
                }
                if (!row || row.count === 0) {
                  return res
                    .status(400)
                    .json({ message: 'Cannot delete the last remaining admin account' });
                }
                proceed();
              }
            );
          } else {
            proceed();
          }
        }
      );
    }
  );
});

// Admin: reject deletion request
app.patch('/api/admin/deletion-queue/:id/reject', authMiddleware, requireAdmin, (req, res) => {
  const requestId = parseInt(req.params.id, 10);
  const approverId = req.user.id;

  if (Number.isNaN(requestId)) {
    return res.status(400).json({ message: 'Invalid request id' });
  }

  db.get(
    `SELECT * FROM deletion_requests WHERE id = ?`,
    [requestId],
    (err, dr) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      if (!dr || dr.status !== 'PENDING') {
        return res.status(404).json({ message: 'Deletion request not found or not pending' });
      }

      const now = new Date().toISOString();
      db.run(
        `UPDATE deletion_requests
         SET status = 'REJECTED', approved_by = ?, decided_at = ?
         WHERE id = ?`,
        [approverId, now, requestId],
        function (updErr) {
          if (updErr) {
            console.error(updErr);
            return res.status(500).json({ message: 'Database error' });
          }
          res.json({ message: 'Deletion request rejected.' });
        }
      );
    }
  );
});

// Admin: reset user password to default (123)
app.patch('/api/admin/users/:id/reset-password', authMiddleware, requireAdmin, (req, res) => {
  const id = req.params.id;
  const defaultPassword = '123';
  const passwordHash = bcrypt.hashSync(defaultPassword, 10);

  db.run(
    `UPDATE users SET password_hash = ? WHERE id = ?`,
    [passwordHash, id],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'User not found' });
      }
      res.json({ message: 'Password reset to default (123).' });
    }
  );
});

// Employee/Admin: change own password
app.patch('/api/me/password', authMiddleware, (req, res) => {
  const userId = req.user.id;
  const { current_password, new_password } = req.body;

  if (!current_password || !new_password) {
    return res.status(400).json({ message: 'Current password and new password are required' });
  }

  db.get(`SELECT password_hash FROM users WHERE id = ?`, [userId], (err, user) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    const ok = bcrypt.compareSync(current_password, user.password_hash);
    if (!ok) {
      return res.status(401).json({ message: 'Current password is incorrect' });
    }

    const newHash = bcrypt.hashSync(new_password, 10);
    db.run(
      `UPDATE users SET password_hash = ? WHERE id = ?`,
      [newHash, userId],
      function (updateErr) {
        if (updateErr) {
          console.error(updateErr);
          return res.status(500).json({ message: 'Database error' });
        }
        res.json({ message: 'Password updated successfully' });
      }
    );
  });
});

// ----- Lot Sale -----
// Admin: add lot
app.post('/api/lots', authMiddleware, requireAdmin, (req, res) => {
  const { address, city_municipality } = req.body;
  if (!address || !city_municipality) {
    return res.status(400).json({ message: 'Address and city/municipality are required' });
  }
  const validCities = ['Koronadal City', 'Surallah'];
  if (!validCities.includes(city_municipality)) {
    return res.status(400).json({ message: 'City/municipality must be Koronadal City or Surallah' });
  }
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO lots (address, city_municipality, created_at) VALUES (?, ?, ?)`,
    [address.trim(), city_municipality, now],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.status(201).json({
        id: this.lastID,
        address: address.trim(),
        city_municipality,
        created_at: now,
      });
    }
  );
});

// Admin: list all lots (with sale info if any). Employee: list lots filtered by designation (Koronadal -> Koronadal City, Surallah -> Surallah)
app.get('/api/lots', authMiddleware, (req, res) => {
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
    sql += ' WHERE l.city_municipality = ?';
    params.push(city);
  }
  sql += ' ORDER BY l.city_municipality, l.address';

  db.all(sql, params, (err, rows) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Database error' });
    }
    res.json(rows);
  });
});

// Employee: mark lot as sold
app.post('/api/lots/:id/sale', authMiddleware, (req, res) => {
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

  db.get('SELECT id, city_municipality FROM lots WHERE id = ?', [lotId], (err, lot) => {
    if (err) {
      console.error(err);
      return res.status(500).json({ message: 'Database error' });
    }
    if (!lot) {
      return res.status(404).json({ message: 'Lot not found' });
    }
    const designation = (req.user.designation || '').trim();
    const allowedCity = designation === 'Surallah' ? 'Surallah' : 'Koronadal City';
    if (lot.city_municipality !== allowedCity) {
      return res.status(403).json({ message: 'You can only record sales for lots in your designation area' });
    }

    db.get('SELECT id FROM lot_sales WHERE lot_id = ?', [lotId], (saleErr, existing) => {
      if (saleErr) {
        console.error(saleErr);
        return res.status(500).json({ message: 'Database error' });
      }
      if (existing) {
        return res.status(400).json({ message: 'This lot is already marked as sold' });
      }

      const now = new Date().toISOString();
      db.run(
        `INSERT INTO lot_sales (lot_id, sold_by, receipt_no, amount, buyer_name, remarks, buying_process, applicant_status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [lotId, req.user.id, receipt_no.trim(), parseFloat(amount), buyer_name.trim(), remarks || null, buying_process, applicant_status, now],
        function (insErr) {
          if (insErr) {
            console.error(insErr);
            return res.status(500).json({ message: 'Database error' });
          }
          res.status(201).json({
            id: this.lastID,
            lot_id: lotId,
            receipt_no: receipt_no.trim(),
            amount: parseFloat(amount),
            buyer_name: buyer_name.trim(),
            remarks: remarks || null,
            buying_process,
            applicant_status,
            created_at: now,
          });
        }
      );
    });
  });
});

// Admin: delete a lot (and its sale record if any)
app.delete('/api/lots/:id', authMiddleware, requireAdmin, (req, res) => {
  const lotId = parseInt(req.params.id, 10);
  if (Number.isNaN(lotId)) {
    return res.status(400).json({ message: 'Invalid lot id' });
  }
  db.run('DELETE FROM lot_sales WHERE lot_id = ?', [lotId], function (delSaleErr) {
    if (delSaleErr) {
      console.error(delSaleErr);
      return res.status(500).json({ message: 'Database error' });
    }
    db.run('DELETE FROM lots WHERE id = ?', [lotId], function (delLotErr) {
      if (delLotErr) {
        console.error(delLotErr);
        return res.status(500).json({ message: 'Database error' });
      }
      if (this.changes === 0) {
        return res.status(404).json({ message: 'Lot not found' });
      }
      res.json({ message: 'Lot deleted' });
    });
  });
});

// Employee: create remittance
app.post('/api/remittances', authMiddleware, (req, res) => {
  if (req.user.role !== 'employee') {
    return res.status(403).json({ message: 'Only employees can create remittances' });
  }
  const { collection, amount, date, receipt_no } = req.body;
  if (!collection || !amount || !date || !receipt_no) {
    return res.status(400).json({ message: 'Collection, amount, date and receipt number are required' });
  }
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO remittances (employee_id, collection, amount, date, receipt_no, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
    [req.user.id, collection, parseFloat(amount), date, receipt_no, now],
    function (err) {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json({ id: this.lastID, message: 'Remittance created successfully' });
    }
  );
});

// Employee: get their remittances
app.get('/api/remittances', authMiddleware, (req, res) => {
  if (req.user.role !== 'employee') {
    return res.status(403).json({ message: 'Only employees can view remittances' });
  }
  db.all(
    `SELECT * FROM remittances WHERE employee_id = ? ORDER BY created_at DESC`,
    [req.user.id],
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ message: 'Database error' });
      }
      res.json(rows);
    }
  );
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

// Serve React frontend build (production)
const frontendDistPath = path.join(__dirname, '../../frontend/dist');
app.use(express.static(frontendDistPath));

// Fallback to React index.html for client-side routing
app.get('*', (req, res) => {
  res.sendFile(path.join(frontendDistPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Backend API listening on http://localhost:${PORT} (and on your network IP for mobile access)`);
});

