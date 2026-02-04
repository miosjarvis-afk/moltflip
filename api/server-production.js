/**
 * MOLTFLIP API - Production Server
 * Coinflip for AI Agents
 * 
 * Features:
 * - SQLite persistence
 * - Wallet signature authentication
 * - Real SOL transfers (Devnet/Mainnet)
 * - Provably fair randomness
 * - Security hardened
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const Database = require('better-sqlite3');
const nacl = require('tweetnacl');
const bs58 = require('bs58').default || require('bs58');
const { 
  Connection, 
  PublicKey, 
  Keypair, 
  Transaction, 
  SystemProgram, 
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction
} = require('@solana/web3.js');

// ============ CONFIG ============
const CONFIG = {
  PORT: process.env.PORT || 3001,
  RPC_URL: process.env.RPC_URL || 'https://api.devnet.solana.com',
  NETWORK: process.env.NETWORK || 'devnet', // 'devnet' or 'mainnet-beta'
  HOUSE_WALLET_PATH: process.env.HOUSE_WALLET || require('os').homedir() + '/.openclaw/wallet/solana-wallet.json',
  
  // Game settings
  HOUSE_EDGE_BPS: 200,    // 2%
  PVP_FEE_BPS: 100,       // 1%
  MIN_BET_SOL: 0.01,
  MAX_BET_SOL: 10,
  
  // Security
  AUTH_MESSAGE_EXPIRY_MS: 300000, // 5 minutes
  RATE_LIMIT_WINDOW_MS: 60000,
  RATE_LIMIT_MAX: 60,
  
  // Timeouts
  PVP_MATCH_EXPIRY_MS: 3600000, // 1 hour
  SEED_EXPIRY_MS: 300000,       // 5 minutes
};

// ============ DATABASE SETUP ============
const db = new Database('/home/node/openclaw/projects/moltflip/api/moltflip.db');

db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    wallet TEXT NOT NULL UNIQUE,
    created_at INTEGER NOT NULL,
    last_used INTEGER,
    is_active INTEGER DEFAULT 1
  );
  
  CREATE TABLE IF NOT EXISTS flips (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    player TEXT NOT NULL,
    opponent TEXT,
    amount_lamports INTEGER NOT NULL,
    choice INTEGER NOT NULL,
    result INTEGER,
    player_won INTEGER,
    payout_lamports INTEGER,
    server_seed TEXT,
    client_seed TEXT,
    nonce INTEGER,
    tx_signature TEXT,
    status TEXT DEFAULT 'pending',
    created_at INTEGER NOT NULL,
    resolved_at INTEGER
  );
  
  CREATE TABLE IF NOT EXISTS pvp_matches (
    id TEXT PRIMARY KEY,
    creator TEXT NOT NULL,
    creator_choice INTEGER NOT NULL,
    amount_lamports INTEGER NOT NULL,
    server_seed_hash TEXT NOT NULL,
    server_seed TEXT NOT NULL,
    opponent TEXT,
    client_seed TEXT,
    result INTEGER,
    winner TEXT,
    payout_lamports INTEGER,
    fee_lamports INTEGER,
    status TEXT DEFAULT 'open',
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    resolved_at INTEGER,
    tx_signature TEXT
  );
  
  CREATE TABLE IF NOT EXISTS seeds (
    id TEXT PRIMARY KEY,
    seed TEXT NOT NULL,
    hash TEXT NOT NULL,
    wallet TEXT,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used INTEGER DEFAULT 0
  );
  
  CREATE TABLE IF NOT EXISTS stats (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  
  CREATE INDEX IF NOT EXISTS idx_flips_player ON flips(player);
  CREATE INDEX IF NOT EXISTS idx_flips_created ON flips(created_at);
  CREATE INDEX IF NOT EXISTS idx_matches_status ON pvp_matches(status);
`);

// Initialize stats
const initStats = db.prepare(`INSERT OR IGNORE INTO stats (key, value) VALUES (?, ?)`);
initStats.run('total_flips', '0');
initStats.run('total_volume_lamports', '0');
initStats.run('house_profit_lamports', '0');

// ============ SOLANA SETUP ============
let connection;
let houseKeypair;

async function initSolana() {
  connection = new Connection(CONFIG.RPC_URL, 'confirmed');
  
  try {
    const fs = require('fs');
    const walletData = JSON.parse(fs.readFileSync(CONFIG.HOUSE_WALLET_PATH, 'utf8'));
    
    // Support both formats: array or {secretKey: base58}
    if (Array.isArray(walletData)) {
      houseKeypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
    } else if (walletData.secretKey) {
      const secretKey = bs58.decode(walletData.secretKey);
      houseKeypair = Keypair.fromSecretKey(secretKey);
    } else {
      throw new Error('Unknown wallet format');
    }
    
    console.log(`🏦 House wallet: ${houseKeypair.publicKey.toBase58()}`);
    
    const balance = await connection.getBalance(houseKeypair.publicKey);
    console.log(`💰 House balance: ${balance / LAMPORTS_PER_SOL} SOL`);
  } catch (err) {
    console.error('⚠️ House wallet error:', err.message);
    console.error('⚠️ Running in simulation mode');
    houseKeypair = Keypair.generate();
    console.log(`🎭 Simulation wallet: ${houseKeypair.publicKey.toBase58()}`);
  }
}

// ============ HELPER FUNCTIONS ============

function getStat(key) {
  const row = db.prepare('SELECT value FROM stats WHERE key = ?').get(key);
  return row ? row.value : '0';
}

function updateStat(key, delta) {
  const current = BigInt(getStat(key));
  const newVal = (current + BigInt(delta)).toString();
  db.prepare('UPDATE stats SET value = ? WHERE key = ?').run(newVal, key);
}

function generateServerSeed() {
  const seed = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return { seed, hash };
}

function resolveFlip(serverSeed, clientSeed, nonce) {
  const combined = `${serverSeed}:${clientSeed}:${nonce}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  const value = parseInt(hash.slice(0, 8), 16);
  return value % 2 === 0; // true = heads (0), false = tails (1)
}

function verifyWalletSignature(wallet, message, signature) {
  try {
    const publicKey = bs58.decode(wallet);
    const messageBytes = new TextEncoder().encode(message);
    const signatureBytes = bs58.decode(signature);
    return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKey);
  } catch (err) {
    return false;
  }
}

async function transferSOL(from, to, lamports) {
  if (CONFIG.NETWORK === 'simulation') {
    return 'SIMULATION_' + uuidv4();
  }
  
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: from.publicKey,
      toPubkey: new PublicKey(to),
      lamports: lamports,
    })
  );
  
  const signature = await sendAndConfirmTransaction(connection, transaction, [from]);
  return signature;
}

// ============ EXPRESS SETUP ============
const app = express();

// Security middleware
app.use(helmet({
  contentSecurityPolicy: false, // Allow API usage
}));

app.use(cors({
  origin: '*', // Configure for production
  methods: ['GET', 'POST', 'DELETE'],
  allowedHeaders: ['Content-Type', 'x-api-key', 'x-wallet', 'x-signature', 'x-timestamp'],
}));

app.use(express.json({ limit: '10kb' }));

// Rate limiting
const rateLimits = new Map();

function rateLimit(req, res, next) {
  const key = req.headers['x-api-key'] || req.ip;
  const now = Date.now();
  const record = rateLimits.get(key) || { count: 0, resetTime: now + CONFIG.RATE_LIMIT_WINDOW_MS };
  
  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + CONFIG.RATE_LIMIT_WINDOW_MS;
  }
  
  if (record.count >= CONFIG.RATE_LIMIT_MAX) {
    return res.status(429).json({ 
      error: 'Rate limit exceeded', 
      retryAfter: Math.ceil((record.resetTime - now) / 1000) 
    });
  }
  
  record.count++;
  rateLimits.set(key, record);
  next();
}

// Authentication middleware
function authenticate(req, res, next) {
  const wallet = req.headers['x-wallet'];
  const signature = req.headers['x-signature'];
  const timestamp = req.headers['x-timestamp'];
  
  if (!wallet || !signature || !timestamp) {
    return res.status(401).json({ 
      error: 'Authentication required',
      required: ['x-wallet', 'x-signature', 'x-timestamp'],
      message: 'Sign message: "Moltflip:{timestamp}" with your wallet'
    });
  }
  
  // Check timestamp freshness
  const ts = parseInt(timestamp);
  if (isNaN(ts) || Math.abs(Date.now() - ts) > CONFIG.AUTH_MESSAGE_EXPIRY_MS) {
    return res.status(401).json({ error: 'Timestamp expired or invalid' });
  }
  
  // Verify signature
  const message = `Moltflip:${timestamp}`;
  if (!verifyWalletSignature(wallet, message, signature)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }
  
  // Valid! Store in request
  req.agent = { wallet };
  
  // Update or create API record
  const existing = db.prepare('SELECT id FROM api_keys WHERE wallet = ?').get(wallet);
  if (existing) {
    db.prepare('UPDATE api_keys SET last_used = ? WHERE wallet = ?').run(Date.now(), wallet);
  } else {
    db.prepare('INSERT INTO api_keys (id, wallet, created_at, last_used) VALUES (?, ?, ?, ?)')
      .run(uuidv4(), wallet, Date.now(), Date.now());
  }
  
  next();
}

// Validation schemas
const schemas = {
  flip: Joi.object({
    amount: Joi.number().min(CONFIG.MIN_BET_SOL).max(CONFIG.MAX_BET_SOL).required(),
    choice: Joi.string().valid('heads', 'tails').required(),
    clientSeed: Joi.string().max(64).required(),
    seedId: Joi.string().uuid().optional(),
  }),
  
  pvpCreate: Joi.object({
    amount: Joi.number().min(CONFIG.MIN_BET_SOL).max(CONFIG.MAX_BET_SOL).required(),
    choice: Joi.string().valid('heads', 'tails').required(),
  }),
  
  pvpJoin: Joi.object({
    clientSeed: Joi.string().max(64).default('default'),
  }),
};

function validate(schema) {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({ error: error.details[0].message });
    }
    req.validated = value;
    next();
  };
}

// ============ API ROUTES ============

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    network: CONFIG.NETWORK,
    houseWallet: houseKeypair?.publicKey?.toBase58() || 'not-loaded',
  });
});

// Get stats
app.get('/api/v1/stats', rateLimit, async (req, res) => {
  try {
    const houseBalance = houseKeypair ? 
      await connection.getBalance(houseKeypair.publicKey) : 0;
    
    const openMatches = db.prepare(
      'SELECT COUNT(*) as count FROM pvp_matches WHERE status = ?'
    ).get('open');
    
    res.json({
      totalFlips: getStat('total_flips'),
      totalVolume: (parseInt(getStat('total_volume_lamports')) / LAMPORTS_PER_SOL).toFixed(2),
      houseBalance: (houseBalance / LAMPORTS_PER_SOL).toFixed(4),
      openPvpMatches: openMatches.count,
      network: CONFIG.NETWORK,
      minBet: CONFIG.MIN_BET_SOL,
      maxBet: CONFIG.MAX_BET_SOL,
      houseEdge: CONFIG.HOUSE_EDGE_BPS / 100 + '%',
    });
  } catch (err) {
    console.error('Stats error:', err);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// Get server seed hash (for provably fair)
app.post('/api/v1/seed', rateLimit, (req, res) => {
  const { seed, hash } = generateServerSeed();
  const seedId = uuidv4();
  
  db.prepare(`
    INSERT INTO seeds (id, seed, hash, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(seedId, seed, hash, Date.now(), Date.now() + CONFIG.SEED_EXPIRY_MS);
  
  res.json({ seedId, serverSeedHash: hash });
});

// PvE Flip - Agent vs House
app.post('/api/v1/flip', rateLimit, authenticate, validate(schemas.flip), async (req, res) => {
  const { amount, choice, clientSeed, seedId } = req.validated;
  const wallet = req.agent.wallet;
  
  try {
    const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL);
    
    // Check house can pay potential winnings
    const houseBalance = await connection.getBalance(houseKeypair.publicKey);
    const potentialPayout = amountLamports * 2 * (10000 - CONFIG.HOUSE_EDGE_BPS) / 10000;
    
    if (houseBalance < potentialPayout) {
      return res.status(400).json({ error: 'House treasury insufficient for this bet' });
    }
    
    // Get server seed
    let serverSeed;
    if (seedId) {
      const stored = db.prepare('SELECT * FROM seeds WHERE id = ? AND used = 0').get(seedId);
      if (!stored || Date.now() > stored.expires_at) {
        return res.status(400).json({ error: 'Seed expired or invalid' });
      }
      serverSeed = stored.seed;
      db.prepare('UPDATE seeds SET used = 1 WHERE id = ?').run(seedId);
    } else {
      serverSeed = crypto.randomBytes(32).toString('hex');
    }
    
    // Get nonce
    const nonce = parseInt(getStat('total_flips'));
    
    // Resolve flip
    const result = resolveFlip(serverSeed, clientSeed, nonce);
    const resultStr = result ? 'heads' : 'tails';
    const playerWon = (choice === 'heads') === result;
    
    // Calculate payout
    let payoutLamports = 0;
    let houseProfit = amountLamports;
    
    if (playerWon) {
      payoutLamports = Math.floor(amountLamports * 2 * (10000 - CONFIG.HOUSE_EDGE_BPS) / 10000);
      houseProfit = amountLamports - payoutLamports;
    }
    
    // Execute transfer
    let txSignature = null;
    if (playerWon && payoutLamports > 0) {
      try {
        txSignature = await transferSOL(houseKeypair, wallet, payoutLamports);
      } catch (err) {
        console.error('Transfer failed:', err);
        return res.status(500).json({ error: 'Transfer failed', details: err.message });
      }
    }
    
    // Record flip
    const flipId = uuidv4();
    db.prepare(`
      INSERT INTO flips (id, type, player, amount_lamports, choice, result, player_won, 
                        payout_lamports, server_seed, client_seed, nonce, tx_signature, 
                        status, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      flipId, 'pve', wallet, amountLamports, choice === 'heads' ? 1 : 0,
      result ? 1 : 0, playerWon ? 1 : 0, payoutLamports, serverSeed, clientSeed,
      nonce, txSignature, 'resolved', Date.now(), Date.now()
    );
    
    // Update stats
    updateStat('total_flips', 1);
    updateStat('total_volume_lamports', amountLamports);
    updateStat('house_profit_lamports', houseProfit);
    
    res.json({
      success: true,
      flipId,
      result: resultStr,
      won: playerWon,
      payout: playerWon ? (payoutLamports / LAMPORTS_PER_SOL).toFixed(4) : '0',
      txSignature,
      serverSeed,
      verification: {
        clientSeed,
        nonce,
        formula: 'sha256(serverSeed:clientSeed:nonce) % 2 === 0 ? heads : tails',
      }
    });
    
  } catch (err) {
    console.error('Flip error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Create PvP Match
app.post('/api/v1/pvp/create', rateLimit, authenticate, validate(schemas.pvpCreate), (req, res) => {
  const { amount, choice } = req.validated;
  const wallet = req.agent.wallet;
  
  try {
    const amountLamports = Math.floor(amount * LAMPORTS_PER_SOL);
    const matchId = uuidv4();
    const { seed, hash } = generateServerSeed();
    const now = Date.now();
    
    db.prepare(`
      INSERT INTO pvp_matches (id, creator, creator_choice, amount_lamports, 
                               server_seed_hash, server_seed, status, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      matchId, wallet, choice === 'heads' ? 1 : 0, amountLamports,
      hash, seed, 'open', now, now + CONFIG.PVP_MATCH_EXPIRY_MS
    );
    
    res.json({
      success: true,
      matchId,
      amount,
      choice,
      serverSeedHash: hash,
      expiresAt: new Date(now + CONFIG.PVP_MATCH_EXPIRY_MS).toISOString(),
      depositRequired: amount,
      depositAddress: houseKeypair.publicKey.toBase58(),
    });
    
  } catch (err) {
    console.error('PvP create error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// List open PvP matches
app.get('/api/v1/pvp/matches', rateLimit, (req, res) => {
  const now = Date.now();
  const matches = db.prepare(`
    SELECT id, creator, amount_lamports, created_at, expires_at 
    FROM pvp_matches 
    WHERE status = 'open' AND expires_at > ?
    ORDER BY created_at DESC
    LIMIT 50
  `).all(now);
  
  res.json({
    matches: matches.map(m => ({
      id: m.id,
      creator: m.creator.slice(0, 8) + '...',
      amount: (m.amount_lamports / LAMPORTS_PER_SOL).toFixed(4),
      createdAt: new Date(m.created_at).toISOString(),
      expiresAt: new Date(m.expires_at).toISOString(),
    }))
  });
});

// Join PvP Match
app.post('/api/v1/pvp/join/:matchId', rateLimit, authenticate, validate(schemas.pvpJoin), async (req, res) => {
  const { matchId } = req.params;
  const { clientSeed } = req.validated;
  const wallet = req.agent.wallet;
  
  try {
    const match = db.prepare('SELECT * FROM pvp_matches WHERE id = ?').get(matchId);
    
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    if (match.status !== 'open') {
      return res.status(400).json({ error: 'Match not available' });
    }
    if (Date.now() > match.expires_at) {
      return res.status(400).json({ error: 'Match expired' });
    }
    if (match.creator === wallet) {
      return res.status(400).json({ error: 'Cannot join your own match' });
    }
    
    // Resolve flip
    const nonce = parseInt(getStat('total_flips'));
    const result = resolveFlip(match.server_seed, clientSeed, nonce);
    const resultStr = result ? 'heads' : 'tails';
    const creatorWon = (match.creator_choice === 1) === result;
    const winner = creatorWon ? match.creator : wallet;
    
    // Calculate payout
    const totalPot = match.amount_lamports * 2;
    const feeLamports = Math.floor(totalPot * CONFIG.PVP_FEE_BPS / 10000);
    const payoutLamports = totalPot - feeLamports;
    
    // Execute transfer to winner
    let txSignature = null;
    try {
      txSignature = await transferSOL(houseKeypair, winner, payoutLamports);
    } catch (err) {
      console.error('PvP transfer failed:', err);
      return res.status(500).json({ error: 'Transfer failed' });
    }
    
    // Update match
    db.prepare(`
      UPDATE pvp_matches SET 
        opponent = ?, client_seed = ?, result = ?, winner = ?,
        payout_lamports = ?, fee_lamports = ?, status = 'resolved',
        resolved_at = ?, tx_signature = ?
      WHERE id = ?
    `).run(
      wallet, clientSeed, result ? 1 : 0, winner,
      payoutLamports, feeLamports, Date.now(), txSignature, matchId
    );
    
    // Update stats
    updateStat('total_flips', 1);
    updateStat('total_volume_lamports', totalPot);
    updateStat('house_profit_lamports', feeLamports);
    
    res.json({
      success: true,
      result: resultStr,
      winner: winner === wallet ? 'you' : 'creator',
      payout: (payoutLamports / LAMPORTS_PER_SOL).toFixed(4),
      fee: (feeLamports / LAMPORTS_PER_SOL).toFixed(4),
      txSignature,
      serverSeed: match.server_seed,
      verification: { clientSeed, nonce }
    });
    
  } catch (err) {
    console.error('PvP join error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Cancel PvP Match
app.delete('/api/v1/pvp/:matchId', rateLimit, authenticate, (req, res) => {
  const { matchId } = req.params;
  const wallet = req.agent.wallet;
  
  const match = db.prepare('SELECT * FROM pvp_matches WHERE id = ?').get(matchId);
  
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }
  if (match.creator !== wallet) {
    return res.status(403).json({ error: 'Not your match' });
  }
  if (match.status !== 'open') {
    return res.status(400).json({ error: 'Match cannot be cancelled' });
  }
  
  db.prepare('UPDATE pvp_matches SET status = ? WHERE id = ?').run('cancelled', matchId);
  
  res.json({ success: true, message: 'Match cancelled' });
});

// Get flip history
app.get('/api/v1/history', rateLimit, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  
  const history = db.prepare(`
    SELECT id, type, player, amount_lamports, result, player_won, 
           payout_lamports, created_at, tx_signature
    FROM flips
    WHERE status = 'resolved'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(limit);
  
  res.json({
    history: history.map(f => ({
      id: f.id,
      type: f.type,
      player: f.player.slice(0, 8) + '...',
      amount: (f.amount_lamports / LAMPORTS_PER_SOL).toFixed(4),
      result: f.result ? 'heads' : 'tails',
      won: !!f.player_won,
      payout: (f.payout_lamports / LAMPORTS_PER_SOL).toFixed(4),
      timestamp: new Date(f.created_at).toISOString(),
      txSignature: f.tx_signature,
    }))
  });
});

// My flip history (authenticated)
app.get('/api/v1/my/history', rateLimit, authenticate, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const wallet = req.agent.wallet;
  
  const history = db.prepare(`
    SELECT * FROM flips 
    WHERE player = ? AND status = 'resolved'
    ORDER BY created_at DESC
    LIMIT ?
  `).all(wallet, limit);
  
  res.json({
    wallet,
    history: history.map(f => ({
      id: f.id,
      type: f.type,
      amount: (f.amount_lamports / LAMPORTS_PER_SOL).toFixed(4),
      choice: f.choice ? 'heads' : 'tails',
      result: f.result ? 'heads' : 'tails',
      won: !!f.player_won,
      payout: (f.payout_lamports / LAMPORTS_PER_SOL).toFixed(4),
      timestamp: new Date(f.created_at).toISOString(),
      txSignature: f.tx_signature,
      serverSeed: f.server_seed,
      clientSeed: f.client_seed,
      nonce: f.nonce,
    }))
  });
});

// My stats
app.get('/api/v1/my/stats', rateLimit, authenticate, (req, res) => {
  const wallet = req.agent.wallet;
  
  const stats = db.prepare(`
    SELECT 
      COUNT(*) as total_flips,
      SUM(amount_lamports) as total_wagered,
      SUM(CASE WHEN player_won = 1 THEN 1 ELSE 0 END) as wins,
      SUM(CASE WHEN player_won = 0 THEN 1 ELSE 0 END) as losses,
      SUM(CASE WHEN player_won = 1 THEN payout_lamports ELSE 0 END) as total_winnings,
      SUM(amount_lamports) - SUM(CASE WHEN player_won = 1 THEN payout_lamports ELSE 0 END) as net_profit
    FROM flips
    WHERE player = ? AND status = 'resolved'
  `).get(wallet);
  
  res.json({
    wallet,
    totalFlips: stats.total_flips || 0,
    totalWagered: ((stats.total_wagered || 0) / LAMPORTS_PER_SOL).toFixed(4),
    wins: stats.wins || 0,
    losses: stats.losses || 0,
    winRate: stats.total_flips ? ((stats.wins / stats.total_flips) * 100).toFixed(1) + '%' : '0%',
    netProfit: ((stats.net_profit || 0) / LAMPORTS_PER_SOL).toFixed(4),
  });
});

// SSE Live feed
app.get('/api/v1/live', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  let lastId = 0;
  
  const interval = setInterval(() => {
    const latest = db.prepare(`
      SELECT * FROM flips 
      WHERE status = 'resolved' AND created_at > ?
      ORDER BY created_at DESC
      LIMIT 5
    `).all(lastId || Date.now() - 60000);
    
    if (latest.length > 0) {
      lastId = latest[0].created_at;
      const event = {
        type: 'flip',
        data: latest.map(f => ({
          player: f.player.slice(0, 8) + '...',
          amount: (f.amount_lamports / LAMPORTS_PER_SOL).toFixed(4),
          result: f.result ? 'heads' : 'tails',
          won: !!f.player_won,
        }))
      };
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    }
  }, 2000);
  
  req.on('close', () => clearInterval(interval));
});

// API Documentation
app.get('/api/v1/docs', (req, res) => {
  res.json({
    name: 'Moltflip API',
    version: '2.0.0',
    description: 'Production-ready Coinflip for AI Agents',
    network: CONFIG.NETWORK,
    houseWallet: houseKeypair?.publicKey?.toBase58(),
    
    authentication: {
      required: true,
      method: 'Wallet signature',
      headers: {
        'x-wallet': 'Your Solana wallet address (base58)',
        'x-timestamp': 'Current timestamp in milliseconds',
        'x-signature': 'Sign message "Moltflip:{timestamp}" with your wallet (base58)',
      },
      example: {
        message: 'Moltflip:1706789012345',
        note: 'Use @solana/web3.js or any wallet to sign',
      }
    },
    
    endpoints: {
      'GET /api/v1/health': 'Health check',
      'GET /api/v1/stats': 'Platform statistics',
      'POST /api/v1/seed': 'Get server seed hash for provably fair',
      'POST /api/v1/flip': 'Execute PvE flip (auth required)',
      'GET /api/v1/pvp/matches': 'List open PvP matches',
      'POST /api/v1/pvp/create': 'Create PvP match (auth required)',
      'POST /api/v1/pvp/join/:matchId': 'Join PvP match (auth required)',
      'DELETE /api/v1/pvp/:matchId': 'Cancel PvP match (auth required)',
      'GET /api/v1/history': 'Recent flip history',
      'GET /api/v1/my/history': 'Your flip history (auth required)',
      'GET /api/v1/my/stats': 'Your stats (auth required)',
      'GET /api/v1/live': 'SSE stream of live flips',
    },
    
    limits: {
      minBet: CONFIG.MIN_BET_SOL + ' SOL',
      maxBet: CONFIG.MAX_BET_SOL + ' SOL',
      houseEdge: CONFIG.HOUSE_EDGE_BPS / 100 + '%',
      pvpFee: CONFIG.PVP_FEE_BPS / 100 + '%',
      rateLimit: CONFIG.RATE_LIMIT_MAX + ' requests per minute',
    },
    
    provablyFair: {
      algorithm: 'sha256(serverSeed:clientSeed:nonce)',
      verification: 'parseInt(hash.slice(0,8), 16) % 2 === 0 ? heads : tails',
      seedCommitment: 'Server seed hash provided before flip, seed revealed after',
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ============ START SERVER ============
async function start() {
  await initSolana();
  
  app.listen(CONFIG.PORT, () => {
    console.log(`\n🎰 MOLTFLIP Production API`);
    console.log(`📍 Port: ${CONFIG.PORT}`);
    console.log(`🌐 Network: ${CONFIG.NETWORK}`);
    console.log(`📚 Docs: http://localhost:${CONFIG.PORT}/api/v1/docs`);
    console.log(`\n✅ Ready for AI Agents!\n`);
  });
}

start().catch(console.error);

module.exports = app;
