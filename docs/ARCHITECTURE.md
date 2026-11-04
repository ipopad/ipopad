# Architecture

Two processes share one machine and two SQLite databases.

| Process | File | Job |
|---|---|---|
| Site server | `api/server.mjs` | Serves the site and API. Prepares launches and trades for wallets to sign, and relays them |
| Migration service | `api/graduator.mjs` | Watches curves, runs every migration step, holds the hot wallet's only automatic signing path for migrations |

`ipo.db` holds what the site shows. `ledger.db` holds what the migration service must never lose.

## A launch

1. The wallet signs a short message. The server pins the image and metadata, takes an address ending in `ipo` from the pool, builds the transaction and simulates it.
2. The wallet signs the transaction. The server checks it is exactly the prepared one, records its signature, then sends it. A restart during the send cannot lose a coin, because the signature is already on the books.
3. Once the coin is on chain it goes into the ledger, and the migration service follows it.

Curves are shaped to Pumpfun's own, per size and per pair. Custom pairs get a curve matched to where that pair's curve starts on Pumpfun (`hk/lib/configs.mjs`).

## A migration

`hk/lib/graduate.mjs` is a state machine with one step per on-chain action:

```
trading → complete → fee_withdrawn → fees_claimed → indexed → launched
        → settled → burned → pushed → migrated → done
```

- **Ledger first.** Each signature is written before its transaction is sent. After a crash, the step reads what happened on chain instead of sending again.
- **Settlement from history.** Holders are worked out from the token's full on-chain history (`hk/lib/settle.mjs`), not from a balance snapshot at one moment.
- **Pushes.** Coins go out nine wallets to a transaction. A share too small to be worth sending is burned, so every other holder owns a larger part of the coin.
- **Bounded payouts.** The number of wallets paid is capped at what the coin's holdback covers.
- **Stalls.** A coin that keeps failing a step is parked for a person, and the others keep moving.

## Creator fees

Meteora only lets the creator's own wallet claim a creator share, so coins use curves that give the creator 0% on chain. The platform's claim holds the share.

Collecting (`hk/lib/creator-fee.mjs`) claims exactly what is owed and sends it to the creator in one transaction, so a payment can only come from that coin's own fees. Migration pays the rest, counting what was already collected.

## The hook

`hk/hook/src/lib.rs` runs on every transfer of a curve token. It recognises a trade with the curve and enforces the coin's rules, which are stored in an account made at launch. Completing the curve revokes the hook, and the coin that migrates to Pumpfun has no hook at all.

## Watching it

`scripts/watchdog.mjs` runs outside the migration service, so a dead service is still reported. It alerts on a service that is down or not finishing passes, stalled or slow migrations, a low hot wallet, a low address pool and failed payouts. `/analytics` is built from the same records (`api/analytics.mjs`).
