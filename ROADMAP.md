# 🚀 MOLTFLIP Launch Roadmap

**Ziel:** Production-ready für echte SOL auf Mainnet

---

## Phase 1: API Hosting (⏱️ 30 min)
**Status: 🔴 TODO**

Die API läuft aktuell nur lokal. Braucht permanentes Hosting.

| Task | Plattform | Kosten | Zeit |
|------|-----------|--------|------|
| [ ] API auf Render.com deployen | Render | $0 | 15 min |
| [ ] Environment Variables setzen | - | - | 5 min |
| [ ] API URL in Frontend updaten | GitHub | $0 | 5 min |
| [ ] Health Check testen | - | - | 5 min |

**Commands:**
```bash
# Render.com - kostenlos für kleine Projekte
# 1. Account erstellen: render.com
# 2. New → Web Service → Connect GitHub
# 3. Root: /api, Build: npm install, Start: node server-production.js
```

---

## Phase 2: House Wallet Funding (⏱️ 10 min)
**Status: 🔴 TODO**

Ohne SOL im House Wallet = keine Auszahlungen möglich.

| Task | Beschreibung | Kosten |
|------|--------------|--------|
| [ ] Devnet SOL holen | Faucet oder Phantom | $0 |
| [ ] End-to-End Test auf Devnet | 5 Flips testen | $0 |
| [ ] Mainnet SOL einzahlen | Für echten Launch | ~$50-100 |

**House Wallet:** `ChWbRpZfZy77rs5VNfXZ3hpCw5rkpyFcho34Pq7o6RBk`

**Empfohlenes Startkapital:** 
- Devnet: 10 SOL (kostenlos)
- Mainnet: 5-10 SOL (~$100-200)

---

## Phase 3: Mainnet Switch (⏱️ 5 min)
**Status: 🔴 TODO**

| Task | Änderung |
|------|----------|
| [ ] RPC URL ändern | `https://api.mainnet-beta.solana.com` |
| [ ] Network Config | `NETWORK=mainnet-beta` |
| [ ] Frontend RPC | Mainnet Cluster |
| [ ] Wallet auf Mainnet | Switch in Phantom |

---

## Phase 4: Custom Domain (⏱️ 15 min)
**Status: 🟡 OPTIONAL**

| Option | Kosten | Empfehlung |
|--------|--------|------------|
| GitHub Pages + Custom Domain | $10/Jahr | ⭐ Gut |
| Vercel + Custom Domain | $10/Jahr | ⭐ Gut |
| Bleib bei github.io | $0 | ✅ OK für Start |

**Domain-Optionen:**
- `moltflip.com` (~$12/Jahr)
- `moltflip.xyz` (~$3/Jahr)
- `moltflip.gg` (~$15/Jahr)

---

## Phase 5: Marketing & Launch (⏱️ ongoing)
**Status: 🔴 TODO**

| Task | Plattform | Ziel |
|------|-----------|------|
| [ ] Twitter/X Account | @moltflip | AI Agent Community |
| [ ] Landing Page Text | GitHub | Erklärung für Devs |
| [ ] API Docs veröffentlichen | README | Agent-Entwickler |
| [ ] Discord/Telegram Gruppe | - | Community |
| [ ] AI Agent Verzeichnisse | - | Reichweite |

---

## 📋 LAUNCH CHECKLIST

### Vor Devnet Launch
```
[x] GitHub Repo erstellt
[x] Frontend auf GitHub Pages
[x] Wallet Auth implementiert
[x] Provably Fair implementiert
[x] SQLite Persistence
[ ] API hosted (Render)
[ ] Devnet SOL im Wallet
[ ] 10 Test-Flips erfolgreich
```

### Vor Mainnet Launch
```
[ ] Devnet vollständig getestet
[ ] Security Audit Review
[ ] Mainnet RPC konfiguriert
[ ] Mainnet SOL eingezahlt (~5 SOL min)
[ ] Rate Limiting getestet
[ ] Monitoring Setup
[ ] Backup Strategy
```

### Nach Launch
```
[ ] Twitter Announcement
[ ] API Docs public
[ ] Erste echte Agents spielen
[ ] Monitoring 24/7
```

---

## ⏱️ Zeit-Schätzung

| Phase | Zeit | Wer |
|-------|------|-----|
| Phase 1: API Hosting | 30 min | Jarvis |
| Phase 2: Funding | 10 min | Samu |
| Phase 3: Mainnet | 5 min | Jarvis |
| Phase 4: Domain | 15 min | Optional |
| Phase 5: Marketing | Ongoing | Beide |

**Total bis Devnet-Ready:** ~45 min
**Total bis Mainnet-Ready:** ~1-2 Stunden

---

## 🎯 Nächster Schritt

**JETZT:** Phase 1 - API auf Render.com hosten

Soll ich anfangen? 🦾

---

*Last updated: 2026-02-04*
