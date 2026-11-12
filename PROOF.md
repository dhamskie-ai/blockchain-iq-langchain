# Proof of settlement

Two working paid calls through this integration, both to the cheapest
paid resource (`GET /api/x402/v1/brief`, $0.01 USDC on Base), both
settled on-chain with receipt status `success`. Each call was verified
against the USDC `Transfer` event on Base, not just the HTTP response.

## 1. Direct call — `callResource(paidFetch, "/brief")`

- Date: 2026-11-12T10:24:16Z
- Payer: [`0xB0D408E9Bb704fE199088a3C34f8dd2F8C2fa9EC`](https://basescan.org/address/0xB0D408E9Bb704fE199088a3C34f8dd2F8C2fa9EC)
- Pay-to: [`0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e`](https://basescan.org/address/0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e) (Blockchain IQ)
- Amount: 0.01 USDC (10,000 atomic units)
- Settlement: [`0x3c47733de331f5479afda245a6a7c63308227cc8973ebae02b23d245fb0012b7`](https://basescan.org/tx/0x3c47733de331f5479afda245a6a7c63308227cc8973ebae02b23d245fb0012b7)
- Block: 56443405, receipt: success
- On-chain check: USDC `Transfer` 0xB0D4… → 0x617d… of exactly 10,000 in that transaction.

## 2. LangChain tool — `blockchain_iq_brief.invoke({})`

- Date: 2026-11-12T10:25:03Z
- Payer: [`0xB0D408E9Bb704fE199088a3C34f8dd2F8C2fa9EC`](https://basescan.org/address/0xB0D408E9Bb704fE199088a3C34f8dd2F8C2fa9EC)
- Pay-to: [`0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e`](https://basescan.org/address/0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e) (Blockchain IQ)
- Amount: 0.01 USDC (10,000 atomic units)
- Settlement: [`0xa2e32b7f5cf6e4b88454d31492fd7590026c038e0558d3bca5be215c3c31d137`](https://basescan.org/tx/0xa2e32b7f5cf6e4b88454d31492fd7590026c038e0558d3bca5be215c3c31d137)
- Block: 56443637, receipt: success
- Balance check: payer USDC went 0.022099 → 0.012099 (exactly $0.01).

## Reproduce it yourself

```bash
npm install
PRIVATE_KEY=0x... node examples/paid-brief-call.mjs
```

Any EOA holding ≥ $0.01 USDC on Base works. The script prints the
settlement proof from the `PAYMENT-RESPONSE` header, including the
transaction hash.
