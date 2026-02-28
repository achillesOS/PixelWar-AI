/**
 * PixelWar AI — x402 Payment Client
 * x402_client.js
 *
 * Implements the x402 micropayment protocol for pixel claiming.
 *
 * Flow:
 *   1. POST /pixel/:x/:y                 → 402 Payment Required
 *   2. Parse X-Payment-Required header   → payment details
 *   3. Build payment proof               → fake (test) or real (Base Sepolia)
 *   4. POST /pixel/:x/:y again           → with X-Payment header
 *   5. Return result
 *
 * Modes:
 *   Test mode  (default): Generates a properly-formatted fake tx hash.
 *                         Safe for development. Set X402_REAL_PAYMENTS=false.
 *   Real mode  (opt-in):  Signs and broadcasts real USDC transfer on Base Sepolia.
 *                         Set X402_REAL_PAYMENTS=true + X402_WALLET_PRIVATE_KEY.
 */

// ─── Constants ────────────────────────────────────────────────────────────────

const BASE_SEPOLIA_CHAIN_ID = 84532;
const USDC_DECIMALS = 6;

// USDC contract on Base Sepolia
const USDC_CONTRACT = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

// x402 protocol version
const X402_VERSION = '1';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Generate a realistic-looking Ethereum tx hash */
function fakeEthTxHash() {
  const bytes = Array.from({ length: 32 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
  return `0x${bytes}`;
}

/** Generate a realistic-looking Ethereum address */
function fakeEthAddress() {
  const bytes = Array.from({ length: 20 }, () =>
    Math.floor(Math.random() * 256).toString(16).padStart(2, '0')
  ).join('');
  return `0x${bytes}`;
}

/** Convert USDC string to smallest units (6 decimals) */
function usdcToUnits(amount) {
  return Math.round(parseFloat(amount) * 10 ** USDC_DECIMALS);
}

/** Encode object to base64 JSON (for x402 headers) */
function encodeHeader(obj) {
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

/** Decode base64 JSON header */
function decodeHeader(b64) {
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));
  } catch {
    return null;
  }
}

// ─── x402 Client ─────────────────────────────────────────────────────────────

export class X402Client {
  /**
   * @param {object} opts
   * @param {string}  opts.agentId    - Agent identifier
   * @param {string}  opts.apiBase    - API base URL
   * @param {boolean} [opts.dryRun]   - If true, never actually POST
   * @param {boolean} [opts.realMode] - Override X402_REAL_PAYMENTS env
   */
  constructor({ agentId, apiBase, dryRun = false, realMode = null }) {
    this.agentId  = agentId;
    this.apiBase  = apiBase.replace(/\/$/, '');
    this.dryRun   = dryRun;
    this.realMode = realMode !== null
      ? realMode
      : process.env.X402_REAL_PAYMENTS === 'true';

    // Wallet config (for real mode)
    this.walletPrivKey = process.env.X402_WALLET_PRIVATE_KEY || null;
    this.walletAddress = process.env.X402_WALLET_ADDRESS
      || (this.walletPrivKey ? null : fakeEthAddress()); // Use stable fake if no real key

    if (this.realMode && !this.walletPrivKey) {
      throw new Error(
        'X402_REAL_PAYMENTS=true requires X402_WALLET_PRIVATE_KEY to be set.'
      );
    }

    if (!this.realMode) {
      console.log('[x402] Running in TEST MODE — payments are simulated');
    } else {
      console.log(`[x402] REAL MODE — wallet: ${this.walletAddress}`);
    }
  }

  /**
   * Claim a pixel, handling the x402 payment flow automatically.
   *
   * @param {object} opts
   * @param {number}  opts.x          - Pixel X coordinate
   * @param {number}  opts.y          - Pixel Y coordinate
   * @param {string}  opts.color      - Hex color (e.g. "#FF6B35")
   * @param {string}  opts.token      - AI captcha token
   * @param {number}  [opts.maxAmount] - Max USDC to pay for this pixel
   * @returns {Promise<{success, amount, tx_hash, reason}>}
   */
  async claimPixel({ x, y, color, token, maxAmount = 1.0 }) {
    if (this.dryRun) {
      console.log(`[x402] DRY RUN: would claim (${x},${y}) color=${color}`);
      return { success: true, amount: 0, tx_hash: fakeEthTxHash(), reason: 'dry-run' };
    }

    const path    = `/pixel/${x}/${y}`;
    const url     = `${this.apiBase}${path}`;
    const headers = this.#baseHeaders(token);

    // ── Step 1: Initial POST (expect 402) ─────────────────────────────────
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ color }),
      });
    } catch (err) {
      return { success: false, amount: 0, tx_hash: null, reason: `Network error: ${err.message}` };
    }

    // Success on first try (pixel already free / server skipped payment)
    if (res.ok) {
      const data = await res.json();
      return { success: true, amount: 0, tx_hash: data.tx_hash || 'none', reason: 'no-payment-required' };
    }

    // Handle non-402 errors
    if (res.status !== 402) {
      const body = await res.text().catch(() => '');
      return {
        success: false, amount: 0, tx_hash: null,
        reason: `Unexpected status ${res.status}: ${body.slice(0, 200)}`,
      };
    }

    // ── Step 2: Parse 402 Payment Required ────────────────────────────────
    const paymentHeader = res.headers.get('X-Payment-Required')
      || res.headers.get('x-payment-required');

    if (!paymentHeader) {
      return { success: false, amount: 0, tx_hash: null, reason: '402 received but no X-Payment-Required header' };
    }

    const paymentDetails = decodeHeader(paymentHeader);
    if (!paymentDetails) {
      return { success: false, amount: 0, tx_hash: null, reason: 'Failed to decode X-Payment-Required header' };
    }

    console.log(`[x402] Payment required: ${paymentDetails.amount} ${paymentDetails.currency}`);

    // Budget check
    const requiredAmount = parseFloat(paymentDetails.amount);
    if (requiredAmount > maxAmount) {
      return {
        success: false, amount: 0, tx_hash: null,
        reason: `Pixel costs ${requiredAmount} USDC, exceeds remaining budget ${maxAmount.toFixed(4)} USDC`,
      };
    }

    // ── Step 3: Build Payment Proof ───────────────────────────────────────
    let proof;
    try {
      proof = this.realMode
        ? await this.#realPayment(paymentDetails)
        : await this.#testPayment(paymentDetails);
    } catch (err) {
      return { success: false, amount: 0, tx_hash: null, reason: `Payment error: ${err.message}` };
    }

    // ── Step 4: Re-POST with payment proof ────────────────────────────────
    const proofHeader = encodeHeader(proof);

    let res2;
    try {
      res2 = await fetch(url, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'X-Payment': proofHeader,
        },
        body: JSON.stringify({ color }),
      });
    } catch (err) {
      return { success: false, amount: 0, tx_hash: null, reason: `Network error on payment POST: ${err.message}` };
    }

    if (!res2.ok) {
      const body = await res2.text().catch(() => '');
      return {
        success: false, amount: 0, tx_hash: proof.tx_hash,
        reason: `Payment POST failed ${res2.status}: ${body.slice(0, 200)}`,
      };
    }

    // ── Step 5: Return success ─────────────────────────────────────────────
    const result = await res2.json().catch(() => ({}));
    return {
      success:  true,
      amount:   requiredAmount,
      tx_hash:  proof.tx_hash,
      reason:   'ok',
      server:   result,
    };
  }

  // ─── Internal: Base Headers ─────────────────────────────────────────────────

  #baseHeaders(token) {
    return {
      'X-Agent-Id': this.agentId,
      'User-Agent': `PixelWar-Agent/1.0 (OpenClaw; agent-id=${this.agentId})`,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }

  // ─── Internal: Test Payment (fake proof) ────────────────────────────────────
  /**
   * Generates a properly-formatted x402 payment proof without touching the chain.
   * For development, API testing, and demo purposes.
   */
  async #testPayment(paymentDetails) {
    // Simulate a small network delay (realistic)
    await new Promise(r => setTimeout(r, 50 + Math.random() * 100));

    const txHash = fakeEthTxHash();
    const proof = {
      protocol:   'x402',
      version:    X402_VERSION,
      chain_id:   paymentDetails.chain_id || BASE_SEPOLIA_CHAIN_ID,
      currency:   paymentDetails.currency || 'USDC',
      amount:     String(paymentDetails.amount),
      amount_raw: String(usdcToUnits(paymentDetails.amount)),
      recipient:  paymentDetails.recipient || fakeEthAddress(),
      payer:      this.walletAddress,
      tx_hash:    txHash,
      timestamp:  Date.now(),
      test_mode:  true,
    };

    console.log(`[x402][TEST] Payment proof generated: tx=${txHash}`);
    return proof;
  }

  // ─── Internal: Real Payment (Base Sepolia) ──────────────────────────────────
  /**
   * Submits a real USDC transfer on Base Sepolia.
   *
   * Requires:
   *   - X402_WALLET_PRIVATE_KEY  (env)
   *   - X402_WALLET_ADDRESS      (env, optional — derived from key)
   *
   * TODO: Replace stub with real ethers.js / viem transaction when going live.
   *
   * Dependencies to install for real mode:
   *   npm install ethers        (ethers v6)
   *   or
   *   npm install viem          (recommended for Base)
   */
  async #realPayment(paymentDetails) {
    // ─────────────────────────────────────────────────────────────────────────
    // REAL PAYMENT STUB
    // Replace this block with actual on-chain USDC transfer code.
    //
    // Example with viem (uncomment and fill in after `npm install viem`):
    //
    // import { createWalletClient, http, parseUnits } from 'viem';
    // import { baseSepolia } from 'viem/chains';
    // import { privateKeyToAccount } from 'viem/accounts';
    //
    // const account = privateKeyToAccount(this.walletPrivKey);
    // const client = createWalletClient({
    //   account,
    //   chain: baseSepolia,
    //   transport: http(),
    // });
    //
    // const USDC_ABI = [{
    //   name: 'transfer',
    //   type: 'function',
    //   inputs: [
    //     { name: 'to',     type: 'address' },
    //     { name: 'amount', type: 'uint256' },
    //   ],
    //   outputs: [{ type: 'bool' }],
    //   stateMutability: 'nonpayable',
    // }];
    //
    // const txHash = await client.writeContract({
    //   address: USDC_CONTRACT,
    //   abi: USDC_ABI,
    //   functionName: 'transfer',
    //   args: [
    //     paymentDetails.recipient,
    //     parseUnits(String(paymentDetails.amount), USDC_DECIMALS),
    //   ],
    // });
    //
    // await publicClient.waitForTransactionReceipt({ hash: txHash });
    // ─────────────────────────────────────────────────────────────────────────

    throw new Error(
      'Real payment not yet implemented. Install viem and fill in #realPayment(). ' +
      'See comments in x402_client.js for the integration guide.'
    );

    // Return format (fill in after implementation):
    // return {
    //   protocol:   'x402',
    //   version:    X402_VERSION,
    //   chain_id:   BASE_SEPOLIA_CHAIN_ID,
    //   currency:   'USDC',
    //   amount:     String(paymentDetails.amount),
    //   amount_raw: String(usdcToUnits(paymentDetails.amount)),
    //   recipient:  paymentDetails.recipient,
    //   payer:      this.walletAddress,
    //   tx_hash:    txHash,
    //   timestamp:  Date.now(),
    //   test_mode:  false,
    // };
  }
}

// ─── Exported Utilities ───────────────────────────────────────────────────────

export { fakeEthTxHash, fakeEthAddress, usdcToUnits, encodeHeader, decodeHeader };
export const CHAIN_ID       = BASE_SEPOLIA_CHAIN_ID;
export const USDC_ADDRESS   = USDC_CONTRACT;
