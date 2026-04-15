// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title PreflightGuard
/// @notice Forwards a swap to the router only if a fresh PreflightX-signed
///         VerifiedPlan is presented. Plans are EIP-712 signatures over the
///         exact (caller, fromToken, toToken, fromAmount, minToAmount, router,
///         callData, value, expiresAt, nonce) tuple. Nonces are single-use.
contract PreflightGuard {
    bytes32 public constant DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId)");
    bytes32 public constant PLAN_TYPEHASH = keccak256(
        "VerifiedPlan(address caller,address fromToken,address toToken,uint256 fromAmount,uint256 minToAmount,address router,bytes callData,uint256 value,uint256 expiresAt,bytes32 nonce)"
    );
    bytes32 public constant DOMAIN_NAME = keccak256("PreflightX");
    bytes32 public constant DOMAIN_VERSION = keccak256("1");

    address public immutable signer;
    bytes32 public immutable DOMAIN_SEPARATOR;

    mapping(bytes32 => bool) public usedNonce;

    event PreflightExecuted(
        address indexed caller,
        address indexed router,
        bytes32 indexed nonce,
        address fromToken,
        address toToken,
        uint256 fromAmount,
        uint256 minToAmount,
        uint256 amountOut
    );

    event PreflightRejected(bytes32 indexed nonce, string reason);

    error InvalidSigner(address recovered);
    error PlanExpired(uint256 expiresAt, uint256 nowSeconds);
    error NonceUsed(bytes32 nonce);
    error CallerMismatch(address expected, address actual);
    error RouterCallFailed(bytes data);
    error AmountOutBelowMin(uint256 amountOut, uint256 minOut);

    struct VerifiedPlan {
        address caller;
        address fromToken;
        address toToken;
        uint256 fromAmount;
        uint256 minToAmount;
        address router;
        bytes callData;
        uint256 value;
        uint256 expiresAt;
        bytes32 nonce;
    }

    constructor(address _signer) {
        signer = _signer;
        DOMAIN_SEPARATOR = keccak256(
            abi.encode(DOMAIN_TYPEHASH, DOMAIN_NAME, DOMAIN_VERSION, block.chainid)
        );
    }

    /// @notice Verify the plan's EIP-712 signature recovers to the configured signer.
    function verifySignature(VerifiedPlan calldata plan, bytes calldata signature)
        public
        view
        returns (address recovered)
    {
        bytes32 structHash = keccak256(
            abi.encode(
                PLAN_TYPEHASH,
                plan.caller,
                plan.fromToken,
                plan.toToken,
                plan.fromAmount,
                plan.minToAmount,
                plan.router,
                keccak256(plan.callData),
                plan.value,
                plan.expiresAt,
                plan.nonce
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR, structHash));
        recovered = _recover(digest, signature);
    }

    /// @notice Execute the swap iff the plan is signed by the configured signer,
    ///         not expired, and the caller matches plan.caller.
    /// @dev Caller must have approved this contract for plan.fromAmount of plan.fromToken
    ///      so the contract can pull funds, approve the router, and forward the call.
    function executeWithPreflight(VerifiedPlan calldata plan, bytes calldata signature)
        external
        payable
        returns (uint256 amountOut)
    {
        if (msg.sender != plan.caller) {
            revert CallerMismatch(plan.caller, msg.sender);
        }
        if (block.timestamp > plan.expiresAt) {
            revert PlanExpired(plan.expiresAt, block.timestamp);
        }
        if (usedNonce[plan.nonce]) {
            revert NonceUsed(plan.nonce);
        }

        address recovered = verifySignature(plan, signature);
        if (recovered != signer) {
            revert InvalidSigner(recovered);
        }

        usedNonce[plan.nonce] = true;

        // Pull funds from caller and approve router
        _transferFrom(plan.fromToken, plan.caller, address(this), plan.fromAmount);
        _approve(plan.fromToken, plan.router, plan.fromAmount);

        uint256 balanceBefore = _balanceOf(plan.toToken, plan.caller);

        (bool ok, bytes memory ret) = plan.router.call{value: plan.value}(plan.callData);
        if (!ok) {
            revert RouterCallFailed(ret);
        }

        amountOut = _balanceOf(plan.toToken, plan.caller) - balanceBefore;
        if (amountOut < plan.minToAmount) {
            revert AmountOutBelowMin(amountOut, plan.minToAmount);
        }

        emit PreflightExecuted(
            plan.caller,
            plan.router,
            plan.nonce,
            plan.fromToken,
            plan.toToken,
            plan.fromAmount,
            plan.minToAmount,
            amountOut
        );
    }

    function _recover(bytes32 digest, bytes calldata signature) private pure returns (address) {
        if (signature.length != 65) return address(0);
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 32))
            v := byte(0, calldataload(add(signature.offset, 64)))
        }
        if (v < 27) v += 27;
        return ecrecover(digest, v, r, s);
    }

    function _transferFrom(address token, address from, address to, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSignature("transferFrom(address,address,uint256)", from, to, amount)
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "ERC20 transferFrom failed");
    }

    function _approve(address token, address spender, uint256 amount) private {
        (bool ok, bytes memory ret) = token.call(
            abi.encodeWithSignature("approve(address,uint256)", spender, amount)
        );
        require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "ERC20 approve failed");
    }

    function _balanceOf(address token, address who) private view returns (uint256) {
        (bool ok, bytes memory ret) = token.staticcall(
            abi.encodeWithSignature("balanceOf(address)", who)
        );
        require(ok && ret.length >= 32, "ERC20 balanceOf failed");
        return abi.decode(ret, (uint256));
    }
}
