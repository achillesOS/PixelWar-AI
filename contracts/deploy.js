/**
 * PixelWarTreasury Deployment Script
 * 
 * Usage:
 *   # Base Sepolia (testnet)
 *   NETWORK=sepolia PRIVATE_KEY=0x... DEV_WALLET=0x... node deploy.js
 *
 *   # Base Mainnet
 *   NETWORK=mainnet PRIVATE_KEY=0x... DEV_WALLET=0x... node deploy.js
 *
 * Environment variables:
 *   PRIVATE_KEY   - Deployer private key (needs ETH for gas)
 *   NETWORK       - "sepolia" or "mainnet" (default: sepolia)
 *   DEV_WALLET    - Address to receive 10% dev fees
 *   LOOT_WALLET   - Address for loot pool (default: same as DEV_WALLET for now)
 */

import { ethers } from "ethers";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// ─── Config ──────────────────────────────────────────────────────────────────

const NETWORKS = {
  sepolia: {
    name: "Base Sepolia",
    rpc: "https://sepolia.base.org",
    chainId: 84532,
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    explorer: "https://sepolia.basescan.org",
  },
  mainnet: {
    name: "Base Mainnet",
    rpc: "https://mainnet.base.org",
    chainId: 8453,
    usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    explorer: "https://basescan.org",
  },
};

// ─── ABI & Bytecode (compile with: npx hardhat compile) ──────────────────────

// Minimal ABI for deployment verification
const TREASURY_ABI = [
  "constructor(address _usdc, address _devWallet, address _lootPool)",
  "function owner() view returns (address)",
  "function usdc() view returns (address)",
  "function devWallet() view returns (address)",
  "function BASE_PRICE() view returns (uint256)",
  "function getPixelPriceXY(uint256 x, uint256 y) view returns (uint256)",
  "event PixelCaptured(uint256 indexed pixelId, address indexed newOwner, address indexed previousOwner, uint256 amountPaid, uint256 newPrice)",
];

// ─── Deploy ──────────────────────────────────────────────────────────────────

async function main() {
  const network = process.env.NETWORK || "sepolia";
  const cfg = NETWORKS[network];
  if (!cfg) throw new Error(`Unknown network: ${network}. Use "sepolia" or "mainnet"`);

  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) throw new Error("PRIVATE_KEY env var required");

  const devWallet = process.env.DEV_WALLET;
  if (!devWallet) throw new Error("DEV_WALLET env var required");

  const lootWallet = process.env.LOOT_WALLET || devWallet;

  console.log(`\n🚀 Deploying PixelWarTreasury to ${cfg.name}`);
  console.log(`   USDC:        ${cfg.usdc}`);
  console.log(`   Dev wallet:  ${devWallet}`);
  console.log(`   Loot wallet: ${lootWallet}`);
  console.log(`   RPC:         ${cfg.rpc}\n`);

  // Connect
  const provider = new ethers.JsonRpcProvider(cfg.rpc, {
    chainId: cfg.chainId,
    name: network,
  });

  const wallet = new ethers.Wallet(privateKey, provider);
  const balance = await provider.getBalance(wallet.address);

  console.log(`   Deployer:    ${wallet.address}`);
  console.log(`   ETH balance: ${ethers.formatEther(balance)} ETH`);

  if (balance < ethers.parseEther("0.001")) {
    console.warn("⚠️  Low ETH balance. You may need more for gas.");
  }

  // Load compiled bytecode
  // If using Hardhat: npx hardhat compile → artifacts/contracts/PixelWarTreasury.sol/PixelWarTreasury.json
  let bytecode;
  try {
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const artifact = JSON.parse(
      readFileSync(
        join(__dirname, "../artifacts/contracts/PixelWarTreasury.sol/PixelWarTreasury.json"),
        "utf8"
      )
    );
    bytecode = artifact.bytecode;
    console.log("✅ Loaded compiled bytecode from artifacts");
  } catch (e) {
    console.error("❌ Could not load compiled bytecode.");
    console.error("   Run: npx hardhat compile");
    console.error("   Or:  npm run compile");
    process.exit(1);
  }

  // Deploy
  const factory = new ethers.ContractFactory(TREASURY_ABI, bytecode, wallet);

  console.log("\n📦 Deploying contract...");
  const contract = await factory.deploy(cfg.usdc, devWallet, lootWallet, {
    gasLimit: 2_000_000,
  });

  console.log(`   Tx hash:     ${contract.deploymentTransaction().hash}`);
  console.log("   Waiting for confirmation...");

  await contract.waitForDeployment();
  const address = await contract.getAddress();

  console.log(`\n✅ PixelWarTreasury deployed!`);
  console.log(`   Contract:    ${address}`);
  console.log(`   Explorer:    ${cfg.explorer}/address/${address}`);
  console.log(`   Verify:      ${cfg.explorer}/address/${address}#code`);

  // Verify setup
  console.log("\n🔍 Verifying deployment...");
  const deployed = new ethers.Contract(address, TREASURY_ABI, provider);
  const owner = await deployed.owner();
  const usdcAddr = await deployed.usdc();
  const dev = await deployed.devWallet();
  const basePrice = await deployed.BASE_PRICE();

  console.log(`   Owner:       ${owner}`);
  console.log(`   USDC:        ${usdcAddr}`);
  console.log(`   Dev wallet:  ${dev}`);
  console.log(`   Base price:  ${basePrice} raw (${Number(basePrice) / 1e6} USDC)`);

  // Output deployment info
  const deployInfo = {
    network: cfg.name,
    chainId: cfg.chainId,
    contract: address,
    usdc: cfg.usdc,
    devWallet,
    lootWallet,
    deployer: wallet.address,
    deployedAt: new Date().toISOString(),
    txHash: contract.deploymentTransaction().hash,
    explorer: `${cfg.explorer}/address/${address}`,
  };

  console.log("\n📋 Deployment summary (save this!):");
  console.log(JSON.stringify(deployInfo, null, 2));

  // Write to file
  const outFile = `deployed-${network}.json`;
  import("fs").then((fs) => {
    fs.writeFileSync(outFile, JSON.stringify(deployInfo, null, 2));
    console.log(`\n💾 Saved to ${outFile}`);
  });

  console.log("\n🎉 Done! Next steps:");
  console.log("   1. Set TREASURY_ADDRESS in your backend .env");
  console.log(`      TREASURY_ADDRESS=${address}`);
  console.log("   2. Update x402 server payTo address");
  console.log("   3. Verify contract on Basescan (optional)");
}

main().catch((err) => {
  console.error("\n❌ Deployment failed:", err.message);
  process.exit(1);
});
