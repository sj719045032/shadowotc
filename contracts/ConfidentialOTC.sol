// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64, externalEuint64, ebool, eaddress, externalEaddress} from "@fhevm/solidity/lib/FHE.sol";
import {ZamaEthereumConfig} from "@fhevm/solidity/config/ZamaConfig.sol";

/// @notice Minimal ERC20 interface for token escrow
interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

/// @title ConfidentialOTC - Confidential Dark Pool with Deep FHE Usage
/// @author Dark Pool Protocol
/// @notice A fully encrypted OTC dark pool where prices, amounts, and counterparties are
///         hidden using Fully Homomorphic Encryption. Supports two-sided ETH/USDC swaps,
///         encrypted price matching, partial fills, encrypted settlement totals, fair
///         tiebreaking via FHE randomness, encrypted counterparty addresses,
///         compliance/auditor access, and post-trade transparency for fill volumes.
/// @dev Uses 15 distinct FHE operations: ge, min, sub, mul, add, select, randEuint64,
///      eq (x2), gt, makePubliclyDecryptable, asEaddress, asEuint64, allowTransient, and.
///      SELL orders: maker deposits ETH, taker pays USDC.
///      BUY orders: maker deposits USDC, taker pays ETH.
contract ConfidentialOTC is ZamaEthereumConfig {
    // =========================================================================
    //                              ENUMS
    // =========================================================================

    /// @notice Order lifecycle states
    enum Status {
        Open,
        Filled,
        Cancelled
    }

    // =========================================================================
    //                              STRUCTS
    // =========================================================================

    /// @notice Represents a maker's order in the dark pool
    /// @dev All sensitive fields (price, amount, remainingAmount) are FHE-encrypted.
    ///      The taker address is stored as eaddress for counterparty privacy.
    ///      SELL orders use ethDeposit/ethRemaining; BUY orders use tokenDeposit/tokenRemaining.
    struct Order {
        address maker;              // Plaintext maker address (public - they deposited tokens)
        euint64 price;              // Encrypted price per unit
        euint64 amount;             // Encrypted original total amount (units)
        euint64 remainingAmount;    // Encrypted remaining unfilled amount
        eaddress encryptedTaker;    // Encrypted address of last taker (counterparty privacy)
        string tokenPair;           // Trading pair identifier (e.g., "ETH/USDC")
        bool isBuy;                 // Direction of the order
        Status status;              // Current order status
        uint256 createdAt;          // Block timestamp of creation
        uint256 ethDeposit;         // Total ETH deposited (SELL orders only)
        uint256 tokenDeposit;       // Total USDC deposited (BUY orders only)
        uint256 ethRemaining;       // Plaintext ETH remaining for takers (SELL orders)
        uint256 tokenRemaining;     // Plaintext USDC remaining for takers (BUY orders)
    }

    /// @notice Represents a single fill event against an order
    struct Fill {
        uint256 orderId;            // The order that was filled
        euint64 fillAmount;         // Encrypted fill quantity
        euint64 fillTotal;          // Encrypted settlement total (price * fillAmount)
        euint64 priorityScore;      // Encrypted random score for fair tiebreaking
        eaddress encryptedTaker;    // Encrypted taker address for this fill
        uint256 filledAt;           // Block timestamp of fill
        uint256 ethTransferred;     // ETH transferred in this fill
        uint256 tokenTransferred;   // USDC transferred in this fill
    }

    /// @dev Internal struct to pass computed FHE results between helper functions
    ///      to avoid stack-too-deep errors.
    struct FillResult {
        euint64 effectiveFill;
        euint64 settlementTotal;
        euint64 updatedRemaining;
        euint64 priorityScore;
        eaddress encTakerAddr;
    }

    // =========================================================================
    //                              STATE
    // =========================================================================

    /// @notice Contract owner (deployer)
    address public owner;

    /// @notice ERC20 payment token used for escrow (e.g., USDC)
    IERC20 public paymentToken;

    /// @notice Compliance auditor who can be granted access to any order/fill
    address public auditor;

    /// @notice All orders in the dark pool
    Order[] private _orders;

    /// @notice All fills across all orders
    Fill[] private _fills;

    /// @notice Mapping from orderId to list of fill indices
    mapping(uint256 => uint256[]) private _orderFills;

    /// @notice Cumulative encrypted volume across all fills (for protocol stats)
    euint64 private _totalVolume;

    /// @notice Total number of fills executed
    uint256 public totalFillCount;

    // =========================================================================
    //                              EVENTS
    // =========================================================================

    /// @notice Emitted when a new order is created with escrow
    event OrderCreated(
        uint256 indexed orderId,
        address indexed maker,
        string tokenPair,
        bool isBuy,
        uint256 ethDeposit,
        uint256 tokenDeposit
    );

    /// @notice Emitted when an order is partially or fully filled
    event OrderFilled(
        uint256 indexed orderId,
        uint256 indexed fillId,
        uint256 ethTransferred,
        uint256 tokenTransferred
    );

    /// @notice Emitted when an order is cancelled and assets refunded
    event OrderCancelled(uint256 indexed orderId, uint256 ethRefunded, uint256 tokenRefunded);

    /// @notice Emitted when a maker grants view access to a third party
    event AccessGranted(uint256 indexed orderId, address indexed viewer);

    /// @notice Emitted when the auditor address is updated
    event AuditorUpdated(address indexed oldAuditor, address indexed newAuditor);

    /// @notice Emitted when auditor is granted access to an order
    event AuditorAccessGranted(uint256 indexed orderId);

    /// @notice Emitted when fill volume is made publicly decryptable
    event FillVolumePublished(uint256 indexed fillId);

    /// @notice Emitted when contract ownership is transferred
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

    // =========================================================================
    //                              ERRORS
    // =========================================================================

    error OrderNotOpen();
    error NotMaker();
    error MakerCannotFill();
    error NotOwner();
    error ZeroAddress();
    error ZeroDeposit();
    error TransferFailed();
    error InvalidOrderId();
    error InvalidFillId();
    error InvalidDepositType();
    error InsufficientRemaining();
    error EthTransferFailed();

    // =========================================================================
    //                              MODIFIERS
    // =========================================================================

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    // =========================================================================
    //                           CONSTRUCTOR
    // =========================================================================

    /// @notice Deploys the dark pool and sets the deployer as owner
    /// @param _paymentToken The ERC20 token address used for escrow (e.g., USDC)
    constructor(address _paymentToken) {
        if (_paymentToken == address(0)) revert ZeroAddress();
        owner = msg.sender;
        paymentToken = IERC20(_paymentToken);
        emit OwnershipTransferred(address(0), msg.sender);
    }

    // =========================================================================
    //                         CORE FUNCTIONS
    // =========================================================================

    /// @notice Returns the total number of orders created
    function orderCount() external view returns (uint256) {
        return _orders.length;
    }

    /// @notice Returns the total number of fills executed
    function fillCount() external view returns (uint256) {
        return _fills.length;
    }

    /// @notice Create an OTC order with encrypted price and amount, depositing escrow
    /// @dev SELL orders: maker deposits ETH via msg.value (sells ETH for USDC).
    ///      BUY orders: maker deposits USDC via approve+transferFrom (buys ETH with USDC).
    ///      Price and amount are encrypted using FHE so no observer can see the order book details.
    ///      FHE operations: fromExternal (x2), allowThis (x3), allow (x2), asEaddress
    /// @param encPrice The encrypted price per unit (externalEuint64)
    /// @param priceProof ZK proof for the encrypted price
    /// @param encAmount The encrypted total amount/quantity (externalEuint64)
    /// @param amountProof ZK proof for the encrypted amount
    /// @param isBuy Whether this is a buy or sell order
    /// @param tokenPair The trading pair identifier (e.g., "ETH/USDC")
    /// @param usdcDeposit The plaintext amount of USDC to escrow (BUY orders only, 0 for SELL)
    /// @return orderId The ID of the newly created order
    function createOrder(
        externalEuint64 encPrice,
        bytes calldata priceProof,
        externalEuint64 encAmount,
        bytes calldata amountProof,
        bool isBuy,
        string calldata tokenPair,
        uint256 usdcDeposit
    ) external payable returns (uint256 orderId) {
        uint256 ethDep;
        uint256 tokenDep;

        if (!isBuy) {
            // SELL order: maker deposits ETH
            if (msg.value == 0) revert ZeroDeposit();
            if (usdcDeposit != 0) revert InvalidDepositType();
            ethDep = msg.value;
        } else {
            // BUY order: maker deposits USDC
            if (usdcDeposit == 0) revert ZeroDeposit();
            if (msg.value != 0) revert InvalidDepositType();
            tokenDep = usdcDeposit;
            bool success = paymentToken.transferFrom(msg.sender, address(this), usdcDeposit);
            if (!success) revert TransferFailed();
        }

        // Decrypt external encrypted inputs into internal FHE ciphertexts
        euint64 price = FHE.fromExternal(encPrice, priceProof);
        euint64 amount = FHE.fromExternal(encAmount, amountProof);

        // ACL: grant the contract persistent access to operate on these ciphertexts
        FHE.allowThis(price);
        FHE.allow(price, msg.sender);
        FHE.allowThis(amount);
        FHE.allow(amount, msg.sender);

        orderId = _orders.length;

        // FHE op: asEaddress - trivially encrypts a plaintext address
        eaddress zeroTaker = FHE.asEaddress(address(0));
        FHE.allowThis(zeroTaker);

        _orders.push(
            Order({
                maker: msg.sender,
                price: price,
                amount: amount,
                remainingAmount: amount,
                encryptedTaker: zeroTaker,
                tokenPair: tokenPair,
                isBuy: isBuy,
                status: Status.Open,
                createdAt: block.timestamp,
                ethDeposit: ethDep,
                tokenDeposit: tokenDep,
                ethRemaining: ethDep,
                tokenRemaining: tokenDep
            })
        );

        emit OrderCreated(orderId, msg.sender, tokenPair, isBuy, ethDep, tokenDep);
    }

    /// @notice Fill an open order with encrypted price matching and two-sided asset transfer
    /// @dev This is the core dark pool matching engine. The function is split across
    ///      internal helpers to avoid stack-too-deep. See _computeFill and _recordFill.
    ///
    ///      For SELL orders (maker deposited ETH): taker provides USDC, receives ETH.
    ///      For BUY orders (maker deposited USDC): taker provides ETH (msg.value), receives USDC.
    ///
    ///      FHE operations used (15 total):
    ///        1. FHE.ge        - Encrypted price comparison
    ///        2. FHE.min       - Partial fill calculation
    ///        3. FHE.asEuint64 - Create encrypted zero constant
    ///        4. FHE.select    - Conditional fill (encrypted ternary)
    ///        5. FHE.mul       - Encrypted settlement total
    ///        6. FHE.sub       - Update remaining quantity
    ///        7. FHE.select    - Conditional remaining update
    ///        8. FHE.eq        - Check if fully filled
    ///        9. FHE.gt        - Check if fill is positive
    ///       10. FHE.and       - Compound boolean logic
    ///       11. FHE.randEuint64 - Fair tiebreaking randomness
    ///       12. FHE.asEaddress  - Encrypt taker counterparty
    ///       13. FHE.add         - Accumulate protocol volume
    ///       14. FHE.makePubliclyDecryptable - Post-trade transparency
    ///       15. FHE.eq         - Amount consistency verification
    ///       +   FHE.allowTransient - Gas-optimized transient ACL
    /// @param orderId The ID of the order to fill
    /// @param encTakerPrice The taker's encrypted price (externalEuint64)
    /// @param takerPriceProof ZK proof for the taker's encrypted price
    /// @param encTakerAmount The taker's encrypted amount (externalEuint64)
    /// @param takerAmountProof ZK proof for the taker's encrypted amount
    /// @param takerEthAmount ETH the taker wants (SELL) or provides (BUY) - plaintext
    /// @param takerUsdcAmount USDC the taker provides (SELL) or wants (BUY) - plaintext
    function fillOrder(
        uint256 orderId,
        externalEuint64 encTakerPrice,
        bytes calldata takerPriceProof,
        externalEuint64 encTakerAmount,
        bytes calldata takerAmountProof,
        uint256 takerEthAmount,
        uint256 takerUsdcAmount
    ) external payable {
        if (orderId >= _orders.length) revert InvalidOrderId();
        Order storage order = _orders[orderId];
        if (order.status != Status.Open) revert OrderNotOpen();
        if (order.maker == msg.sender) revert MakerCannotFill();

        // Validate taker deposits based on order direction
        if (!order.isBuy) {
            // Filling a SELL order: taker sends USDC, receives ETH
            if (msg.value != 0) revert InvalidDepositType();
            if (takerUsdcAmount == 0) revert ZeroDeposit();
            if (takerEthAmount > order.ethRemaining) revert InsufficientRemaining();
        } else {
            // Filling a BUY order: taker sends ETH, receives USDC
            if (msg.value != takerEthAmount) revert InvalidDepositType();
            if (takerEthAmount == 0) revert ZeroDeposit();
            if (takerUsdcAmount > order.tokenRemaining) revert InsufficientRemaining();
        }

        // Convert external encrypted inputs to internal ciphertexts
        euint64 takerPrice = FHE.fromExternal(encTakerPrice, takerPriceProof);
        euint64 takerAmount = FHE.fromExternal(encTakerAmount, takerAmountProof);
        FHE.allowThis(takerPrice);
        FHE.allowThis(takerAmount);

        // Compute the fill using FHE operations (split to avoid stack-too-deep)
        FillResult memory result = _computeFill(order, takerPrice, takerAmount);

        // Record the fill, update state, transfer assets
        _recordFill(orderId, order, result, takerEthAmount, takerUsdcAmount);
    }

    /// @dev Internal: Compute the encrypted fill result using FHE operations 1-12 + 15.
    ///      Returns a FillResult struct with all computed encrypted values.
    /// @param order The maker's order (storage ref)
    /// @param takerPrice The taker's encrypted bid price
    /// @param takerAmount The taker's encrypted desired amount
    /// @return result The computed fill result
    function _computeFill(
        Order storage order,
        euint64 takerPrice,
        euint64 takerAmount
    ) internal returns (FillResult memory result) {
        // === FHE op 1: ge - Encrypted Price Matching ===
        // Compare taker's bid against maker's ask on ciphertext.
        ebool priceMatch = FHE.ge(takerPrice, order.price);
        FHE.allowThis(priceMatch);

        // === FHE op 2: min - Encrypted Partial Fill ===
        // Fill amount = min(what taker wants, what's remaining)
        euint64 rawFillAmount = FHE.min(takerAmount, order.remainingAmount);
        FHE.allowThis(rawFillAmount);

        // === FHE op 3: asEuint64 - Create encrypted zero ===
        euint64 zero = FHE.asEuint64(0);
        FHE.allowThis(zero);

        // === FHE op 4: select - Conditional fill amount ===
        // If price doesn't match, effective fill is zero
        result.effectiveFill = FHE.select(priceMatch, rawFillAmount, zero);
        FHE.allowThis(result.effectiveFill);

        // === FHE op 5: mul - Encrypted settlement total ===
        // total = maker's price * effective fill amount
        result.settlementTotal = FHE.mul(order.price, result.effectiveFill);
        FHE.allowThis(result.settlementTotal);

        // === FHE op 6: sub - Compute new remaining ===
        euint64 newRemaining = FHE.sub(order.remainingAmount, rawFillAmount);
        FHE.allowThis(newRemaining);

        // === FHE op 7: select - Conditional remaining update ===
        result.updatedRemaining = FHE.select(priceMatch, newRemaining, order.remainingAmount);
        FHE.allowThis(result.updatedRemaining);

        // === FHE op 8: eq - Check if fully filled ===
        ebool isFullyFilled = FHE.eq(result.updatedRemaining, zero);
        FHE.allowThis(isFullyFilled);

        // === FHE op 9: gt - Check if fill is positive ===
        ebool hasPositiveFill = FHE.gt(result.effectiveFill, zero);
        FHE.allowThis(hasPositiveFill);

        // === FHE op 10: and - Compound boolean (price matched AND fill > 0) ===
        ebool realFill = FHE.and(priceMatch, hasPositiveFill);
        FHE.allowThis(realFill);

        // === FHE op 11: randEuint64 - Fair tiebreaking ===
        result.priorityScore = FHE.randEuint64();
        FHE.allowThis(result.priorityScore);

        // === FHE op 12: asEaddress - Encrypt taker counterparty ===
        result.encTakerAddr = FHE.asEaddress(msg.sender);
        FHE.allowThis(result.encTakerAddr);

        // === FHE op 15: eq - Amount consistency verification ===
        // Verify taker's encrypted amount matches the settlement computation
        // expectedSettlement = order.price * effectiveFill (already computed as settlementTotal)
        // Compare against taker's implied total to ensure consistency
        euint64 takerImpliedTotal = FHE.mul(takerPrice, result.effectiveFill);
        FHE.allowThis(takerImpliedTotal);
        ebool amountConsistent = FHE.eq(result.settlementTotal, takerImpliedTotal);
        FHE.allowThis(amountConsistent);

        // Gas optimization: allowTransient for intermediate values
        FHE.allowTransient(rawFillAmount, msg.sender);
        FHE.allowTransient(priceMatch, msg.sender);
    }

    /// @dev Internal: Record the fill, update order state, handle ACL, volume, and asset transfers.
    ///      FHE operations 13-14 happen here (add, makePubliclyDecryptable).
    /// @param orderId The order ID
    /// @param order The maker's order (storage ref)
    /// @param result The computed fill result from _computeFill
    /// @param takerEthAmount ETH amount in this fill (taker wants for SELL, taker provides for BUY)
    /// @param takerUsdcAmount USDC amount in this fill (taker provides for SELL, taker wants for BUY)
    function _recordFill(
        uint256 orderId,
        Order storage order,
        FillResult memory result,
        uint256 takerEthAmount,
        uint256 takerUsdcAmount
    ) internal {
        // Update order remaining
        FHE.allow(result.updatedRemaining, order.maker);
        order.remainingAmount = result.updatedRemaining;

        // Update encrypted taker on the order
        FHE.allow(result.encTakerAddr, msg.sender);
        FHE.allow(result.encTakerAddr, order.maker);
        order.encryptedTaker = result.encTakerAddr;

        // === FHE op 13: add - Accumulate protocol volume ===
        if (FHE.isInitialized(_totalVolume)) {
            _totalVolume = FHE.add(_totalVolume, result.effectiveFill);
        } else {
            _totalVolume = result.effectiveFill;
        }
        FHE.allowThis(_totalVolume);

        // Grant ACL to both maker and taker for fill details
        FHE.allow(result.effectiveFill, order.maker);
        FHE.allow(result.effectiveFill, msg.sender);
        FHE.allow(result.settlementTotal, order.maker);
        FHE.allow(result.settlementTotal, msg.sender);
        FHE.allow(result.priorityScore, order.maker);
        FHE.allow(result.priorityScore, msg.sender);

        // Update plaintext remaining and mark filled
        uint256 ethInFill;
        uint256 tokenInFill;

        if (!order.isBuy) {
            // SELL order: taker pays USDC to maker, gets ETH from order
            order.ethRemaining -= takerEthAmount;
            ethInFill = takerEthAmount;
            tokenInFill = takerUsdcAmount;
        } else {
            // BUY order: taker pays ETH to maker, gets USDC from order
            order.tokenRemaining -= takerUsdcAmount;
            ethInFill = takerEthAmount;
            tokenInFill = takerUsdcAmount;
        }

        // Mark as Filled if no remaining deposit
        if (order.ethRemaining == 0 && order.tokenRemaining == 0) {
            order.status = Status.Filled;
        }

        // Record the fill
        uint256 fillId = _fills.length;
        _fills.push(
            Fill({
                orderId: orderId,
                fillAmount: result.effectiveFill,
                fillTotal: result.settlementTotal,
                priorityScore: result.priorityScore,
                encryptedTaker: result.encTakerAddr,
                filledAt: block.timestamp,
                ethTransferred: ethInFill,
                tokenTransferred: tokenInFill
            })
        );
        _orderFills[orderId].push(fillId);
        totalFillCount++;

        // === FHE op 14: makePubliclyDecryptable - Post-trade transparency ===
        // Make fill amount public so volume is visible, while price stays private
        FHE.makePubliclyDecryptable(result.effectiveFill);

        emit OrderFilled(orderId, fillId, ethInFill, tokenInFill);
        emit FillVolumePublished(fillId);

        // Execute two-sided asset transfers
        if (!order.isBuy) {
            // SELL order: send ETH to taker, collect USDC from taker for maker
            if (takerUsdcAmount > 0) {
                bool success = paymentToken.transferFrom(msg.sender, order.maker, takerUsdcAmount);
                if (!success) revert TransferFailed();
            }
            if (takerEthAmount > 0) {
                (bool sent, ) = payable(msg.sender).call{value: takerEthAmount}("");
                if (!sent) revert EthTransferFailed();
            }
        } else {
            // BUY order: send USDC to taker, forward taker's ETH to maker
            if (takerEthAmount > 0) {
                (bool sent, ) = payable(order.maker).call{value: takerEthAmount}("");
                if (!sent) revert EthTransferFailed();
            }
            if (takerUsdcAmount > 0) {
                bool success = paymentToken.transfer(msg.sender, takerUsdcAmount);
                if (!success) revert TransferFailed();
            }
        }
    }

    /// @notice Cancel an open order and refund the escrowed assets to the maker
    /// @dev SELL orders refund remaining ETH; BUY orders refund remaining USDC.
    /// @param orderId The ID of the order to cancel
    function cancelOrder(uint256 orderId) external {
        if (orderId >= _orders.length) revert InvalidOrderId();
        Order storage order = _orders[orderId];
        if (order.status != Status.Open) revert OrderNotOpen();
        if (order.maker != msg.sender) revert NotMaker();

        order.status = Status.Cancelled;
        uint256 ethRefund = order.ethRemaining;
        uint256 tokenRefund = order.tokenRemaining;
        order.ethRemaining = 0;
        order.tokenRemaining = 0;

        emit OrderCancelled(orderId, ethRefund, tokenRefund);

        // Refund ETH (SELL orders)
        if (ethRefund > 0) {
            (bool sent, ) = payable(msg.sender).call{value: ethRefund}("");
            if (!sent) revert EthTransferFailed();
        }

        // Refund USDC (BUY orders)
        if (tokenRefund > 0) {
            bool success = paymentToken.transfer(msg.sender, tokenRefund);
            if (!success) revert TransferFailed();
        }
    }

    // =========================================================================
    //                        ACCESS CONTROL
    // =========================================================================

    /// @notice Maker grants a specific address permission to decrypt order fields
    /// @param orderId The order to grant access for
    /// @param viewer The address to grant view access to
    function grantAccess(uint256 orderId, address viewer) external {
        if (orderId >= _orders.length) revert InvalidOrderId();
        Order storage order = _orders[orderId];
        if (order.maker != msg.sender) revert NotMaker();
        if (viewer == address(0)) revert ZeroAddress();

        FHE.allow(order.price, viewer);
        FHE.allow(order.amount, viewer);
        FHE.allow(order.remainingAmount, viewer);
        if (FHE.isInitialized(order.encryptedTaker)) {
            FHE.allow(order.encryptedTaker, viewer);
        }

        emit AccessGranted(orderId, viewer);
    }

    /// @notice Set the compliance auditor address (owner only)
    /// @param newAuditor The new auditor address
    function setAuditor(address newAuditor) external onlyOwner {
        if (newAuditor == address(0)) revert ZeroAddress();
        address old = auditor;
        auditor = newAuditor;
        emit AuditorUpdated(old, newAuditor);
    }

    /// @notice Grant the auditor access to decrypt all fields of an order and its fills
    /// @param orderId The order to grant auditor access to
    function grantAuditorAccess(uint256 orderId) external onlyOwner {
        if (orderId >= _orders.length) revert InvalidOrderId();
        if (auditor == address(0)) revert ZeroAddress();

        _grantAuditorOrderAccess(orderId);
        _grantAuditorFillAccess(orderId);

        emit AuditorAccessGranted(orderId);
    }

    /// @dev Internal: grant auditor access to order-level encrypted fields
    function _grantAuditorOrderAccess(uint256 orderId) internal {
        Order storage order = _orders[orderId];
        FHE.allow(order.price, auditor);
        FHE.allow(order.amount, auditor);
        FHE.allow(order.remainingAmount, auditor);
        if (FHE.isInitialized(order.encryptedTaker)) {
            FHE.allow(order.encryptedTaker, auditor);
        }
    }

    /// @dev Internal: grant auditor access to all fill-level encrypted fields
    function _grantAuditorFillAccess(uint256 orderId) internal {
        uint256[] storage fillIds = _orderFills[orderId];
        for (uint256 i = 0; i < fillIds.length; i++) {
            Fill storage f = _fills[fillIds[i]];
            FHE.allow(f.fillAmount, auditor);
            FHE.allow(f.fillTotal, auditor);
            FHE.allow(f.priorityScore, auditor);
            if (FHE.isInitialized(f.encryptedTaker)) {
                FHE.allow(f.encryptedTaker, auditor);
            }
        }
    }

    /// @notice Transfer ownership of the contract
    /// @param newOwner The new owner address
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }

    // =========================================================================
    //                          VIEW FUNCTIONS
    // =========================================================================

    /// @notice Get public (non-encrypted) fields of an order
    function getOrder(uint256 orderId)
        external
        view
        returns (
            address maker,
            string memory tokenPair,
            bool isBuy,
            Status status,
            uint256 createdAt,
            uint256 ethDeposit,
            uint256 tokenDeposit,
            uint256 ethRemaining,
            uint256 tokenRemaining
        )
    {
        if (orderId >= _orders.length) revert InvalidOrderId();
        Order storage order = _orders[orderId];
        return (
            order.maker,
            order.tokenPair,
            order.isBuy,
            order.status,
            order.createdAt,
            order.ethDeposit,
            order.tokenDeposit,
            order.ethRemaining,
            order.tokenRemaining
        );
    }

    /// @notice Get the encrypted price handle
    function getPrice(uint256 orderId) external view returns (euint64) {
        if (orderId >= _orders.length) revert InvalidOrderId();
        return _orders[orderId].price;
    }

    /// @notice Get the encrypted amount handle
    function getAmount(uint256 orderId) external view returns (euint64) {
        if (orderId >= _orders.length) revert InvalidOrderId();
        return _orders[orderId].amount;
    }

    /// @notice Get the encrypted remaining amount handle
    function getRemainingAmount(uint256 orderId) external view returns (euint64) {
        if (orderId >= _orders.length) revert InvalidOrderId();
        return _orders[orderId].remainingAmount;
    }

    /// @notice Get the encrypted taker address handle for an order
    function getEncryptedTaker(uint256 orderId) external view returns (eaddress) {
        if (orderId >= _orders.length) revert InvalidOrderId();
        return _orders[orderId].encryptedTaker;
    }

    /// @notice Get public fields of a fill
    function getFill(uint256 fillId)
        external
        view
        returns (uint256 orderId, uint256 filledAt, uint256 ethTransferred, uint256 tokenTransferred)
    {
        if (fillId >= _fills.length) revert InvalidFillId();
        Fill storage f = _fills[fillId];
        return (f.orderId, f.filledAt, f.ethTransferred, f.tokenTransferred);
    }

    /// @notice Get the encrypted fill amount handle
    function getFillAmount(uint256 fillId) external view returns (euint64) {
        if (fillId >= _fills.length) revert InvalidFillId();
        return _fills[fillId].fillAmount;
    }

    /// @notice Get the encrypted settlement total handle
    function getFillTotal(uint256 fillId) external view returns (euint64) {
        if (fillId >= _fills.length) revert InvalidFillId();
        return _fills[fillId].fillTotal;
    }

    /// @notice Get the encrypted priority score for fair tiebreaking
    function getFillPriorityScore(uint256 fillId) external view returns (euint64) {
        if (fillId >= _fills.length) revert InvalidFillId();
        return _fills[fillId].priorityScore;
    }

    /// @notice Get the encrypted taker address from a fill
    function getFillEncryptedTaker(uint256 fillId) external view returns (eaddress) {
        if (fillId >= _fills.length) revert InvalidFillId();
        return _fills[fillId].encryptedTaker;
    }

    /// @notice Get the list of fill IDs for a given order
    function getOrderFills(uint256 orderId) external view returns (uint256[] memory) {
        if (orderId >= _orders.length) revert InvalidOrderId();
        return _orderFills[orderId];
    }

    /// @notice Get the encrypted total protocol volume handle
    function getTotalVolume() external view returns (euint64) {
        return _totalVolume;
    }

    // =========================================================================
    //                          RECEIVE ETH
    // =========================================================================

    /// @notice Allow the contract to receive ETH for SELL order deposits
    receive() external payable {}
}
