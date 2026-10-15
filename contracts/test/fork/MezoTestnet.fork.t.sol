// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {LockwatchVault} from "../../src/LockwatchVault.sol";
import {IVeBTC, IVoter, IBorrowerOperationsSignatures, IERC20Min, ISavingsMUSD} from "../../src/interfaces/IMezo.sol";
import {MezoBTCMock, MEZO_BTC} from "../mocks/Mocks.sol";
import {LockwatchRescue} from "../../src/LockwatchRescue.sol";
import {ITroveManager, IPriceFeed} from "../../src/interfaces/IMezo.sol";

interface IBorrowerOps {
    function openTrove(uint256 debt, address upper, address lower) external payable;
}

interface ITMFull is ITroveManager {
    function getTroveColl(address) external view returns (uint256);
    function getTroveDebt(address) external view returns (uint256);
}

interface IRewardFull {
    function notifyRewardAmount(address token, uint256 amount) external;
    function earned(address token, uint256 tokenId) external view returns (uint256);
}

interface IERC20Full is IERC20Min {
    function allowance(address, address) external view returns (uint256);
}

interface IVeFull is IVeBTC {
    function createLock(uint256 value, uint256 duration) external returns (uint256);
    function approve(address to, uint256 tokenId) external;
    function tokenId() external view returns (uint256);
}

interface IVoterFull is IVoter {
    function vote(uint256 tokenId, address[] calldata pools, uint256[] calldata weights) external;
    function pools(uint256) external view returns (address);
    function gauges(address pool) external view returns (address);
    function isWhitelistedToken(address) external view returns (bool);
    function length() external view returns (uint256);
}

interface IVoterRewards {
    function gaugeToBribe(address) external view returns (address);
    function gaugeToFees(address) external view returns (address);
}

interface IPoolTokens {
    function token0() external view returns (address);
    function token1() external view returns (address);
}

interface IHintHelpers {
    function getApproxHint(uint256 cr, uint256 trials, uint256 seed) external returns (address, uint256, uint256);
}

interface ISortedTroves {
    function findInsertPosition(uint256 nicr, address prev, address next) external view returns (address, address);
}

/// @notice Fork tests against Mezo testnet (chain 31611). Run with:
///   forge test --match-path 'test/fork/*' --fork-url https://rpc.test.mezo.org
/// Mezo's BTC is a native-balance ERC-20 precompile at 0x7b7C… that a local EVM cannot execute, so we
/// etch a cheatcode-backed emulator there (balanceOf == native balance, transfer moves native balance).
contract MezoTestnetForkTest is Test {
    IVeFull constant VE = IVeFull(0xB63fcCd03521Cf21907627bd7fA465C129479231);
    IVoterFull constant VOTER = IVoterFull(0x72F8dd7F44fFa19E45955aa20A5486E8EB255738);
    IBorrowerOperationsSignatures constant BOS = IBorrowerOperationsSignatures(0xD757e3646AF370b15f32EB557F0F8380Df7D639e);
    IERC20Min constant MUSD = IERC20Min(0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503);

    IHintHelpers constant HINTS = IHintHelpers(0x4e4cBA3779d56386ED43631b4dCD6d8EacEcBCF6);
    ISortedTroves constant SORTED = ISortedTroves(0x722E4D24FD6Ff8b0AC679450F3D91294607268fA);
    LockwatchVault vault;
    uint256 alicePk = 0xA11CE;
    address alice;

    function setUp() public {
        if (block.chainid != 31611) return;
        alice = vm.addr(alicePk);
        vm.etch(MEZO_BTC, address(new MezoBTCMock()).code);
        vm.allowCheatcodes(MEZO_BTC);
        vault = new LockwatchVault(VE, BOS, MUSD, ISavingsMUSD(address(0)), 30 days);
    }

    modifier onlyFork() {
        if (block.chainid != 31611) {
            vm.skip(true);
        }
        _;
    }

    function test_fork_wiring() public onlyFork {
        assertEq(address(vault.voter()), address(VOTER));
        assertEq(address(vault.btc()), MEZO_BTC);
        // precompile balance == native balance (the real chain reports both 873.61 BTC for veBTC)
        assertEq(IERC20Min(MEZO_BTC).balanceOf(address(VE)), address(VE).balance);
    }

    /// Q: does withdraw pay the caller (operator) or the owner? -> the caller; vault forwards to owner.
    function test_fork_existingExpiredLock_operatorWithdrawPaysVaultThenOwner() public onlyFork {
        uint256 id = 9; // expired, unclaimed testnet lock from scan.txt
        address owner = VE.ownerOf(id);
        uint256 amt = uint256(int256(VE.locked(id).amount));
        assertFalse(VE.voted(id));
        uint256 ob = owner.balance;
        vm.startPrank(owner);
        VE.approve(address(vault), id);
        LockwatchVault.Pref memory p;
        vault.register(id, p);
        vm.stopPrank();
        (bool ok,) = vault.isProtectable(id);
        assertTrue(ok);
        vm.prank(makeAddr("keeper"));
        (uint256 got,) = vault.protect(id, address(0), address(0));
        assertEq(got, amt);
        assertEq(owner.balance, ob + amt);
        assertEq(address(vault).balance, 0);
        assertEq(VE.ownerOf(id), address(0), "burned");
    }

    /// Q: lock duration range. maxLockTime is set to 30 days on testnet (tigris deploy script);
    /// ends round down to Thursday 00:00 UTC.
    function test_fork_lockDurationRange() public onlyFork {
        vm.deal(alice, 10 ether);
        vm.startPrank(alice);
        IERC20Min(MEZO_BTC).approve(address(VE), type(uint256).max);
        uint256 id = VE.createLock(1 ether, 30 days);
        uint256 end = VE.locked(id).end;
        assertEq(end % 1 weeks, 0, "ends on epoch boundary");
        assertLe(end, block.timestamp + 30 days);
        vm.expectRevert();
        VE.createLock(1 ether, 30 days + 7 days); // > maxLockTime once rounded
        vm.stopPrank();
        console2.log("max end - now (days):", (end - block.timestamp) / 1 days);
    }

    /// Q: can an approved operator call voter.reset? -> yes (Voter.reset checks isApprovedOrOwner(msg.sender)).
    function test_fork_votedLock_vaultResetsAndRelocks() public onlyFork {
        vm.deal(alice, 1 ether);
        // move into a vote window (> 1h after epoch start)
        uint256 es = block.timestamp - (block.timestamp % 1 weeks);
        if (block.timestamp <= es + 1 hours) vm.warp(es + 2 hours);
        vm.startPrank(alice);
        IERC20Min(MEZO_BTC).approve(address(VE), 1 ether);
        uint256 id = VE.createLock(1 ether, 8 days);
        address[] memory pools = new address[](1);
        pools[0] = VOTER.pools(0);
        uint256[] memory w = new uint256[](1);
        w[0] = 1;
        VOTER.vote(id, pools, w);
        assertTrue(VE.voted(id));
        VE.approve(address(vault), id);
        LockwatchVault.Pref memory p;
        p.mode = LockwatchVault.Mode.RELOCK;
        p.relockDuration = 14 days;
        vault.register(id, p);
        vm.stopPrank();

        uint256 end = VE.locked(id).end;
        vm.warp(end + 10 minutes);
        (bool ok, uint8 why) = vault.isProtectable(id);
        assertFalse(ok);
        assertEq(why, 6, "Voter distribute window blocks reset for 1h after epoch flip");
        vm.warp(end + 1 hours + 1);
        (uint256 amt, uint256 nid) = vault.protect(id, address(0), address(0));
        assertEq(amt, 1 ether);
        assertEq(VE.ownerOf(nid), alice);
        assertEq(address(vault).balance, 0);
    }

    /// MUSD mode against the real BorrowerOperationsSignatures (EIP-712 domain read from chain).
    function test_fork_musdMode_opensRealTroveInOwnersName() public onlyFork {
        uint256 coll = 0.1 ether;
        vm.deal(alice, coll);
        vm.startPrank(alice);
        IERC20Min(MEZO_BTC).approve(address(VE), coll);
        uint256 id = VE.createLock(coll, 8 days);
        uint256 debt = 2500e18;
        uint64 deadline = uint64(block.timestamp + 20 days);
        bytes memory sig = _sign(coll, debt, alice, deadline);
        VE.approve(address(vault), id);
        vault.register(id, LockwatchVault.Pref(address(0), LockwatchVault.Mode.MUSD, 0, deadline, debt, sig));
        vm.stopPrank();
        vm.warp(VE.locked(id).end);
        _freshOracle();
        (address up, address lo) = _hints(coll, debt);
        vault.protect(id, up, lo);
        uint256 m = MUSD.balanceOf(alice);
        console2.log("MUSD to alice:", m, "BTC back:", alice.balance);
        assertEq(m, debt, "trove opened in alice's name, MUSD to alice");
        assertEq(alice.balance, 0);
        assertEq(address(vault).balance, 0);
    }

    // ------------------------------------------------------------------ v2: auto-extend

    /// Q: can an approved operator call veBTC.increaseUnlockTime? -> yes (Escrow checks _isApprovedOrOwner).
    function test_fork_autoExtend_vaultExtendsRealLock() public onlyFork {
        vm.deal(alice, 1 ether);
        vm.startPrank(alice);
        IERC20Min(MEZO_BTC).approve(address(VE), 1 ether);
        uint256 id = VE.createLock(1 ether, 8 days);
        uint256 end0 = VE.locked(id).end;
        VE.approve(address(vault), id);
        vault.setExtendPolicy(id, 29 days, 0); // keep at max
        vm.stopPrank();
        (bool ok,,, uint256 target) = vault.canExtend(id);
        assertTrue(ok, "extendable");
        vm.prank(makeAddr("keeper"));
        uint256 newEnd = vault.extend(id);
        assertEq(newEnd, target);
        assertGt(newEnd, end0);
        assertEq(VE.locked(id).end, newEnd);
        assertEq(VE.ownerOf(id), alice);
        assertEq(address(vault).balance, 0);
        console2.log("extended by days:", (newEnd - end0) / 1 days);
        // a week later it can extend again (keeps voting power at max)
        vm.warp(block.timestamp + 7 days);
        (ok,,,) = vault.canExtend(id);
        assertTrue(ok, "extendable next week");
        vault.extend(id);
        assertGt(VE.locked(id).end, newEnd);
    }

    function test_fork_autoExtend_votedLockStillExtends() public onlyFork {
        vm.deal(alice, 1 ether);
        uint256 es = block.timestamp - (block.timestamp % 1 weeks);
        if (block.timestamp <= es + 1 hours) vm.warp(es + 2 hours);
        vm.startPrank(alice);
        IERC20Min(MEZO_BTC).approve(address(VE), 1 ether);
        uint256 id = VE.createLock(1 ether, 8 days);
        address[] memory pools = new address[](1);
        pools[0] = VOTER.pools(0);
        uint256[] memory w = new uint256[](1);
        w[0] = 1;
        VOTER.vote(id, pools, w);
        VE.approve(address(vault), id);
        vault.setExtendPolicy(id, 10 days, 14 days);
        vm.stopPrank();
        uint256 end0 = VE.locked(id).end;
        vault.extend(id);
        assertGt(VE.locked(id).end, end0);
        assertTrue(VE.voted(id), "votes kept");
    }

    // ------------------------------------------------------------------ v2: reward auto-claim

    /// Q: can an approved operator call Voter.claimBribes/claimFees, and who gets paid? -> yes; owner is paid.
    function test_fork_rewards_vaultClaimsRealBribeToOwner() public onlyFork {
        vm.deal(alice, 1 ether);
        uint256 es = block.timestamp - (block.timestamp % 1 weeks);
        if (block.timestamp <= es + 1 hours) vm.warp(es + 2 hours);
        address pool = VOTER.pools(0);
        address gauge = VOTER.gauges(pool);
        address bribe = IVoterRewards(address(VOTER)).gaugeToBribe(gauge);
        address fees = IVoterRewards(address(VOTER)).gaugeToFees(gauge);
        // MUSD is already a registered reward token on pool 0's bribe contract on testnet
        IERC20Full tok = IERC20Full(address(MUSD));
        vm.startPrank(alice);
        IERC20Min(MEZO_BTC).approve(address(VE), 1 ether);
        uint256 id = VE.createLock(1 ether, 28 days);
        address[] memory pools = new address[](1);
        pools[0] = pool;
        uint256[] memory w = new uint256[](1);
        w[0] = 1;
        VOTER.vote(id, pools, w);
        VE.approve(address(vault), id);
        vault.setRewardsAuto(id, true);
        vm.stopPrank();

        // a briber posts 1,000 MUSD for this epoch
        address briber = makeAddr("briber");
        deal(address(tok), briber, 1000e18);
        vm.startPrank(briber);
        tok.approve(bribe, 1000e18);
        IRewardFull(bribe).notifyRewardAmount(address(tok), 1000e18);
        vm.stopPrank();

        vm.warp(es + 1 weeks + 1); // epoch over -> claimable
        uint256 e = IRewardFull(bribe).earned(address(tok), id);
        assertGt(e, 0, "earned bribe");
        address[] memory gauges = new address[](1);
        gauges[0] = gauge;
        address[][] memory bt = new address[][](1);
        bt[0] = new address[](1);
        bt[0][0] = address(tok);
        address[][] memory ft = new address[][](1);
        ft[0] = new address[](0);
        uint256 a0 = tok.balanceOf(alice);
        address k = makeAddr("keeper");
        vm.prank(k);
        vault.claimRewards(id, gauges, bt, ft);
        assertEq(tok.balanceOf(alice) - a0, e, "owner paid directly");
        assertEq(tok.balanceOf(address(vault)), 0);
        assertEq(tok.balanceOf(k), 0);
        assertEq(IRewardFull(bribe).earned(address(tok), id), 0);
        fees; // fee rewards use the same path (claimFees) and were exercised with an empty token list
        console2.log("bribe claimed to owner:", e, address(tok));
    }

    // ------------------------------------------------------------------ v2: loan rescue

    ITMFull constant TM = ITMFull(0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0);
    IPriceFeed constant PF = IPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366);
    IBorrowerOps constant BO = IBorrowerOps(0xCdF7028ceAB81fA0C6971208e83fa7872994beE5);

    function _openAliceTrove(uint256 coll, uint256 debt) internal {
        _freshOracle();
        vm.deal(alice, alice.balance + coll);
        (address up, address lo) = _hints(coll, debt);
        vm.prank(alice);
        BO.openTrove{value: coll}(debt, up, lo);
    }

    function _sig2(string memory typ, uint256 amt, uint256 nonce, uint256 deadline) internal view returns (bytes memory) {
        bytes32 th = keccak256(bytes(typ));
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("BorrowerOperationsSignatures"), keccak256("1"), uint256(31611), address(BOS)));
        bytes32 sh = keccak256(abi.encodePacked(th, abi.encode(amt, alice), nonce, deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, keccak256(abi.encodePacked("\x19\x01", domain, sh)));
        return abi.encodePacked(r, s, v);
    }

    function test_fork_rescue_addCollAndRepayIntoOwnTrove() public onlyFork {
        LockwatchRescue rescue = new LockwatchRescue(BOS, TM, PF, IERC20Min(MEZO_BTC), MUSD);
        _openAliceTrove(0.1 ether, 3000e18);
        uint256 icr0 = TM.getCurrentICR(alice, PF.fetchPrice());
        uint256 coll0 = TM.getTroveColl(alice);
        uint256 debt0 = TM.getTroveDebt(alice);
        console2.log("alice ICR before:", icr0);

        uint256 n = BOS.getNonce(alice);
        uint64 deadline = uint64(block.timestamp + 7 days);
        LockwatchRescue.Rule memory r;
        r.triggerIcr = uint64(icr0 + 0.1e18); // trigger just above today's ICR
        r.deadline = deadline;
        r.addAmount = 0.02 ether;
        r.repayAmount = 500e18;
        r.addSig = _sig2("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)", r.addAmount, n, deadline);
        r.repaySig = _sig2("RepayMUSD(uint256 amount,address borrower,uint256 nonce,uint256 deadline)", r.repayAmount, n + 1, deadline);

        vm.deal(alice, alice.balance + 0.02 ether);
        vm.startPrank(alice);
        rescue.depositBtc{value: 0.02 ether}();
        MUSD.approve(address(rescue), 500e18);
        rescue.depositMusd(500e18);
        rescue.setRule(r);
        vm.stopPrank();

        (bool ok,, uint256 add, uint256 rep) = rescue.check(alice);
        assertTrue(ok, "triggered");
        assertEq(add, 0.02 ether);
        assertEq(rep, 500e18);
        address k = makeAddr("keeper");
        vm.prank(k);
        rescue.rescue(alice, address(0), address(0));

        assertEq(TM.getTroveColl(alice), coll0 + 0.02 ether, "collateral into alice's trove");
        assertApproxEqAbs(TM.getTroveDebt(alice), debt0 - 500e18, 1e15, "debt repaid");
        assertGt(TM.getCurrentICR(alice, PF.fetchPrice()), icr0);
        assertEq(address(rescue).balance, 0);
        assertEq(MUSD.balanceOf(address(rescue)), 0);
        assertEq(k.balance, 0);
        assertEq(BOS.getNonce(alice), n + 2);
    }

    function test_fork_rescue_notTriggeredAboveThreshold() public onlyFork {
        LockwatchRescue rescue = new LockwatchRescue(BOS, TM, PF, IERC20Min(MEZO_BTC), MUSD);
        _openAliceTrove(0.1 ether, 3000e18);
        uint256 icr0 = TM.getCurrentICR(alice, PF.fetchPrice());
        uint64 deadline = uint64(block.timestamp + 7 days);
        LockwatchRescue.Rule memory r;
        r.triggerIcr = 1.2e18;
        r.deadline = deadline;
        r.addAmount = 0.01 ether;
        r.addSig = _sig2("AddColl(uint256 assetAmount,address borrower,uint256 nonce,uint256 deadline)", r.addAmount, BOS.getNonce(alice), deadline);
        vm.deal(alice, alice.balance + 0.01 ether);
        vm.startPrank(alice);
        rescue.depositBtc{value: 0.01 ether}();
        rescue.setRule(r);
        vm.stopPrank();
        vm.expectRevert(abi.encodeWithSelector(LockwatchRescue.NotTriggered.selector, icr0));
        rescue.rescue(alice, address(0), address(0));
        // price crash -> rescue allowed
        address o = 0x7b7c000000000000000000000000000000000015;
        vm.mockCall(o, abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), int256(11_500e18), block.timestamp, block.timestamp, uint80(1)));
        (bool ok, uint256 icr,,) = rescue.check(alice);
        assertTrue(ok, "below 120%");
        assertLt(icr, 1.2e18);
        rescue.rescue(alice, address(0), address(0));
        assertEq(rescue.btcOf(alice), 0);
    }

    /// Mezo's BTC/USD oracle is a precompile (0x7b7c…15) that reports updatedAt == block.timestamp on the
    /// real chain. Its fork stub can't, so after vm.warp we mock the same shape with the live price.
    function _freshOracle() internal {
        address o = 0x7b7c000000000000000000000000000000000015;
        vm.mockCall(o, abi.encodeWithSignature("latestRoundData()"),
            abi.encode(uint80(1), int256(82_000e18), block.timestamp, block.timestamp, uint80(1)));
        vm.mockCall(o, abi.encodeWithSignature("decimals()"), abi.encode(uint8(18)));
    }

    function _hints(uint256 coll, uint256 debt) internal returns (address up, address lo) {
        // keeper computes these off-chain the same way: NICR -> HintHelpers.getApproxHint -> findInsertPosition
        uint256 nicr = coll * 1e20 / (debt + 200e18 + debt / 200);
        (address approx,,) = HINTS.getApproxHint(nicr, 50, 42);
        (up, lo) = SORTED.findInsertPosition(nicr, approx, approx);
    }

    function _sign(uint256 asset, uint256 debt, address recipient, uint256 deadline) internal view returns (bytes memory) {
        bytes32 typehash = keccak256(
            "OpenTrove(uint256 assetAmount,uint256 debtAmount,address borrower,address recipient,uint256 nonce,uint256 deadline)"
        );
        bytes32 domain = keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("BorrowerOperationsSignatures"), keccak256("1"), uint256(31611), address(BOS)));
        bytes32 sh = keccak256(abi.encodePacked(typehash, abi.encode(asset, debt, alice, recipient), BOS.getNonce(alice), deadline));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(alicePk, keccak256(abi.encodePacked("\x19\x01", domain, sh)));
        return abi.encodePacked(r, s, v);
    }
}
