// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import "./Base.t.sol";

contract AutoExtendRewardsTest is Base {
    uint32 constant MAXP = 0; // duration 0 = keep at max

    function _setExtend(address who, uint256 id, uint32 trig, uint32 dur) internal {
        vm.startPrank(who);
        ve.approve(address(vault), id);
        vault.setExtendPolicy(id, trig, dur);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ auto-extend

    function test_extend_keepsAtMax() public {
        uint256 id = _lock(alice, 1 ether, 14 days);
        uint256 end0 = _end(id);
        _setExtend(alice, id, 21 days, MAXP);
        (bool ok, uint8 why,, uint256 target) = vault.canExtend(id);
        assertTrue(ok, "can");
        assertEq(why, 0);
        vm.prank(keeper);
        uint256 newEnd = vault.extend(id);
        assertEq(newEnd, target);
        assertGt(newEnd, end0);
        assertEq(newEnd, ((block.timestamp + 30 days) / 1 weeks) * 1 weeks);
        assertEq(ve.ownerOf(id), alice, "owner unchanged");
        assertEq(address(vault).balance, 0);
    }

    function test_extend_tooEarly_reverts() public {
        uint256 id = _lock(alice, 1 ether, 28 days);
        _setExtend(alice, id, 3 days, MAXP);
        (bool ok, uint8 why,,) = vault.canExtend(id);
        assertFalse(ok);
        assertEq(why, 8);
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotExtendable.selector, uint8(8)));
        vault.extend(id);
    }

    function test_extend_whenWithinWindow_extendsXWeeks() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _setExtend(alice, id, 5 days, 14 days);
        vm.warp(_end(id) - 4 days);
        uint256 newEnd = vault.extend(id);
        assertEq(newEnd, ((block.timestamp + 14 days) / 1 weeks) * 1 weeks);
    }

    function test_extend_noGain_reverts() public {
        uint256 id = _lock(alice, 1 ether, 30 days);
        _setExtend(alice, id, 30 days, MAXP);
        // already at max: target rounds to the same week
        (bool ok, uint8 why,,) = vault.canExtend(id);
        assertFalse(ok);
        assertEq(why, 10);
    }

    function test_extend_notApproved() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.prank(alice);
        vault.setExtendPolicy(id, 20 days, MAXP);
        (bool ok, uint8 why,,) = vault.canExtend(id);
        assertFalse(ok);
        assertEq(why, 5);
    }

    function test_extend_expired_cannot() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _setExtend(alice, id, 20 days, MAXP);
        vm.warp(_end(id));
        (, uint8 why,,) = vault.canExtend(id);
        assertEq(why, 9);
    }

    function test_extend_staleAfterTransfer() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _setExtend(alice, id, 20 days, MAXP);
        vm.prank(alice);
        ve.transferFrom(alice, bob, id);
        (, uint8 why,,) = vault.canExtend(id);
        assertEq(why, 2);
    }

    function test_extend_permanentAndManaged() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _setExtend(alice, id, 20 days, MAXP);
        ve.setPermanent(id, true);
        (, uint8 why,,) = vault.canExtend(id);
        assertEq(why, 4);
        ve.setPermanent(id, false);
        ve.setEscrowType(id, 1);
        (, why,,) = vault.canExtend(id);
        assertEq(why, 7);
    }

    function test_setExtend_onlyOwner_andValidation() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.prank(bob);
        vm.expectRevert(LockwatchVault.NotLockOwner.selector);
        vault.setExtendPolicy(id, 1 days, 0);
        vm.startPrank(alice);
        vm.expectRevert(LockwatchVault.InvalidPref.selector);
        vault.setExtendPolicy(id, 0, 0);
        vm.expectRevert(LockwatchVault.InvalidPref.selector);
        vault.setExtendPolicy(id, 31 days, 0);
        vm.expectRevert(LockwatchVault.InvalidPref.selector);
        vault.setExtendPolicy(id, 1 days, 3 days);
        vm.expectRevert(LockwatchVault.InvalidPref.selector);
        vault.setExtendPolicy(id, 1 days, 31 days);
        vault.setExtendPolicy(id, 1 days, 14 days);
        vm.stopPrank();
        assertEq(vault.extendPolicy(id).owner, alice);
    }

    function test_clearExtend() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _setExtend(alice, id, 20 days, 0);
        vm.prank(bob);
        vm.expectRevert(LockwatchVault.NotLockOwner.selector);
        vault.clearExtendPolicy(id);
        vm.prank(alice);
        vault.clearExtendPolicy(id);
        (, uint8 why,,) = vault.canExtend(id);
        assertEq(why, 1);
        vm.expectRevert(LockwatchVault.NotRegistered.selector);
        vault.clearExtendPolicy(id);
    }

    function test_protect_clearsExtendAndRewards() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.startPrank(alice);
        vault.setExtendPolicy(id, 1 days, 0);
        vault.setRewardsAuto(id, true);
        vm.stopPrank();
        vm.warp(_end(id));
        _protect(id);
        assertEq(vault.extendPolicy(id).owner, address(0));
        assertEq(vault.rewardsOwner(id), address(0));
    }

    /// Fuzz: any trigger/duration/time — extend either reverts or sets end to the weekly-rounded target,
    /// never shortens a lock, never exceeds now + maxLock, and never moves funds or ownership.
    function testFuzz_extend(uint32 trig, uint32 dur, uint32 lockDur, uint32 dt) public {
        lockDur = uint32(bound(lockDur, 7 days, 30 days));
        trig = uint32(bound(trig, 1, 30 days));
        dur = uint32(bound(dur, 0, 30 days));
        if (dur != 0 && dur < 7 days) dur = 7 days;
        uint256 id = _lock(alice, 1 ether, lockDur);
        _setExtend(alice, id, trig, dur);
        uint256 end0 = _end(id);
        vm.warp(block.timestamp + bound(dt, 0, end0 - block.timestamp - 1));
        try vault.extend(id) returns (uint256 newEnd) {
            assertGt(newEnd, end0);
            assertLe(newEnd, block.timestamp + 30 days);
            assertLe(end0 - (block.timestamp), trig);
        } catch {
            assertEq(_end(id), end0);
        }
        assertEq(ve.ownerOf(id), alice);
        assertEq(address(vault).balance, 0);
    }

    // ------------------------------------------------------------ rewards

    MockERC20 tokA;
    MockERC20 tokB;
    MockReward bribe;
    MockReward fees;
    address gauge = makeAddr("gauge");

    function _gauge() internal {
        tokA = new MockERC20("A");
        tokB = new MockERC20("B");
        bribe = new MockReward(address(voter), address(ve));
        fees = new MockReward(address(voter), address(ve));
        voter.addGauge(gauge, address(bribe), address(fees));
    }

    function _claimArgs() internal view returns (address[] memory g, address[][] memory bt, address[][] memory ft) {
        g = new address[](1);
        g[0] = gauge;
        bt = new address[][](1);
        bt[0] = new address[](2);
        bt[0][0] = address(tokA);
        bt[0][1] = address(tokB);
        ft = new address[][](1);
        ft[0] = new address[](1);
        ft[0][0] = address(tokA);
    }

    function test_claimRewards_paysOwnerDirectly() public {
        _gauge();
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.startPrank(alice);
        ve.approve(address(vault), id);
        vault.setRewardsAuto(id, true);
        vm.stopPrank();
        bribe.notify(id, address(tokA), 5e18);
        bribe.notify(id, address(tokB), 7e18);
        fees.notify(id, address(tokA), 1e18);
        (address[] memory g, address[][] memory bt, address[][] memory ft) = _claimArgs();
        vm.prank(keeper);
        vault.claimRewards(id, g, bt, ft);
        assertEq(tokA.balanceOf(alice), 6e18);
        assertEq(tokB.balanceOf(alice), 7e18);
        assertEq(tokA.balanceOf(address(vault)), 0);
        assertEq(tokA.balanceOf(keeper), 0);
    }

    function test_claimRewards_requiresOptIn_andApproval_andRealGauge() public {
        _gauge();
        uint256 id = _lock(alice, 1 ether, 10 days);
        (address[] memory g, address[][] memory bt, address[][] memory ft) = _claimArgs();
        vm.expectRevert(LockwatchVault.RewardsNotEnabled.selector);
        vault.claimRewards(id, g, bt, ft);
        vm.prank(alice);
        vault.setRewardsAuto(id, true);
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotProtectable.selector, uint8(5)));
        vault.claimRewards(id, g, bt, ft);
        vm.prank(alice);
        ve.approve(address(vault), id);
        g[0] = makeAddr("fakeGauge");
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotGauge.selector, g[0]));
        vault.claimRewards(id, g, bt, ft);
    }

    function test_claimRewards_staleOwnerBlocked_andOptOut() public {
        _gauge();
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.startPrank(alice);
        ve.approve(address(vault), id);
        vault.setRewardsAuto(id, true);
        ve.transferFrom(alice, bob, id);
        vm.stopPrank();
        (address[] memory g, address[][] memory bt, address[][] memory ft) = _claimArgs();
        vm.expectRevert(LockwatchVault.RewardsNotEnabled.selector);
        vault.claimRewards(id, g, bt, ft);
        vm.prank(alice);
        vm.expectRevert(LockwatchVault.NotLockOwner.selector);
        vault.setRewardsAuto(id, false);
    }

    function test_claimRewards_lengthMismatch() public {
        _gauge();
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.startPrank(alice);
        ve.approve(address(vault), id);
        vault.setRewardsAuto(id, true);
        vm.stopPrank();
        (address[] memory g, address[][] memory bt,) = _claimArgs();
        vm.expectRevert(LockwatchVault.LengthMismatch.selector);
        vault.claimRewards(id, g, bt, new address[][](0));
    }

    /// Fuzz: whoever calls claimRewards, rewards land with the lock owner only.
    function testFuzz_claimRewards_onlyOwnerPaid(address caller, uint96 a, uint96 b) public {
        vm.assume(caller != alice);
        _gauge();
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.startPrank(alice);
        ve.approve(address(vault), id);
        vault.setRewardsAuto(id, true);
        vm.stopPrank();
        bribe.notify(id, address(tokA), a);
        fees.notify(id, address(tokA), b);
        (address[] memory g, address[][] memory bt, address[][] memory ft) = _claimArgs();
        vm.prank(caller);
        vault.claimRewards(id, g, bt, ft);
        assertEq(tokA.balanceOf(alice), uint256(a) + b);
        assertEq(tokA.balanceOf(caller), 0);
    }
}
