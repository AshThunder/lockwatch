// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {LockwatchRescue} from "../src/LockwatchRescue.sol";
import {IBorrowerOperationsSignatures, ITroveManager, IPriceFeed, IERC20Min} from "../src/interfaces/IMezo.sol";
import "./mocks/Mocks.sol";

abstract contract RescueBase is Test {
    MezoBTCMock btc;
    MockERC20 musd;
    MockBOS2 bos;
    LockwatchRescue rescue;
    uint256 alicePk = 0xA11CE;
    address alice;
    address keeper = makeAddr("keeper");

    function setUp() public virtual {
        vm.warp(1_791_590_400);
        alice = vm.addr(alicePk);
        vm.etch(MEZO_BTC, address(new MezoBTCMock()).code);
        btc = MezoBTCMock(MEZO_BTC);
        musd = new MockERC20("MUSD");
        bos = new MockBOS2(musd);
        rescue = new LockwatchRescue(
            IBorrowerOperationsSignatures(address(bos)), ITroveManager(address(bos)), IPriceFeed(address(bos)),
            IERC20Min(MEZO_BTC), IERC20Min(address(musd))
        );
        // alice: 1 BTC collateral, 50k MUSD debt @ 82k => ICR 164%
        bos.seedTrove(alice, 1 ether, 50_000e18);
    }

    function _sig(uint256 pk, bytes32 th, uint256 amt, uint256 nonce, uint256 deadline) internal view returns (bytes memory) {
        bytes32 d = bos.digest2(th, amt, vm.addr(pk), nonce, deadline);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, d);
        return abi.encodePacked(r, s, v);
    }

    function _rule(uint64 trig, uint128 addAmt, uint128 repay) internal view returns (LockwatchRescue.Rule memory r) {
        r.triggerIcr = trig;
        r.deadline = uint64(block.timestamp + 30 days);
        r.addAmount = addAmt;
        r.repayAmount = repay;
        uint256 n = bos.getNonce(alice);
        if (addAmt > 0) {
            r.addSig = _addSig(addAmt, n, r.deadline);
            n++;
        }
        if (repay > 0) r.repaySig = _repaySig(repay, n, r.deadline);
    }

    function _addSig(uint256 amt, uint256 n, uint256 d) internal view returns (bytes memory) {
        return _sig(alicePk, bos.ADD_COLL_TYPEHASH(), amt, n, d);
    }

    function _repaySig(uint256 amt, uint256 n, uint256 d) internal view returns (bytes memory) {
        return _sig(alicePk, bos.REPAY_MUSD_TYPEHASH(), amt, n, d);
    }

    function _fund(uint256 b, uint256 m) internal {
        vm.deal(alice, alice.balance + b);
        musd.mint(alice, m);
        vm.startPrank(alice);
        rescue.depositBtc{value: b}();
        musd.approve(address(rescue), m);
        rescue.depositMusd(m);
        vm.stopPrank();
    }
}

contract LockwatchRescueTest is RescueBase {
    function test_notTriggered_reverts() public {
        _fund(0.5 ether, 0);
        LockwatchRescue.Rule memory rr = _rule(1.5e18, 0.5 ether, 0);
        vm.prank(alice);
        rescue.setRule(rr);
        (bool ok, uint256 icr,,) = rescue.check(alice);
        assertFalse(ok);
        assertEq(icr, 1.64e18);
        vm.expectRevert(abi.encodeWithSelector(LockwatchRescue.NotTriggered.selector, uint256(1.64e18)));
        rescue.rescue(alice, address(0), address(0));
    }

    function test_addColl_whenBelowTrigger() public {
        _fund(0.5 ether, 0);
        LockwatchRescue.Rule memory rr = _rule(1.5e18, 0.5 ether, 0);
        vm.prank(alice);
        rescue.setRule(rr);
        bos.setPrice(70_000e18); // ICR 140%
        (bool ok,, uint256 add,) = rescue.check(alice);
        assertTrue(ok);
        assertEq(add, 0.5 ether);
        vm.prank(keeper);
        rescue.rescue(alice, address(0), address(0));
        assertEq(bos.troveColl(alice), 1.5 ether);
        assertEq(rescue.btcOf(alice), 0);
        assertEq(address(rescue).balance, 0);
        assertEq(rescue.rules(alice).triggerIcr, 0, "rule consumed");
        // single use
        vm.expectRevert(LockwatchRescue.NothingToDo.selector);
        rescue.rescue(alice, address(0), address(0));
    }

    function test_addThenRepay_bothNonces() public {
        _fund(0.2 ether, 10_000e18);
        LockwatchRescue.Rule memory rr = _rule(1.5e18, 0.2 ether, 10_000e18);
        vm.prank(alice);
        rescue.setRule(rr);
        bos.setPrice(70_000e18);
        rescue.rescue(alice, address(0), address(0));
        assertEq(bos.troveColl(alice), 1.2 ether);
        assertEq(bos.troveDebt(alice), 40_000e18);
        assertEq(musd.balanceOf(address(rescue)), 0);
        assertEq(bos.getNonce(alice), 2);
    }

    function test_repayOnly() public {
        _fund(0, 5_000e18);
        LockwatchRescue.Rule memory rr = _rule(1.7e18, 0, 5_000e18);
        vm.prank(alice);
        rescue.setRule(rr);
        rescue.rescue(alice, address(0), address(0));
        assertEq(bos.troveDebt(alice), 45_000e18);
    }

    function test_insufficientEscrow_nothingToDo() public {
        _fund(0.1 ether, 0);
        LockwatchRescue.Rule memory rr = _rule(1.7e18, 0.5 ether, 0);
        vm.prank(alice);
        rescue.setRule(rr);
        (bool ok,,,) = rescue.check(alice);
        assertFalse(ok);
        vm.expectRevert(LockwatchRescue.NothingToDo.selector);
        rescue.rescue(alice, address(0), address(0));
    }

    function test_nonceBumped_invalidatesPermission() public {
        _fund(0.5 ether, 0);
        LockwatchRescue.Rule memory rr = _rule(1.7e18, 0.5 ether, 0);
        vm.prank(alice);
        rescue.setRule(rr);
        // alice performs another signed MUSD action elsewhere -> nonce bumps
        vm.store(address(bos), keccak256(abi.encode(alice, uint256(1))), bytes32(uint256(1)));
        assertEq(bos.getNonce(alice), 1, "nonce bumped");
        vm.expectRevert("BorrowerOperationsSignatures: Invalid signature");
        rescue.rescue(alice, address(0), address(0));
        assertEq(rescue.btcOf(alice), 0.5 ether, "escrow intact after revert");
    }

    function test_withdraw_alwaysToSelf() public {
        _fund(0.5 ether, 100e18);
        address bob = makeAddr("bob");
        vm.prank(bob);
        vm.expectRevert();
        rescue.withdraw(0.5 ether, 0);
        vm.prank(alice);
        rescue.withdraw(0.5 ether, 100e18);
        assertEq(alice.balance, 0.5 ether);
        assertEq(musd.balanceOf(alice), 100e18);
        assertEq(rescue.totalBtc(), 0);
    }

    function test_inactiveTrove() public {
        address carol = vm.addr(0xC0);
        LockwatchRescue.Rule memory rr = _rule(1.5e18, 1, 0);
        vm.prank(carol);
        rescue.setRule(rr); // rules can be set before a trove exists
        (bool ok,,,) = rescue.check(carol);
        assertFalse(ok);
        vm.expectRevert(LockwatchRescue.TroveNotActive.selector);
        rescue.rescue(carol, address(0), address(0));
        assertFalse(ok);
    }

    function test_ruleValidation() public {
        vm.startPrank(alice);
        LockwatchRescue.Rule memory r = _rule(1.5e18, 0.1 ether, 0);
        r.triggerIcr = 1e18;
        vm.expectRevert(LockwatchRescue.InvalidRule.selector);
        rescue.setRule(r);
        r = _rule(1.5e18, 0.1 ether, 0);
        r.deadline = uint64(block.timestamp);
        vm.expectRevert(LockwatchRescue.InvalidRule.selector);
        rescue.setRule(r);
        r = _rule(1.5e18, 0.1 ether, 0);
        r.addSig = "";
        vm.expectRevert(LockwatchRescue.InvalidRule.selector);
        rescue.setRule(r);
        r = _rule(1.5e18, 0, 0);
        vm.expectRevert(LockwatchRescue.InvalidRule.selector);
        rescue.setRule(r);
        rescue.setRule(_rule(1.5e18, 0.1 ether, 0));
        rescue.clearRule();
        vm.stopPrank();
        assertEq(rescue.rules(alice).triggerIcr, 0);
    }

    function test_plainTransferRefused() public {
        vm.deal(address(this), 1 ether);
        (bool ok,) = address(rescue).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_expiredDeadline_noRescue() public {
        _fund(0.5 ether, 0);
        LockwatchRescue.Rule memory rr = _rule(1.7e18, 0.5 ether, 0);
        vm.prank(alice);
        rescue.setRule(rr);
        vm.warp(block.timestamp + 31 days);
        (bool ok,,,) = rescue.check(alice);
        assertFalse(ok);
        vm.expectRevert("Signature expired");
        rescue.rescue(alice, address(0), address(0));
    }

    /// Fuzz: for any price, rescue only succeeds below trigger and only ever moves alice's escrow into alice's trove.
    function testFuzz_rescue(uint256 price, uint64 trig, uint128 addAmt, address caller) public {
        price = bound(price, 1_000e18, 500_000e18);
        trig = uint64(bound(trig, 1.1e18, 3e18));
        addAmt = uint128(bound(addAmt, 1, 10 ether));
        _fund(addAmt, 0);
        LockwatchRescue.Rule memory rr = _rule(trig, addAmt, 0);
        vm.prank(alice);
        rescue.setRule(rr);
        bos.setPrice(price);
        bool below = bos.getCurrentICR(alice, price) < trig;
        vm.prank(caller);
        try rescue.rescue(alice, address(0), address(0)) {
            assertTrue(below);
            assertEq(bos.troveColl(alice), 1 ether + addAmt);
        } catch {
            assertEq(bos.troveColl(alice), 1 ether);
            assertEq(rescue.btcOf(alice), addAmt);
        }
        assertEq(address(rescue).balance, rescue.totalBtc());
    }
}

contract RescueHandler is CommonBase, StdCheats, StdUtils {
    LockwatchRescue r;
    MockBOS2 bos;
    MockERC20 musd;
    address[] public actors;
    uint256 public misdirected;
    uint256 public rescues;

    constructor(LockwatchRescue r_, MockBOS2 b, MockERC20 m) {
        r = r_; bos = b; musd = m;
        for (uint256 i; i < 3; ++i) {
            address a = vm.addr(0xD00D00 + i);
            actors.push(a);
            bos.seedTrove(a, 1 ether, 50_000e18);
        }
    }

    function _a(uint256 s) internal view returns (address) { return actors[s % actors.length]; }

    function deposit(uint256 s, uint96 b, uint96 m) external {
        address a = _a(s);
        b = uint96(bound(b, 0, 10 ether)); m = uint96(bound(m, 0, 1e24));
        vm.deal(a, a.balance + b); musd.mint(a, m);
        vm.startPrank(a);
        r.depositBtc{value: b}();
        musd.approve(address(r), m);
        r.depositMusd(m);
        vm.stopPrank();
    }

    function withdraw(uint256 s, uint96 b, uint96 m) external {
        address a = _a(s);
        b = uint96(bound(b, 0, r.btcOf(a))); m = uint96(bound(m, 0, r.musdOf(a)));
        uint256 bal0 = a.balance;
        vm.prank(a);
        r.withdraw(b, m);
        if (a.balance != bal0 + b) misdirected++;
    }

    function setRule(uint256 s, uint64 trig, uint96 add, uint96 rep) external {
        uint256 i = s % actors.length;
        address a = actors[i];
        LockwatchRescue.Rule memory rr;
        rr.triggerIcr = uint64(bound(trig, 1.1e18, 3e18));
        rr.deadline = uint64(block.timestamp + 1 days);
        rr.addAmount = uint128(bound(add, 0, 5 ether));
        rr.repayAmount = uint128(bound(rep, 0, 20_000e18));
        if (rr.addAmount == 0 && rr.repayAmount == 0) rr.addAmount = 1;
        uint256 n = bos.getNonce(a);
        if (rr.addAmount > 0) { rr.addSig = _sg(0xD00D00 + i, bos.ADD_COLL_TYPEHASH(), rr.addAmount, n, rr.deadline); n++; }
        if (rr.repayAmount > 0) rr.repaySig = _sg(0xD00D00 + i, bos.REPAY_MUSD_TYPEHASH(), rr.repayAmount, n, rr.deadline);
        vm.prank(a);
        r.setRule(rr);
    }

    function _sg(uint256 pk, bytes32 th, uint256 amt, uint256 n, uint256 d) internal returns (bytes memory) {
        bytes32 dg = bos.digest2(th, amt, vm.addr(pk), n, d);
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(pk, dg);
        return abi.encodePacked(rr, ss, v);
    }

    function setPrice(uint256 p) external { bos.setPrice(bound(p, 1_000e18, 200_000e18)); }

    function rescueAny(uint256 s) external {
        address a = _a(s);
        uint256 collSum0;
        for (uint256 i; i < actors.length; ++i) collSum0 += bos.troveColl(actors[i]);
        uint256 own0 = bos.troveColl(a) + r.btcOf(a);
        try r.rescue(a, address(0), address(0)) {
            rescues++;
            uint256 collSum1;
            for (uint256 i; i < actors.length; ++i) collSum1 += bos.troveColl(actors[i]);
            if (bos.troveColl(a) + r.btcOf(a) != own0) misdirected++;
            if (collSum1 < collSum0) misdirected++;
        } catch {}
    }
}

contract LockwatchRescueInvariant is RescueBase {
    RescueHandler h;

    function setUp() public override {
        super.setUp();
        h = new RescueHandler(rescue, bos, musd);
        targetContract(address(h));
    }

    function invariant_btcBalanceEqualsEscrow() public view {
        assertEq(address(rescue).balance, rescue.totalBtc());
    }

    function invariant_musdBalanceCoversEscrow() public view {
        assertGe(musd.balanceOf(address(rescue)), rescue.totalMusd());
    }

    function invariant_fundsNeverMisdirected() public view {
        assertEq(h.misdirected(), 0);
    }
}
