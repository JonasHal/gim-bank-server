const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Token authentication middleware
const authenticateToken = (req, res, next) => {
  const token = req.headers['authorization'] || req.query.token || req.body.token;
  
  if (!token || token !== process.env.SECRET_TOKEN) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  next();
};

// PostgreSQL connection pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test database connection and create tables
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Database connection failed:', err);
  } else {
    console.log('Database connected successfully');
    initializeTables();
  }
});

// Initialize tables
async function initializeTables() {
  const messagesTable = `
    CREATE TABLE IF NOT EXISTS messages (
      id SERIAL PRIMARY KEY,
      message TEXT NOT NULL,
      sender VARCHAR(255) NOT NULL,
      item_id INTEGER DEFAULT NULL,
      amount INTEGER DEFAULT NULL,
      group_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  
  const transactionsTable = `
    CREATE TABLE IF NOT EXISTS transactions (
      id SERIAL PRIMARY KEY,
      item_id INTEGER NOT NULL,
      item VARCHAR(255) NOT NULL,
      "user" VARCHAR(255) NOT NULL,
      amount INTEGER NOT NULL,
      group_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `;
  
  const messagesIndexes = `
    CREATE INDEX IF NOT EXISTS idx_messages_group_created ON messages(group_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
  `;
  
  const transactionsIndexes = `
    CREATE INDEX IF NOT EXISTS idx_transactions_group_created ON transactions(group_name, created_at);
    CREATE INDEX IF NOT EXISTS idx_transactions_item_id ON transactions(item_id);
    CREATE INDEX IF NOT EXISTS idx_transactions_user ON transactions("user");
    CREATE INDEX IF NOT EXISTS idx_transactions_created ON transactions(created_at);
  `;
  
  try {
    await pool.query(messagesTable);
    await pool.query(transactionsTable);
    await pool.query(messagesIndexes);
    await pool.query(transactionsIndexes);
    console.log('Database tables initialized');
  } catch (error) {
    console.error('Error initializing tables:', error);
  }
}

// ===== TRANSACTIONS ENDPOINTS =====

// GET transactions
app.get('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { group_name, limit = 100, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM transactions';
    const params = [];
    
    if (group_name) {
      query += ' WHERE group_name = $1';
      params.push(group_name);
      query += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
      params.push(parseInt(limit), parseInt(offset));
    } else {
      query += ' ORDER BY created_at DESC LIMIT $1 OFFSET $2';
      params.push(parseInt(limit), parseInt(offset));
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching transactions:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST new transaction
app.post('/api/transactions', authenticateToken, async (req, res) => {
  try {
    const { item_id, item, user, amount, group_name } = req.body;
    
    if (!item_id || !item || !user || amount === undefined || !group_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const query = `
      INSERT INTO transactions (item_id, item, "user", amount, group_name, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [item_id, item, user, amount, group_name]);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating transaction:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ===== MESSAGES ENDPOINTS =====

// GET messages
app.get('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { group_name, limit = 50, offset = 0 } = req.query;
    
    let query = 'SELECT * FROM messages';
    const params = [];
    
    if (group_name) {
      query += ' WHERE group_name = $1';
      params.push(group_name);
      query += ' ORDER BY created_at DESC LIMIT $2 OFFSET $3';
      params.push(parseInt(limit), parseInt(offset));
    } else {
      query += ' ORDER BY created_at DESC LIMIT $1 OFFSET $2';
      params.push(parseInt(limit), parseInt(offset));
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST new message
app.post('/api/messages', authenticateToken, async (req, res) => {
  try {
    const { message, sender, item_id, amount, group_name } = req.body;
    
    if (!message || !sender || !group_name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }
    
    const query = `
      INSERT INTO messages (message, sender, item_id, amount, group_name, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      RETURNING *
    `;
    
    const result = await pool.query(query, [
      message,
      sender,
      item_id || null,
      amount || null,
      group_name
    ]);
    
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE message
app.delete('/api/messages/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { group_name } = req.query;
    
    let query = 'DELETE FROM messages WHERE id = $1';
    const params = [id];
    
    if (group_name) {
      query += ' AND group_name = $2';
      params.push(group_name);
    }
    
    const result = await pool.query(query, params);
    
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Message not found' });
    }
    
    res.json({ success: true, message: 'Message deleted' });
  } catch (error) {
    console.error('Error deleting message:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Start server
app.listen(PORT, () => {
  console.log(`GIM Bank Extended Server running on port ${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, closing server...');
  await pool.end();
  process.exit(0);
});