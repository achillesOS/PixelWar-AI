// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/**
 * @title PixelWarTreasury
 * @notice Handles USDC payment distribution for PixelWar game
 *
 * Payment Distribution (per pixel purchase):
 *   40% → Previous pixel owner (rebate/incentive)
 *   40% → Treasury (game fund, withdrawable by owner)
 *   10% → Loot pool (random reward pool)
 *   10% → Dev wallet (maintenance fee)
 *
 * First purchase (no previous owner):
 *   80% → Treasury
 *   10% → Loot pool
 *   10% → Dev wallet
 *
 * @dev Works with x402 payment protocol. Server verifies USDC transfer
 *      then calls distributePayment() to record on-chain distribution.
 *      Alternatively, agents can call distributePayment() directly.
 */
contract PixelWarTreasury is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ─── State ───────────────────────────────────────────────────────────────

    IERC20 public immutable usdc;

    address public devWallet;
    address public lootPool;

    uint256 public treasuryBalance;
    uint256 public lootBalance;

    // Pixel ownership: pixelId => owner address
    // pixelId = x * 10000 + y  (supports up to 9999x9999 grid)
    mapping(uint256 => address) public pixelOwner;

    // Pixel price: pixelId => current price in USDC raw (6 decimals)
    mapping(uint256 => uint256) public pixelPrice;

    // Default starting price: 0.001 USDC
    uint256 public constant BASE_PRICE = 1000; // 0.001 USDC (6 decimals)

    // Price multiplier: 150% of previous price (stored as basis points)
    uint256 public constant PRICE_MULTIPLIER_BPS = 15000; // 150%
    uint256 public constant BPS_DENOMINATOR = 10000;

    // Distribution ratios (basis points, must sum to 10000)
    uint256 public constant REBATE_BPS = 4000;   // 40%
    uint256 public constant TREASURY_BPS = 4000; // 40%
    uint256 public constant LOOT_BPS = 1000;     // 10%
    uint256 public constant DEV_BPS = 1000;      // 10%

    // ─── Events ──────────────────────────────────────────────────────────────

    event PixelCaptured(
        uint256 indexed pixelId,
        address indexed newOwner,
        address indexed previousOwner,
        uint256 amountPaid,
        uint256 newPrice
    );

    event PaymentDistributed(
        uint256 indexed pixelId,
        uint256 rebateAmount,
        uint256 treasuryAmount,
        uint256 lootAmount,
        uint256 devAmount
    );

    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event LootDistributed(address indexed winner, uint256 amount);
    event DevWalletUpdated(address indexed oldWallet, address indexed newWallet);
    event LootPoolUpdated(address indexed oldPool, address indexed newPool);

    // ─── Constructor ─────────────────────────────────────────────────────────

    /**
     * @param _usdc USDC token address
     *   Base Sepolia: 0x036CbD53842c5426634e7929541eC2318f3dCF7e
     *   Base Mainnet: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913
     * @param _devWallet Address to receive dev fees (10%)
     * @param _lootPool  Address of loot pool contract or EOA
     */
    constructor(
        address _usdc,
        address _devWallet,
        address _lootPool
    ) Ownable(msg.sender) {
        require(_usdc != address(0), "Invalid USDC address");
        require(_devWallet != address(0), "Invalid dev wallet");
        require(_lootPool != address(0), "Invalid loot pool");

        usdc = IERC20(_usdc);
        devWallet = _devWallet;
        lootPool = _lootPool;
    }

    // ─── Core: Pixel Purchase ────────────────────────────────────────────────

    /**
     * @notice Process a pixel purchase with USDC payment distribution
     * @dev Caller must have approved this contract to spend `amount` USDC.
     *      In x402 flow: agent approves then calls this function.
     *      In direct mode: agent calls approve() then capturePixel().
     *
     * @param x         Pixel X coordinate
     * @param y         Pixel Y coordinate
     * @param amount    Payment amount in USDC raw (6 decimals)
     */
    function capturePixel(
        uint256 x,
        uint256 y,
        uint256 amount
    ) external nonReentrant {
        uint256 pixelId = _encodePixelId(x, y);
        uint256 requiredPrice = getPixelPrice(pixelId);

        require(amount >= requiredPrice, "Insufficient payment");

        address previousOwner = pixelOwner[pixelId];
        require(previousOwner != msg.sender, "Already own this pixel");

        // Pull USDC from buyer
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        // Distribute payment
        _distribute(pixelId, amount, previousOwner);

        // Update pixel state
        pixelOwner[pixelId] = msg.sender;
        pixelPrice[pixelId] = (amount * PRICE_MULTIPLIER_BPS) / BPS_DENOMINATOR;

        emit PixelCaptured(
            pixelId,
            msg.sender,
            previousOwner,
            amount,
            pixelPrice[pixelId]
        );
    }

    /**
     * @notice Server-side: record distribution after verifying x402 payment
     * @dev Only callable by owner (server hot wallet). Used when payment
     *      was made as a direct USDC transfer (not via approve+capturePixel).
     *      The USDC should already be in this contract's balance.
     *
     * @param x             Pixel X coordinate
     * @param y             Pixel Y coordinate
     * @param amount        Payment amount verified on-chain
     * @param buyer         Address of the pixel buyer (new owner)
     */
    function recordCapture(
        uint256 x,
        uint256 y,
        uint256 amount,
        address buyer
    ) external onlyOwner nonReentrant {
        uint256 pixelId = _encodePixelId(x, y);
        address previousOwner = pixelOwner[pixelId];

        // Check contract has enough USDC (already transferred by agent)
        require(
            usdc.balanceOf(address(this)) >= amount,
            "USDC not received yet"
        );

        _distribute(pixelId, amount, previousOwner);

        pixelOwner[pixelId] = buyer;
        pixelPrice[pixelId] = (amount * PRICE_MULTIPLIER_BPS) / BPS_DENOMINATOR;

        emit PixelCaptured(
            pixelId,
            buyer,
            previousOwner,
            amount,
            pixelPrice[pixelId]
        );
    }

    // ─── Internal Distribution ───────────────────────────────────────────────

    function _distribute(
        uint256 pixelId,
        uint256 amount,
        address previousOwner
    ) internal {
        uint256 devAmount = (amount * DEV_BPS) / BPS_DENOMINATOR;
        uint256 lootAmount = (amount * LOOT_BPS) / BPS_DENOMINATOR;

        uint256 rebateAmount;
        uint256 treasuryAmount;

        if (previousOwner != address(0)) {
            // Has previous owner: send rebate
            rebateAmount = (amount * REBATE_BPS) / BPS_DENOMINATOR;
            treasuryAmount = amount - rebateAmount - lootAmount - devAmount;

            usdc.safeTransfer(previousOwner, rebateAmount);
        } else {
            // No previous owner: rebate goes to treasury
            rebateAmount = 0;
            treasuryAmount = amount - lootAmount - devAmount;
        }

        // Send dev fee immediately
        usdc.safeTransfer(devWallet, devAmount);

        // Accumulate loot and treasury (withdrawable)
        lootBalance += lootAmount;
        treasuryBalance += treasuryAmount;

        emit PaymentDistributed(
            pixelId,
            rebateAmount,
            treasuryAmount,
            lootAmount,
            devAmount
        );
    }

    // ─── Price Queries ───────────────────────────────────────────────────────

    /**
     * @notice Get current pixel price in USDC raw (6 decimals)
     * @return price Current price (BASE_PRICE if never purchased)
     */
    function getPixelPrice(uint256 pixelId) public view returns (uint256 price) {
        price = pixelPrice[pixelId];
        if (price == 0) price = BASE_PRICE;
    }

    function getPixelPriceXY(uint256 x, uint256 y) external view returns (uint256) {
        return getPixelPrice(_encodePixelId(x, y));
    }

    function getPixelOwner(uint256 x, uint256 y) external view returns (address) {
        return pixelOwner[_encodePixelId(x, y)];
    }

    // ─── Treasury Management ─────────────────────────────────────────────────

    /**
     * @notice Withdraw accumulated treasury balance
     * @param to      Recipient address
     * @param amount  Amount to withdraw (0 = all)
     */
    function withdrawTreasury(address to, uint256 amount) external onlyOwner nonReentrant {
        require(to != address(0), "Invalid recipient");

        uint256 withdrawAmount = (amount == 0) ? treasuryBalance : amount;
        require(withdrawAmount <= treasuryBalance, "Insufficient treasury");

        treasuryBalance -= withdrawAmount;
        usdc.safeTransfer(to, withdrawAmount);

        emit TreasuryWithdrawn(to, withdrawAmount);
    }

    /**
     * @notice Distribute loot to a winner (e.g., random draw)
     * @param winner  Winner address
     * @param amount  Amount to distribute (0 = all)
     */
    function distributeLoot(address winner, uint256 amount) external onlyOwner nonReentrant {
        require(winner != address(0), "Invalid winner");

        uint256 distributeAmount = (amount == 0) ? lootBalance : amount;
        require(distributeAmount <= lootBalance, "Insufficient loot");

        lootBalance -= distributeAmount;
        usdc.safeTransfer(winner, distributeAmount);

        emit LootDistributed(winner, distributeAmount);
    }

    // ─── Admin ───────────────────────────────────────────────────────────────

    function setDevWallet(address _devWallet) external onlyOwner {
        require(_devWallet != address(0), "Invalid address");
        emit DevWalletUpdated(devWallet, _devWallet);
        devWallet = _devWallet;
    }

    function setLootPool(address _lootPool) external onlyOwner {
        require(_lootPool != address(0), "Invalid address");
        emit LootPoolUpdated(lootPool, _lootPool);
        lootPool = _lootPool;
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    function _encodePixelId(uint256 x, uint256 y) internal pure returns (uint256) {
        require(x < 10000 && y < 10000, "Coordinates out of range");
        return x * 10000 + y;
    }

    /**
     * @notice Emergency: rescue stuck ERC20 tokens (not USDC accounting ones)
     */
    function rescueTokens(address token, address to, uint256 amount) external onlyOwner {
        require(token != address(usdc) || amount <= usdc.balanceOf(address(this)) - treasuryBalance - lootBalance,
            "Cannot rescue accounted USDC");
        IERC20(token).safeTransfer(to, amount);
    }
}
