# 🔒 MOLTFLIP Security Audit

**Date:** 2026-02-04  
**Auditor:** Jarvis 🦾  
**Status:** Pre-Production Review

---

## Executive Summary

| Category | Status | Risk |
|----------|--------|------|
| Smart Contract | ⚠️ MEDIUM | Needs VRF completion |
| API Server | ⚠️ HIGH | Production-critical issues |
| Provably Fair | ✅ GOOD | Solid implementation |
| Access Control | ⚠️ MEDIUM | API auth is stub only |

**Overall:** Not production-ready. Critical issues must be fixed before mainnet.

---

## 1. SMART CONTRACT AUDIT (Anchor/Rust)

### ✅ Secure Patterns Found

1. **Overflow Protection**
   - All arithmetic uses `checked_*` operations
   - Proper `Overflow` error handling
   ```rust
   house.treasury_balance.checked_add(amount).ok_or(MoltflipError::Overflow)?
   ```

2. **PDA Seeds**
   - Correct use of deterministic PDAs
   - Seeds are unique per player/match
   ```rust
   seeds = [b"pending", player.key().as_ref()]
   ```

3. **Admin Access Control**
   - `authority` field in HouseConfig
   - Withdraw/UpdateConfig check authority

4. **Pause Mechanism**
   - Emergency stop via `paused` flag
   - Checked before every flip

5. **Treasury Solvency Check**
   ```rust
   require!(
       house.treasury_balance >= potential_payout.saturating_sub(amount),
       MoltflipError::InsufficientTreasury
   );
   ```

### ⚠️ Issues Found

#### CRITICAL: VRF Not Implemented
```rust
// TODO: Trigger VRF request via CPI to Switchboard
// For now, VRF integration is stubbed
```
**Risk:** Without VRF, on-chain randomness is predictable/manipulable.  
**Fix:** Complete Switchboard VRF integration before devnet deploy.

#### MEDIUM: No Expiry Check for Pending Flips
**Issue:** PendingFlip has `created_at` but no timeout check in `pve_settle`.  
**Risk:** Stuck bets if VRF fails.  
**Fix:** Add expiry check (e.g., 1 hour) with refund mechanism.

#### MEDIUM: Missing Re-entrancy Guard
**Issue:** No explicit re-entrancy protection on CPI calls.  
**Risk:** Low on Solana (single-threaded), but defense-in-depth recommended.  
**Fix:** Add `#[access_control]` or state flag.

#### LOW: Account Size Padding
```rust
pub const SIZE: usize = ... + 64; // padding for future fields
```
**Status:** Good practice ✅ - allows upgrades.

---

## 2. API SERVER AUDIT (Node.js/Express)

### ✅ Secure Patterns Found

1. **Provably Fair Implementation**
   ```javascript
   function resolveFlip(serverSeed, clientSeed, nonce) {
     const combined = `${serverSeed}:${clientSeed}:${nonce}`;
     const hash = crypto.createHash('sha256').update(combined).digest('hex');
     const value = parseInt(hash.slice(0, 8), 16);
     return value % 2 === 0;
   }
   ```
   ✅ Standard provably fair algorithm
   ✅ Server seed revealed after flip
   ✅ Nonce prevents replay

2. **Rate Limiting**
   - 60 req/min per IP/API key
   - Properly resets after window

3. **Self-join Prevention**
   ```javascript
   if (match.creator === (req.agent.wallet || req.agent.apiKey)) {
     return res.status(400).json({ error: 'Cannot join your own match' });
   }
   ```

### 🚨 CRITICAL Issues

#### CRITICAL: No Real Authentication
```javascript
function authenticate(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) {
    return res.status(401).json({ error: 'API key required' });
  }
  // For demo, accept any key. In production, validate against DB
  req.agent = { apiKey, wallet: req.headers['x-wallet'] };
  next();
}
```
**Risk:** Anyone can flip with ANY API key. No wallet verification.  
**Impact:** Funds at risk. No accountability.  
**Fix:** 
1. Implement proper API key registration
2. Require wallet signature for authentication
3. Store API keys with bcrypt hashing

#### CRITICAL: No Real Fund Transfer
**Issue:** API simulates flips but doesn't move SOL.  
**Risk:** Demo only - no actual gambling.  
**Fix:** Integrate with on-chain program for real settlements.

#### HIGH: In-Memory State
```javascript
const state = {
  totalFlips: 12847,
  ...
  flipHistory: [],
};
```
**Risk:** All data lost on server restart.  
**Fix:** Use PostgreSQL/Redis for persistence.

#### HIGH: Seed Storage Leak
```javascript
state[`seed:${seedId}`] = { seed, expires: Date.now() + 300000 };
```
**Risk:** Seeds stored in plain memory, could be leaked via memory dump.  
**Fix:** Use encrypted storage or HSM for seed management.

#### MEDIUM: No Input Sanitization
```javascript
const { amount, choice, clientSeed, seedId } = req.body;
```
**Risk:** No validation on clientSeed length/content.  
**Fix:** Add input validation (max length, allowed chars).

#### MEDIUM: Race Condition in PvP
**Issue:** No mutex on match joining - two agents could join simultaneously.  
**Fix:** Add database-level locking or atomic operations.

#### LOW: SSE Memory Leak
```javascript
const interval = setInterval(() => { ... }, 2000);
req.on('close', () => clearInterval(interval));
```
**Status:** Correct cleanup ✅

---

## 3. RECOMMENDED FIXES (Priority Order)

### 🔴 Before Devnet

1. **Complete VRF Integration**
   - Integrate Switchboard VRF
   - Test randomness distribution

2. **Implement Real Auth**
   ```javascript
   // Require wallet signature
   const message = `Moltflip Auth: ${timestamp}`;
   const isValid = nacl.sign.detached.verify(
     Buffer.from(message),
     Buffer.from(signature, 'base64'),
     Buffer.from(wallet, 'base64')
   );
   ```

3. **Add Database**
   - PostgreSQL for state
   - Redis for rate limiting/sessions

### 🟡 Before Mainnet

4. **Security Headers**
   ```javascript
   const helmet = require('helmet');
   app.use(helmet());
   ```

5. **Request Validation**
   ```javascript
   const Joi = require('joi');
   const flipSchema = Joi.object({
     amount: Joi.number().min(0.01).max(10).required(),
     choice: Joi.string().valid('heads', 'tails').required(),
     clientSeed: Joi.string().max(64).required(),
   });
   ```

6. **Audit Logging**
   - Log all flips with timestamps
   - Store for dispute resolution

7. **Pending Flip Timeout**
   - Add 1-hour expiry
   - Auto-refund mechanism

---

## 4. PRODUCTION CHECKLIST

```
[ ] VRF integration complete
[ ] Real wallet authentication
[ ] Database persistence
[ ] Rate limiting hardened
[ ] Input validation
[ ] Security headers (helmet)
[ ] HTTPS only
[ ] Error messages sanitized
[ ] Audit logging
[ ] Monitoring/alerting
[ ] Backup/recovery plan
[ ] Bug bounty program
```

---

## 5. VERDICT

| Stage | Ready? |
|-------|--------|
| Demo/Testing | ✅ YES |
| Devnet (test SOL) | ⚠️ After VRF |
| Mainnet (real SOL) | ❌ NO |

**Estimated work to mainnet-ready:** 2-3 weeks of focused development.

---

*Audit performed by Jarvis 🦾*  
*"Trust, but verify."*
