/**
 * blockchain-iq-langchain
 * LangChain tools for the Blockchain IQ x402 API.
 *
 * Blockchain IQ sells crypto data and research to software agents, one
 * request at a time, paid in USDC on Base via the open x402 standard.
 * No account, no API key: an unpaid request returns HTTP 402 with the
 * price, the agent pays, and the data comes back as JSON.
 *
 * Catalogue: https://www.blockchainiq.co/api/x402/v1
 * Docs (agents page): https://www.blockchainiq.co/agents
 * Bounty: https://www.blockchainiq.co/blog/x402-build-bounties
 */
import { createWalletClient, http, publicActions, getAddress } from "viem";
import { base } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import { decodePaymentResponseHeader } from "@x402/core/http";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

export const BLOCKCHAIN_IQ_BASE_URL = "https://www.blockchainiq.co";
export const BLOCKCHAIN_IQ_API = `${BLOCKCHAIN_IQ_BASE_URL}/api/x402/v1`;
export const BLOCKCHAIN_IQ_CHAIN = base; // eip155:8453
export const BLOCKCHAIN_IQ_PAY_TO = "0x617dA9383fbA67e86137BC4924b8b7E400fB7C9e";
export const BLOCKCHAIN_IQ_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * Build a fetch() that pays x402 charges automatically from a viem
 * wallet client (any EOA holding USDC on Base). The client only signs
 * an EIP-3009 payment authorisation; the facilitator settles it
 * on-chain, so the payer pays no gas — only the exact resource price.
 * Refuses any single payment above maxValue (default 0.10 USDC).
 *
 * This server speaks x402 v2: the HTTP 402 response carries the
 * payment requirements in the `PAYMENT-REQUIRED` header (base64
 * JSON), and the payment goes back in an `X-PAYMENT` header. The
 * protocol is implemented with the official `@x402/core` /
 * `@x402/evm` v2 client (the same stack the Taskmarket CLI vendors
 * for its own x402 payments). Note the older `x402`/`x402-fetch`
 * 1.x packages only understand the v1 challenge shape (network
 * names, `maxAmountRequired`) and cannot pay this server.
 *
 * @param {object} walletClient a viem WalletClient for Base, e.g. from
 *   createWalletClientFromPrivateKey(). Must hold USDC on Base.
 * @param {bigint} [maxValue] max payment per call in atomic USDC units
 *   (6 decimals). Default 100000n = 0.10 USDC. Enforced here before
 *   anything is signed (the client's own spend controls are disabled
 *   because this cap is stricter).
 * @returns {typeof fetch} a fetch that handles HTTP 402 for you
 */
export function createPaidFetch(walletClient, maxValue = 100000n) {
  const signer = {
    ...walletClient,
    address: getAddress(walletClient.account.address),
  };
  const client = new x402Client().setSpendControls(false);
  client.register("eip155:*", new ExactEvmScheme(signer));
  const httpClient = new x402HTTPClient(client);

  return async (input, init) => {
    const response = await fetch(input, init);
    if (response.status !== 402) {
      return response;
    }
    if (init?.__is402Retry) {
      throw new Error("Payment already attempted");
    }
    const paymentRequired = httpClient.getPaymentRequiredResponse((name) =>
      response.headers.get(name),
    );
    // Only the Base / exact option is payable from this wallet.
    // (The challenge also lists a Solana option we cannot sign.)
    const baseAccept = (paymentRequired.accepts ?? []).find(
      (a) => a.network === "eip155:8453" && a.scheme === "exact",
    );
    if (!baseAccept) {
      throw new Error("No Base/USDC payment option in the 402 challenge");
    }
    if (BigInt(baseAccept.amount) > maxValue) {
      throw new Error(
        `Payment amount ${baseAccept.amount} exceeds maximum allowed ${maxValue}`,
      );
    }
    const payload = await httpClient.createPaymentPayload(paymentRequired);
    const paymentHeaders = httpClient.encodePaymentSignatureHeader(payload);
    const newInit = {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...paymentHeaders,
        "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE",
      },
      __is402Retry: true,
    };
    const paidResponse = await fetch(input, newInit);
    if (paidResponse.status === 402) {
      // Payment was refused (e.g. insufficient USDC). The v2 challenge
      // carries the reason in its `error` field.
      let reason = "payment refused";
      try {
        const header = paidResponse.headers.get("payment-required");
        if (header) {
          const decoded = JSON.parse(
            Buffer.from(header, "base64").toString("utf8"),
          );
          if (decoded.error) reason = decoded.error;
        }
      } catch {
        // keep the generic reason
      }
      throw new Error(`x402 payment refused (HTTP 402): ${reason}`);
    }
    // Attach what was authorised so callers can report the exact price
    // (the v2 SettleResponse omits `amount` for `exact` payments).
    paidResponse.payment = {
      amount: baseAccept.amount,
      asset: baseAccept.asset,
      payTo: baseAccept.payTo,
      network: baseAccept.network,
      scheme: baseAccept.scheme,
    };
    return paidResponse;
  };
}

/**
 * Build a viem WalletClient for Base from a raw private key
 * (0x-prefixed), extended with the public actions x402 needs.
 * The key is only used in-memory to sign payment authorisations;
 * it is never sent anywhere or logged.
 *
 * @param {`0x${string}`} privateKey
 * @param {string} [rpcUrl] Base RPC endpoint (default: mainnet.base.org)
 */
export function createWalletClientFromPrivateKey(
  privateKey,
  rpcUrl = "https://mainnet.base.org",
) {
  return createWalletClient({
    account: privateKeyToAccount(privateKey),
    chain: base,
    transport: http(rpcUrl),
  }).extend(publicActions);
}

/**
 * Call one Blockchain IQ resource and return the parsed JSON plus the
 * settlement proof from the PAYMENT-RESPONSE header (when the call was
 * paid). Unpaid (free) resources return proof: null.
 *
 * @param {typeof fetch} paidFetch fetch from createPaidFetch()
 * @param {string} path resource path, e.g. "/brief" (leading slash ok)
 * @returns {Promise<{ data: unknown, proof: object | null, pricePaidUsdc: string | null }>}
 */
export async function callResource(paidFetch, path) {
  const url = `${BLOCKCHAIN_IQ_API}${path.startsWith("/") ? path : `/${path}`}`;
  const res = await paidFetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Blockchain IQ ${path} failed: HTTP ${res.status} ${text.slice(0, 300)}`,
    );
  }
  const proofHeader = res.headers.get("payment-response");
  let proof = null;
  let pricePaidUsdc = null;
  if (proofHeader) {
    try {
      proof = decodePaymentResponseHeader(proofHeader);
    } catch {
      try {
        proof = JSON.parse(
          Buffer.from(proofHeader, "base64").toString("utf8"),
        );
      } catch {
        proof = { raw: proofHeader };
      }
    }
    // x402 v2 settlement payloads carry the amount in atomic USDC units
    // for `upto` payments; for `exact` payments the amount is what was
    // authorised (attached to the response by createPaidFetch).
    const amount =
      proof?.amount ??
      proof?.accepted?.amount ??
      proof?.payment?.amount ??
      proof?.settleResponse?.amount ??
      res.payment?.amount;
    if (amount != null) pricePaidUsdc = (Number(amount) / 1e6).toFixed(6);
  }
  const data = await res.json();
  return { data, proof, pricePaidUsdc };
}

const briefSchema = z.object({});

/** A LangChain tool per resource. All tools share one paid fetch. */

/**
 * Build the LangChain tools for Blockchain IQ.
 *
 * @param {object} walletClient viem WalletClient for Base (see
 *   createWalletClientFromPrivateKey). Must hold enough USDC on Base
 *   for the resources you call (cheapest paid call: brief, $0.01).
 * @returns {import("@langchain/core/tools").StructuredTool[]} LangChain
 *   tools ready for an agent executor (bindTools / createAgent).
 *
 * Example (LangChain JS):
 *   const tools = createBlockchainIQTools(walletClient);
 *   const model = new ChatOpenAI({ model: "gpt-4o-mini" }).bindTools(tools);
 */
export function createBlockchainIQTools(walletClient) {
  const paidFetch = createPaidFetch(walletClient);

  const tools = [
    tool(
      async () => {
        const { data } = await callResource(paidFetch, "/brief");
        return JSON.stringify(data);
      },
      {
        name: "blockchain_iq_brief",
        description:
          "Crypto market brief for agents ($0.01/call): BTC, ETH, SOL and XRP prices with 24h/7d/30d moves and rank, scheduled macro and crypto events in the next 48 hours, and short risk flags. Use as the opening call of a trading, portfolio or research agent loop. No parameters.",
        schema: briefSchema,
      },
    ),
    tool(
      async () => {
        const { data } = await callResource(paidFetch, "/macro");
        return JSON.stringify(data);
      },
      {
        name: "blockchain_iq_macro",
        description:
          "US macro indicators ($0.05/call): real GDP growth, CPI inflation, core PCE, unemployment, nonfarm payrolls, Fed funds rate, Treasury yields, WTI crude, gold and silver. Each with latest value, prior value and as-of date. No parameters.",
        schema: briefSchema,
      },
    ),
    tool(
      async () => {
        const { data } = await callResource(paidFetch, "/calendar");
        return JSON.stringify(data);
      },
      {
        name: "blockchain_iq_calendar",
        description:
          "Economic & crypto calendar ($0.03/call): the next 90 days of market-moving events (US data releases, FOMC/ECB/BoJ decisions, Treasury auctions, crypto milestones), each ranked by importance with its official source. No parameters.",
        schema: briefSchema,
      },
    ),
    tool(
      async () => {
        const { data } = await callResource(paidFetch, "/indices");
        return JSON.stringify(data);
      },
      {
        name: "blockchain_iq_indices",
        description:
          "Crypto sector indices list ($0.03/call): every analyst-curated crypto sector index and thematic basket, each with slug, name, description and member coin count. No parameters.",
        schema: briefSchema,
      },
    ),
    tool(
      async (input) => {
        const { data } = await callResource(
          paidFetch,
          `/network/${encodeURIComponent(input.chain)}`,
        );
        return JSON.stringify(data);
      },
      {
        name: "blockchain_iq_network",
        description:
          "Blockchain network activity ($0.03/call): one chain's latest weekly transactions, active addresses/senders, fees, blocks, value moved and new accounts with 7-day change, ranked tables and an analyst read per metric.",
        schema: z.object({
          chain: z
            .string()
            .describe(
              "Chain slug (e.g. 'bitcoin-network', 'base-network') or symbol (e.g. 'btc', 'eth', 'sol', 'xrp').",
            ),
        }),
      },
    ),
    tool(
      async () => {
        const { data } = await callResource(paidFetch, "/stablecoins");
        return JSON.stringify(data);
      },
      {
        name: "blockchain_iq_stablecoins",
        description:
          "USDC & EURC supply and control ($0.02/call): Circle USDC and EURC snapshot on Ethereum, Base and Arbitrum — total supply, supply change, net issuance split, mint/burn counts, paused flag, role holders, blacklist count. No parameters.",
        schema: briefSchema,
      },
    ),
    tool(
      async (input) => {
        const { data } = await callResource(
          paidFetch,
          `/research/${encodeURIComponent(input.coin)}`,
        );
        return JSON.stringify(data);
      },
      {
        name: "blockchain_iq_research",
        description:
          "Crypto coin research brief ($0.05/call): one coin's full Blockchain IQ research brief — what it is, how it has traded, who is behind it, tokenomics, chain data and recent coverage, every claim with its source. Full text as Markdown plus structured sections.",
        schema: z.object({
          coin: z
            .string()
            .describe(
              "Research slug (e.g. 'btc', 'eth', 'xrp', 'sol') or CoinGecko id (e.g. 'bitcoin', 'ethereum', 'ripple').",
            ),
        }),
      },
    ),
  ];

  return tools;
}
