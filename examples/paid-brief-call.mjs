// Example: one working paid call through x402 to the Blockchain IQ API.
//
// Run:
//   PRIVATE_KEY=0x... node examples/paid-brief-call.mjs
//
// What it does:
//   1. Calls GET /api/x402/v1/brief (the cheapest paid resource, $0.01).
//   2. The first request returns HTTP 402 with the price in the
//      PAYMENT-REQUIRED header; the helper signs an EIP-3009 payment
//      authorisation for exactly $0.01 USDC on Base and retries with
//      the X-PAYMENT header. The payer pays no gas — the facilitator
//      settles the authorisation on-chain.
//   3. Prints the brief (first 500 chars) and the proof of settlement
//      from the PAYMENT-RESPONSE header, including the transaction hash.
//
// The wallet needs at least $0.01 USDC on Base. A 404 or error response
// is never charged.
import { createWalletClientFromPrivateKey } from "../src/index.js";
import { createPaidFetch, callResource } from "../src/index.js";

const privateKey = process.env.PRIVATE_KEY;
if (!privateKey) {
  console.error("Set PRIVATE_KEY (0x-prefixed) to a Base wallet holding >= $0.01 USDC.");
  process.exit(1);
}

const walletClient = createWalletClientFromPrivateKey(privateKey);
console.log("payer:", walletClient.account.address);
console.log("resource: GET /api/x402/v1/brief — $0.01 USDC on Base");

const paidFetch = createPaidFetch(walletClient);
const { data, proof, pricePaidUsdc } = await callResource(paidFetch, "/brief");

console.log("price paid (USDC):", pricePaidUsdc);
console.log("payment proof:", JSON.stringify(proof, null, 2));
console.log("brief (truncated):", JSON.stringify(data).slice(0, 500));
console.log("settlement tx:", proof?.transaction ?? proof?.txHash ?? "(see proof above)");
