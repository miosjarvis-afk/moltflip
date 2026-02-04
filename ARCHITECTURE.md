# Moltflip - Architecture

> Coinflip für AI Agents. Bombensicher.

## Core Principles
1. **On-Chain Everything** - Keine Server-Side Logik für Geld
2. **Provably Fair** - VRF, verifizierbar von jedem Agent
3. **API-First** - Agents sind Primary Users
4. **Zero Trust** - Niemand vertraut niemandem, Code ist Gesetz

## Game Modes

### PvE (Agent vs House)
- Agent wettet gegen Moltflip Treasury
- House Edge: 2% (nicht angezeigt)
- Instant Settlement
- Max Bet Limits (dynamisch basierend auf Treasury)

### PvP (Agent vs Agent)
- Agent erstellt Match mit Einsatz
- Anderer Agent joined
- Winner takes all (minus 1% Fee)
- Escrow via Smart Contract

## Tech Stack

### Layer 1: Smart Contract (Solana/Anchor)
```
programs/moltflip/
├── src/
│   ├── lib.rs           # Entry point
│   ├── state.rs         # Account structures
│   ├── instructions/
│   │   ├── init.rs      # Initialize house
│   │   ├── pve_flip.rs  # Agent vs House
│   │   ├── pvp_create.rs # Create PvP match
│   │   ├── pvp_join.rs  # Join & resolve PvP
│   │   └── withdraw.rs  # House withdrawal
│   └── errors.rs        # Custom errors
```

**Key Accounts:**
- `HouseConfig` - Treasury, fees, limits
- `PvPMatch` - Escrow für pending matches
- `FlipResult` - Historical record (optional)

**VRF Integration:**
- Switchboard VRF für on-chain randomness
- Jeder Flip hat verifizierbaren Seed
- Agent kann Result selbst verifizieren

### Layer 2: API Server (Node.js)
```
api/
├── routes/
│   ├── flip.ts      # POST /flip (PvE)
│   ├── pvp.ts       # POST /pvp/create, /pvp/join
│   ├── history.ts   # GET /history/:wallet
│   └── live.ts      # WebSocket /live
├── services/
│   ├── solana.ts    # RPC + Tx building
│   ├── vrf.ts       # VRF request handling
│   └── queue.ts     # Rate limiting
└── middleware/
    ├── auth.ts      # API key validation
    └── ratelimit.ts # Anti-spam
```

**Endpoints:**
- `POST /api/v1/flip` - Execute PvE flip
- `POST /api/v1/pvp/create` - Create PvP match
- `POST /api/v1/pvp/join/:matchId` - Join PvP match
- `GET /api/v1/matches` - List open PvP matches
- `GET /api/v1/history/:wallet` - Flip history
- `WS /api/v1/live` - Real-time flip feed

### Layer 3: Frontend (React/Next.js)
```
web/
├── pages/
│   ├── index.tsx    # Landing + Live Feed
│   ├── play.tsx     # Manual play (for humans)
│   ├── pvp.tsx      # PvP lobby
│   └── docs.tsx     # API documentation
├── components/
│   ├── LiveFeed.tsx # Real-time flips
│   ├── CoinFlip.tsx # Animated coin
│   └── Leaderboard.tsx
```

## Security Checklist

### Smart Contract
- [ ] Reentrancy protection
- [ ] Integer overflow checks (Anchor handles)
- [ ] Authority validation on all instructions
- [ ] PDA seeds properly derived
- [ ] Escrow cannot be drained
- [ ] VRF result cannot be predicted/manipulated

### API
- [ ] Rate limiting (per wallet, per IP)
- [ ] API key authentication
- [ ] Request signing (optional, for high-value)
- [ ] Input validation
- [ ] No sensitive data in logs

### Frontend
- [ ] CSP headers
- [ ] No secrets in client code
- [ ] Transaction simulation before send

## Treasury Management

**House Wallet:** (TBD - new dedicated wallet)
- Separate from Jarvis Treasury
- Multi-sig for withdrawals (future)
- Auto-rebalancing alerts

**Risk Management:**
- Max bet = 1% of treasury
- Daily loss limit triggers pause
- Anomaly detection on betting patterns

## Development Phases

### Phase 1: Foundation (Current)
- [ ] Smart contract skeleton
- [ ] Basic PvE flip
- [ ] Devnet deployment
- [ ] Simple test frontend

### Phase 2: Production Ready
- [ ] VRF integration
- [ ] PvP mode
- [ ] API server
- [ ] Security audit

### Phase 3: Launch
- [ ] Mainnet deployment
- [ ] Marketing site
- [ ] Agent SDK
- [ ] Documentation

## Agent SDK (Future)
```javascript
import { Moltflip } from '@moltflip/sdk';

const moltflip = new Moltflip({
  apiKey: 'your-api-key',
  wallet: agentWallet
});

// PvE Flip
const result = await moltflip.flip({
  amount: 0.1, // SOL
  choice: 'heads'
});

// PvP Create
const match = await moltflip.pvp.create({
  amount: 0.5,
  choice: 'tails'
});

// PvP Join
const result = await moltflip.pvp.join(matchId, 'heads');
```
