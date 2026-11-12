# blockchain-iq-langchain

LangChain tools for the [Blockchain IQ](https://www.blockchainiq.co) x402 API —
crypto data and research sold to software agents, one request at a time,
paid in USDC on Base via the open [x402](https://www.coinbase.com/developer-platform/products/x402)
standard. No account, no API key: an unpaid request returns HTTP 402 with
the price, the agent pays, and the data comes back as JSON.

Catalogue: https://www.blockchainiq.co/api/x402/v1
Agents page: https://www.blockchainiq.co/agents

## Install

```bash
npm install
```

Node 18+ (uses the built-in `fetch`).

## Quick start

```js
import { createBlockchainIQTools, createWalletClientFromPrivateKey } from "./src/index.js";

// Any EOA holding USDC on Base. The key only signs EIP-3009 payment
// authorisations in memory; it is never sent anywhere or logged.
const walletClient = createWalletClientFromPrivateKey(process.env.PRIVATE_KEY);

const tools = createBlockchainIQTools(walletClient);
// tools: blockchain_iq_brief ($0.01), blockchain_iq_macro ($0.05),
// blockchain_iq_calendar ($0.03), blockchain_iq_indices ($0.03),
// blockchain_iq_network ($0.03), blockchain_iq_stablecoins ($0.02),
// blockchain_iq_research ($0.05)
```

With a LangChain model (JS):

```js
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({ model: "gpt-4o-mini" }).bindTools(tools);
```

## One working paid call (example)

```bash
PRIVATE_KEY=0x... node examples/paid-brief-call.mjs
```

Calls `GET /api/x402/v1/brief` — the cheapest paid resource ($0.01) —
and prints the proof of settlement from the `PAYMENT-RESPONSE` header,
including the transaction hash. The payer pays no gas: the x402
facilitator settles the signed authorisation on-chain.

## Proof of settlement

See [PROOF.md](./PROOF.md) for a recorded paid call (payer, amount,
transaction hash, BaseScan link).

## Costs

| Tool | Resource | Price |
| --- | --- | --- |
| `blockchain_iq_brief` | Market brief (BTC/ETH/SOL/XRP + events + risk flags) | $0.01 |
| `blockchain_iq_macro` | US macro indicators | $0.05 |
| `blockchain_iq_calendar` | Economic & crypto calendar (90 days) | $0.03 |
| `blockchain_iq_indices` | Crypto sector indices list | $0.03 |
| `blockchain_iq_network` | One chain's activity (15 chains) | $0.03 |
| `blockchain_iq_stablecoins` | USDC & EURC supply and control | $0.02 |
| `blockchain_iq_research` | One coin's full research brief | $0.05 |

A 404 or an error response is never charged.

## How payment works

1. The tool calls the resource; the API answers `402` with a
   `PAYMENT-REQUIRED` header (price, pay-to address, asset, network).
2. The `@x402/core` / `@x402/evm` v2 client signs an EIP-3009
   `transferWithAuthorization` for the exact amount (USDC on Base,
   pay-to `0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e`) and retries
   with the `X-PAYMENT` header. The payer pays no gas.
3. The facilitator settles it on-chain and the API returns the data
   plus a `PAYMENT-RESPONSE` header with the settlement transaction
   hash.

Note: the older `x402` / `x402-fetch` 1.x packages only understand
the v1 challenge shape (network names, `maxAmountRequired`) and
cannot pay this server — that is why this package uses `@x402/core`
and `@x402/evm` v2 directly.

## License

MIT
