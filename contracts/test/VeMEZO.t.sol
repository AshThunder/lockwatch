// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LockwatchVault} from "../src/LockwatchVault.sol";
import {IVeBTC, IBorrowerOperationsSignatures, IERC20Min, ISavingsMUSD} from "../src/interfaces/IMezo.sol";
import "./mocks/Mocks.sol";

/// veMEZO instance: same vault bytecode, ve = veMEZO, no MUSD wiring, 4-year max lock, BoostVoter (bribes only).
contract VeMEZOVaultTest is Test {
    MockERC20 mezo;
    MockBoostVoter voter;
    MockVeBTC ve;
    LockwatchVault vault;
    address alice = makeAddr("alice");
    address keeper = makeAddr("keeper");
    uint256 constant T0 = 1_791_590_400 + 3 days;
    uint256 constant MAX = 4 * 365 days;

    function setUp() public {
        vm.warp(T0);
        mezo = new MockERC20("MEZO");
        voter = new MockBoostVoter();
        ve = new MockVeBTC(address(mezo), address(voter));
        ve.setMaxLockTime(MAX);
        voter.setVe(address(ve));
        vault = new LockwatchVault(IVeBTC(address(ve)), IBorrowerOperationsSignatures(address(0)), IERC20Min(address(0)), ISavingsMUSD(address(0)), MAX);
    }

    function _lock(uint256 amt, uint256 dur) internal returns (uint256 id) {
        mezo.mint(alice, amt);
        vm.startPrank(alice);
        mezo.approve(address(ve), amt);
        id = ve.createLock(amt, dur);
        ve.approve(address(vault), id);
        vm.stopPrank();
    }

    function _pref(LockwatchVault.Mode m) internal pure returns (LockwatchVault.Pref memory p) {
        p.mode = m;
        if (m == LockwatchVault.Mode.RELOCK) p.relockDuration = 365 days;
    }

    function test_wiring() public view {
        assertEq(address(vault.btc()), address(mezo));
        assertEq(address(vault.voter()), address(voter));
        assertEq(vault.maxLock(), MAX);
    }

    function test_returnSendsMezoToOwner() public {
        uint256 id = _lock(1000e18, 30 days);
        vm.prank(alice);
        vault.register(id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(T0 + 31 days);
        vm.prank(keeper);
        (uint256 a,) = vault.protect(id, address(0), address(0));
        assertEq(a, 1000e18);
        assertEq(mezo.balanceOf(alice), 1000e18);
        assertEq(mezo.balanceOf(address(vault)), 0);
        assertEq(mezo.balanceOf(keeper), 0);
    }

    function test_relockMezoForOwner() public {
        uint256 id = _lock(5e18, 30 days);
        vm.prank(alice);
        vault.register(id, _pref(LockwatchVault.Mode.RELOCK));
        vm.warp(T0 + 31 days);
        vm.prank(keeper);
        (, uint256 n) = vault.protect(id, address(0), address(0));
        assertEq(ve.ownerOf(n), alice);
        assertEq(ve.locked(n).amount, int128(5e18));
        assertGt(ve.locked(n).end, block.timestamp + 300 days);
    }

    function test_votedLockResetThenWithdrawn() public {
        uint256 id = _lock(7e18, 30 days);
        vm.prank(alice);
        voter.vote(id);
        vm.prank(alice);
        vault.register(id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(T0 + 31 days);
        uint256 es = block.timestamp - (block.timestamp % 1 weeks);
        vm.warp(es + 30 minutes); // distribute window
        (bool ok, uint8 why) = vault.isProtectable(id);
        assertFalse(ok);
        assertEq(why, 6);
        vm.warp(es + 2 hours);
        vm.prank(keeper);
        vault.protect(id, address(0), address(0));
        assertEq(mezo.balanceOf(alice), 7e18);
    }

    function test_musdModesRejected() public {
        uint256 id = _lock(1e18, 30 days);
        LockwatchVault.Pref memory p = _pref(LockwatchVault.Mode.MUSD);
        p.debt = 1;
        p.sig = hex"01";
        p.deadline = uint64(block.timestamp + 1 days);
        vm.prank(alice);
        vm.expectRevert(LockwatchVault.InvalidPref.selector);
        vault.register(id, p);
        p.mode = LockwatchVault.Mode.MUSD_SAVINGS;
        vm.prank(alice);
        vm.expectRevert(LockwatchVault.InvalidPref.selector);
        vault.register(id, p);
    }

    function test_autoExtendToFourYears() public {
        uint256 id = _lock(1e18, 60 days);
        vm.prank(alice);
        vault.setExtendPolicy(id, 30 days, 0);
        (bool ok,,,) = vault.canExtend(id);
        assertFalse(ok); // too early
        vm.warp(T0 + 40 days);
        vm.prank(keeper);
        uint256 e = vault.extend(id);
        assertEq(e, ((block.timestamp + MAX) / 1 weeks) * 1 weeks);
    }

    function test_extendPolicyAcceptsLongTriggers() public {
        uint256 id = _lock(1e18, 365 days);
        vm.prank(alice);
        vault.setExtendPolicy(id, 180 days, 2 * 365 days);
        assertEq(vault.extendPolicy(id).triggerWithin, 180 days);
    }

    function test_claimBribesOnlyOnBoostVoter() public {
        uint256 id = _lock(1e18, 30 days);
        address g = makeAddr("gauge");
        MockReward bribe = new MockReward(address(voter), address(ve));
        MockERC20 inc = new MockERC20("INC");
        voter.addGauge(g, address(bribe), address(0));
        inc.mint(address(bribe), 3e18);
        bribe.notify(id, address(inc), 3e18);
        vm.prank(alice);
        vault.setRewardsAuto(id, true);
        address[] memory gs = new address[](1);
        gs[0] = g;
        address[][] memory bt = new address[][](1);
        bt[0] = new address[](1);
        bt[0][0] = address(inc);
        address[][] memory ft = new address[][](1); // empty fee list -> claimFees skipped
        vm.prank(keeper);
        vault.claimRewards(id, gs, bt, ft);
        assertEq(inc.balanceOf(alice), 3e18);
        // a non-empty fee list hits BoostVoter.claimFees, which does not exist on veMEZO
        ft[0] = new address[](1);
        vm.prank(keeper);
        vm.expectRevert();
        vault.claimRewards(id, gs, bt, ft);
    }
}
