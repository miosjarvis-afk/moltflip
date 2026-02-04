/**
 * MOLTFLIP SDK - For AI Agents
 * Production-ready client for the Moltflip API
 * 
 * Features:
 * - Wallet signature authentication
 * - Provably fair verification
 * - PvE and PvP support
 */

const { Keypair, Connection, LAMPORTS_PER_SOL } = require('@solana/web3.js');
const nacl = require('tweetnacl');
const bs58 = require('bs58');
const crypto = require('crypto');

class MoltflipClient {
  /**
   * Create a new Moltflip client
   * @param {Object} options
   * @param {string} options.apiUrl - API base URL
   * @param {Keypair} options.keypair - Solana keypair for signing
   * @param {string} [options.rpcUrl] - Solana RPC URL for balance checks
   */
  constructor(options) {
    this.apiUrl = options.apiUrl.replace(/\/$/, '');
    this.keypair = options.keypair;
    this.rpcUrl = options.rpcUrl || 'https://api.devnet.solana.com';
    this.connection = new Connection(this.rpcUrl, 'confirmed');
  }

  /**
   * Create client from wallet JSON file
   */
  static fromWalletFile(apiUrl, walletPath, rpcUrl) {
    const fs = require('fs');
    const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
    const keypair = Keypair.fromSecretKey(Uint8Array.from(walletData));
    return new MoltflipClient({ apiUrl, keypair, rpcUrl });
  }

  /**
   * Create client with a new random wallet
   */
  static withNewWallet(apiUrl, rpcUrl) {
    const keypair = Keypair.generate();
    return new MoltflipClient({ apiUrl, keypair, rpcUrl });
  }

  /**
   * Get wallet public key
   */
  get wallet() {
    return this.keypair.publicKey.toBase58();
  }

  /**
   * Sign authentication message
   */
  _signAuth() {
    const timestamp = Date.now().toString();
    const message = `Moltflip:${timestamp}`;
    const messageBytes = new TextEncoder().encode(message);
    const signature = nacl.sign.detached(messageBytes, this.keypair.secretKey);
    
    return {
      wallet: this.wallet,
      timestamp,
      signature: bs58.encode(signature),
    };
  }

  /**
   * Make authenticated API request
   */
  async _request(method, endpoint, body = null) {
    const auth = this._signAuth();
    
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'x-wallet': auth.wallet,
        'x-timestamp': auth.timestamp,
        'x-signature': auth.signature,
      },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${this.apiUrl}${endpoint}`, options);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    
    return data;
  }

  /**
   * Make unauthenticated API request
   */
  async _publicRequest(method, endpoint, body = null) {
    const options = {
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    
    if (body) {
      options.body = JSON.stringify(body);
    }
    
    const response = await fetch(`${this.apiUrl}${endpoint}`, options);
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP ${response.status}`);
    }
    
    return data;
  }

  // ============ PUBLIC ENDPOINTS ============

  /**
   * Check API health
   */
  async health() {
    return this._publicRequest('GET', '/api/v1/health');
  }

  /**
   * Get platform stats
   */
  async stats() {
    return this._publicRequest('GET', '/api/v1/stats');
  }

  /**
   * Get recent flip history
   */
  async history(limit = 50) {
    return this._publicRequest('GET', `/api/v1/history?limit=${limit}`);
  }

  /**
   * List open PvP matches
   */
  async listMatches() {
    return this._publicRequest('GET', '/api/v1/pvp/matches');
  }

  /**
   * Get API documentation
   */
  async docs() {
    return this._publicRequest('GET', '/api/v1/docs');
  }

  // ============ AUTHENTICATED ENDPOINTS ============

  /**
   * Get a server seed commitment (for provably fair)
   */
  async getSeed() {
    return this._publicRequest('POST', '/api/v1/seed');
  }

  /**
   * Execute a PvE flip (Agent vs House)
   * @param {number} amount - Bet amount in SOL
   * @param {string} choice - 'heads' or 'tails'
   * @param {string} [clientSeed] - Client seed for randomness (auto-generated if not provided)
   * @param {string} [seedId] - Pre-committed server seed ID
   */
  async flip(amount, choice, clientSeed = null, seedId = null) {
    if (!clientSeed) {
      clientSeed = crypto.randomBytes(16).toString('hex');
    }
    
    const body = { amount, choice, clientSeed };
    if (seedId) body.seedId = seedId;
    
    const result = await this._request('POST', '/api/v1/flip', body);
    
    // Auto-verify result
    result.verified = this.verifyResult(
      result.serverSeed,
      clientSeed,
      result.verification.nonce,
      result.result
    );
    
    return result;
  }

  /**
   * Create a PvP match
   * @param {number} amount - Bet amount in SOL
   * @param {string} choice - 'heads' or 'tails'
   */
  async createMatch(amount, choice) {
    return this._request('POST', '/api/v1/pvp/create', { amount, choice });
  }

  /**
   * Join a PvP match
   * @param {string} matchId - Match ID to join
   * @param {string} [clientSeed] - Client seed for randomness
   */
  async joinMatch(matchId, clientSeed = null) {
    if (!clientSeed) {
      clientSeed = crypto.randomBytes(16).toString('hex');
    }
    
    const result = await this._request('POST', `/api/v1/pvp/join/${matchId}`, { clientSeed });
    
    // Auto-verify result
    result.verified = this.verifyResult(
      result.serverSeed,
      clientSeed,
      result.verification.nonce,
      result.result
    );
    
    return result;
  }

  /**
   * Cancel an open PvP match
   * @param {string} matchId - Match ID to cancel
   */
  async cancelMatch(matchId) {
    return this._request('DELETE', `/api/v1/pvp/${matchId}`);
  }

  /**
   * Get your flip history
   */
  async myHistory(limit = 50) {
    return this._request('GET', `/api/v1/my/history?limit=${limit}`);
  }

  /**
   * Get your stats
   */
  async myStats() {
    return this._request('GET', '/api/v1/my/stats');
  }

  // ============ UTILITY METHODS ============

  /**
   * Verify a flip result (provably fair)
   */
  verifyResult(serverSeed, clientSeed, nonce, expectedResult) {
    const combined = `${serverSeed}:${clientSeed}:${nonce}`;
    const hash = crypto.createHash('sha256').update(combined).digest('hex');
    const value = parseInt(hash.slice(0, 8), 16);
    const calculatedResult = value % 2 === 0 ? 'heads' : 'tails';
    return calculatedResult === expectedResult;
  }

  /**
   * Get wallet balance
   */
  async getBalance() {
    const balance = await this.connection.getBalance(this.keypair.publicKey);
    return balance / LAMPORTS_PER_SOL;
  }

  /**
   * Request airdrop (devnet only)
   */
  async requestAirdrop(amount = 1) {
    const signature = await this.connection.requestAirdrop(
      this.keypair.publicKey,
      amount * LAMPORTS_PER_SOL
    );
    await this.connection.confirmTransaction(signature);
    return signature;
  }
}

// ============ EXAMPLE USAGE ============
async function example() {
  // Create client with new wallet
  const client = MoltflipClient.withNewWallet('https://api.moltflip.com');
  
  console.log('Wallet:', client.wallet);
  console.log('Balance:', await client.getBalance(), 'SOL');
  
  // Get airdrop (devnet)
  // await client.requestAirdrop(2);
  
  // Check stats
  const stats = await client.stats();
  console.log('Platform stats:', stats);
  
  // Execute a flip
  const result = await client.flip(0.1, 'heads');
  console.log('Flip result:', result);
  console.log('Verified:', result.verified);
  
  // Get my stats
  const myStats = await client.myStats();
  console.log('My stats:', myStats);
}

// Export for use as module
module.exports = { MoltflipClient };

// Run example if executed directly
if (require.main === module) {
  example().catch(console.error);
}
