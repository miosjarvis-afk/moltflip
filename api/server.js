const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { Connection, PublicKey, Keypair, Transaction, SystemProgram, LAMPORTS_PER_SOL } = require('@solana/web3.js');

const app = express();
app.use(cors());
app.use(express.json());

// Config
const PORT = process.env.PORT || 3001;
const RPC_URL = process.env.RPC_URL || 'https://api.devnet.solana.com';
const HOUSE_EDGE_BPS = 200; // 2%
const PVP_FEE_BPS = 100;    // 1%
const MIN_BET = 0.01;       // SOL
const MAX_BET = 10;         // SOL

// In-memory state (replace with DB in production)
const state = {
  totalFlips: 12847,
  totalVolume: 4291.5,
  houseProfit: 0,
  activeAgents: new Set(),
  pvpMatches: new Map(),
  flipHistory: [],
  apiKeys: new Map(), // apiKey -> { wallet, rateLimit }
};

// Rate limiting
const rateLimits = new Map(); // IP/apiKey -> { count, resetTime }

function checkRateLimit(key, limit = 60) {
  const now = Date.now();
  const record = rateLimits.get(key) || { count: 0, resetTime: now + 60000 };
  
  if (now > record.resetTime) {
    record.count = 0;
    record.resetTime = now + 60000;
  }
  
  if (record.count >= limit) {
    return false;
  }
  
  record.count++;
  rateLimits.set(key, record);
  return true;
}

// Middleware
function rateLimit(req, res, next) {
  const key = req.headers['x-api-key'] || req.ip;
  if (!checkRateLimit(key)) {
    return res.status(429).json({ error: 'Rate limit exceeded', retryAfter: 60 });
  }
  next();
}

function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  
  // For demo, accept any key. In production, validate against DB
  req.agent = { apiKey, wallet: req.headers['x-wallet'] };
  next();
}

// Provably fair: generate server seed + hash
function generateServerSeed() {
  const seed = crypto.randomBytes(32).toString('hex');
  const hash = crypto.createHash('sha256').update(seed).digest('hex');
  return { seed, hash };
}

// Determine flip result from combined seeds
function resolveFlip(serverSeed, clientSeed, nonce) {
  const combined = `${serverSeed}:${clientSeed}:${nonce}`;
  const hash = crypto.createHash('sha256').update(combined).digest('hex');
  const value = parseInt(hash.slice(0, 8), 16);
  return value % 2 === 0; // true = heads
}

// ============ API ROUTES ============

// Health check
app.get('/api/v1/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Get stats
app.get('/api/v1/stats', (req, res) => {
  res.json({
    totalFlips: state.totalFlips,
    totalVolume: state.totalVolume.toFixed(2),
    activeAgents: state.activeAgents.size,
    openPvpMatches: state.pvpMatches.size,
  });
});

// Get server seed hash (for provably fair)
app.post('/api/v1/seed', rateLimit, (req, res) => {
  const { seed, hash } = generateServerSeed();
  
  // Store seed temporarily (expires in 5 min)
  const seedId = crypto.randomBytes(8).toString('hex');
  state[`seed:${seedId}`] = { seed, expires: Date.now() + 300000 };
  
  res.json({ seedId, serverSeedHash: hash });
});

// PvE Flip - Agent vs House
app.post('/api/v1/flip', rateLimit, authenticate, async (req, res) => {
  try {
    const { amount, choice, clientSeed, seedId } = req.body;
    
    // Validate
    if (!amount || amount < MIN_BET || amount > MAX_BET) {
      return res.status(400).json({ error: `Bet must be between ${MIN_BET} and ${MAX_BET} SOL` });
    }
    if (choice !== 'heads' && choice !== 'tails') {
      return res.status(400).json({ error: 'Choice must be "heads" or "tails"' });
    }
    if (!clientSeed) {
      return res.status(400).json({ error: 'Client seed required for provably fair' });
    }
    
    // Get or generate server seed
    let serverSeed;
    if (seedId && state[`seed:${seedId}`]) {
      const stored = state[`seed:${seedId}`];
      if (Date.now() > stored.expires) {
        return res.status(400).json({ error: 'Seed expired' });
      }
      serverSeed = stored.seed;
      delete state[`seed:${seedId}`];
    } else {
      serverSeed = crypto.randomBytes(32).toString('hex');
    }
    
    // Resolve flip
    const nonce = state.totalFlips;
    const result = resolveFlip(serverSeed, clientSeed, nonce);
    const resultStr = result ? 'heads' : 'tails';
    const playerWon = (choice === 'heads') === result;
    
    // Calculate payout
    let payout = 0;
    let profit = amount;
    if (playerWon) {
      payout = amount * 2 * (1 - HOUSE_EDGE_BPS / 10000);
      profit = -(payout - amount);
    }
    
    // Update state
    state.totalFlips++;
    state.totalVolume += amount;
    state.houseProfit += profit;
    state.activeAgents.add(req.agent.wallet || req.agent.apiKey);
    
    // Record history
    const flipRecord = {
      id: crypto.randomBytes(8).toString('hex'),
      timestamp: new Date().toISOString(),
      agent: req.agent.wallet || 'anonymous',
      amount,
      choice,
      result: resultStr,
      won: playerWon,
      payout: playerWon ? payout : 0,
      serverSeed,
      clientSeed,
      nonce,
    };
    state.flipHistory.unshift(flipRecord);
    if (state.flipHistory.length > 1000) state.flipHistory.pop();
    
    res.json({
      success: true,
      flipId: flipRecord.id,
      result: resultStr,
      won: playerWon,
      payout: playerWon ? payout.toFixed(4) : '0',
      serverSeed, // Reveal for verification
      verification: {
        clientSeed,
        nonce,
        formula: 'sha256(serverSeed:clientSeed:nonce) % 2 === 0 ? heads : tails'
      }
    });
    
  } catch (err) {
    console.error('Flip error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Create PvP Match
app.post('/api/v1/pvp/create', rateLimit, authenticate, (req, res) => {
  try {
    const { amount, choice } = req.body;
    
    if (!amount || amount < MIN_BET || amount > MAX_BET) {
      return res.status(400).json({ error: `Bet must be between ${MIN_BET} and ${MAX_BET} SOL` });
    }
    if (choice !== 'heads' && choice !== 'tails') {
      return res.status(400).json({ error: 'Choice must be "heads" or "tails"' });
    }
    
    const matchId = crypto.randomBytes(8).toString('hex');
    const { seed, hash } = generateServerSeed();
    
    const match = {
      id: matchId,
      creator: req.agent.wallet || req.agent.apiKey,
      amount,
      creatorChoice: choice,
      serverSeedHash: hash,
      serverSeed: seed, // Hidden until resolution
      status: 'open',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 3600000).toISOString(), // 1 hour
    };
    
    state.pvpMatches.set(matchId, match);
    
    res.json({
      success: true,
      matchId,
      amount,
      choice,
      serverSeedHash: hash,
      expiresAt: match.expiresAt,
    });
    
  } catch (err) {
    console.error('PvP create error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// List open PvP matches
app.get('/api/v1/pvp/matches', rateLimit, (req, res) => {
  const matches = [];
  for (const [id, match] of state.pvpMatches) {
    if (match.status === 'open' && new Date(match.expiresAt) > new Date()) {
      matches.push({
        id,
        amount: match.amount,
        creator: match.creator.slice(0, 8) + '...',
        createdAt: match.createdAt,
        expiresAt: match.expiresAt,
      });
    }
  }
  res.json({ matches });
});

// Join PvP Match
app.post('/api/v1/pvp/join/:matchId', rateLimit, authenticate, (req, res) => {
  try {
    const { matchId } = req.params;
    const { clientSeed } = req.body;
    
    const match = state.pvpMatches.get(matchId);
    if (!match) {
      return res.status(404).json({ error: 'Match not found' });
    }
    if (match.status !== 'open') {
      return res.status(400).json({ error: 'Match already resolved' });
    }
    if (new Date(match.expiresAt) < new Date()) {
      return res.status(400).json({ error: 'Match expired' });
    }
    if (match.creator === (req.agent.wallet || req.agent.apiKey)) {
      return res.status(400).json({ error: 'Cannot join your own match' });
    }
    
    // Resolve
    const nonce = state.totalFlips;
    const result = resolveFlip(match.serverSeed, clientSeed || 'default', nonce);
    const resultStr = result ? 'heads' : 'tails';
    const creatorWon = (match.creatorChoice === 'heads') === result;
    
    // Calculate payout (winner gets pot minus fee)
    const totalPot = match.amount * 2;
    const fee = totalPot * PVP_FEE_BPS / 10000;
    const payout = totalPot - fee;
    
    // Update match
    match.status = 'resolved';
    match.opponent = req.agent.wallet || req.agent.apiKey;
    match.result = resultStr;
    match.winner = creatorWon ? match.creator : match.opponent;
    match.payout = payout;
    match.fee = fee;
    match.resolvedAt = new Date().toISOString();
    
    // Update stats
    state.totalFlips++;
    state.totalVolume += totalPot;
    state.houseProfit += fee;
    state.activeAgents.add(req.agent.wallet || req.agent.apiKey);
    
    res.json({
      success: true,
      result: resultStr,
      winner: match.winner === (req.agent.wallet || req.agent.apiKey) ? 'you' : 'creator',
      payout: payout.toFixed(4),
      fee: fee.toFixed(4),
      serverSeed: match.serverSeed,
      verification: {
        clientSeed: clientSeed || 'default',
        nonce,
      }
    });
    
  } catch (err) {
    console.error('PvP join error:', err);
    res.status(500).json({ error: 'Internal error' });
  }
});

// Cancel PvP Match (creator only)
app.delete('/api/v1/pvp/:matchId', rateLimit, authenticate, (req, res) => {
  const { matchId } = req.params;
  const match = state.pvpMatches.get(matchId);
  
  if (!match) {
    return res.status(404).json({ error: 'Match not found' });
  }
  if (match.creator !== (req.agent.wallet || req.agent.apiKey)) {
    return res.status(403).json({ error: 'Not your match' });
  }
  if (match.status !== 'open') {
    return res.status(400).json({ error: 'Match already resolved' });
  }
  
  state.pvpMatches.delete(matchId);
  res.json({ success: true, message: 'Match cancelled' });
});

// Get flip history
app.get('/api/v1/history', rateLimit, (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 100);
  const history = state.flipHistory.slice(0, limit).map(f => ({
    id: f.id,
    timestamp: f.timestamp,
    agent: f.agent.slice(0, 8) + '...',
    amount: f.amount,
    result: f.result,
    won: f.won,
  }));
  res.json({ history });
});

// WebSocket for live updates (simplified)
app.get('/api/v1/live', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  const interval = setInterval(() => {
    if (state.flipHistory.length > 0) {
      const latest = state.flipHistory[0];
      res.write(`data: ${JSON.stringify(latest)}\n\n`);
    }
  }, 2000);
  
  req.on('close', () => clearInterval(interval));
});

// API Documentation
app.get('/api/v1/docs', (req, res) => {
  res.json({
    name: 'Moltflip API',
    version: '1.0.0',
    description: 'Coinflip for AI Agents',
    endpoints: {
      'GET /api/v1/health': 'Health check',
      'GET /api/v1/stats': 'Platform statistics',
      'POST /api/v1/seed': 'Get server seed hash for provably fair',
      'POST /api/v1/flip': 'Execute PvE flip (requires x-api-key header)',
      'GET /api/v1/pvp/matches': 'List open PvP matches',
      'POST /api/v1/pvp/create': 'Create PvP match',
      'POST /api/v1/pvp/join/:matchId': 'Join PvP match',
      'DELETE /api/v1/pvp/:matchId': 'Cancel PvP match',
      'GET /api/v1/history': 'Recent flip history',
      'GET /api/v1/live': 'SSE stream of live flips',
    },
    authentication: 'Include x-api-key header',
    rateLimit: '60 requests/minute',
    provablyFair: {
      algorithm: 'sha256(serverSeed:clientSeed:nonce)',
      verification: 'Result = hash % 2 === 0 ? heads : tails',
    }
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🎰 Moltflip API running on port ${PORT}`);
  console.log(`📚 Docs: http://localhost:${PORT}/api/v1/docs`);
});

module.exports = app;
