// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import "./Base.t.sol";

contract LockwatchVaultTest is Base {
    // ------------------------------------------------ RETURN
    function test_return_sendsBtcToOwner() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(_end(id));
        (uint256 amt,) = _protect(id);
        assertEq(amt, 1 ether);
        assertEq(alice.balance, 1 ether);
        assertEq(address(vault).balance, 0);
        assertEq(keeper.balance, 0);
        assertEq(vault.prefs(id).owner, address(0), "pref cleared");
    }

    function test_return_toContractThatRejectsBtc() public {
        Rejector r = new Rejector();
        uint256 id = _lock(address(r), 1 ether, 10 days);
        _register(address(r), id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(_end(id));
        _protect(id);
        assertEq(address(r).balance, 1 ether, "precompile transfer bypasses receive()");
    }

    function test_emitsProtected() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(_end(id));
        vm.expectEmit(true, true, false, true);
        emit LockwatchVault.Protected(id, alice, LockwatchVault.Mode.RETURN, 1 ether, 0);
        _protect(id);
    }

    // ------------------------------------------------ RELOCK
    function test_relock_mintsNewLockToOwner() public {
        uint256 id = _lock(alice, 2 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RELOCK));
        vm.warp(_end(id) + 2 hours);
        (uint256 amt, uint256 nid) = _protect(id);
        assertEq(amt, 2 ether);
        assertEq(ve.ownerOf(nid), alice);
        assertEq(uint256(int256(ve.locked(nid).amount)), 2 ether);
        assertGt(ve.locked(nid).end, block.timestamp);
        assertEq(address(vault).balance, 0);
        assertEq(btc.allowance(address(vault), address(ve)), 0);
    }

    function test_relock_tooLong_fallsBackToReturn() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        LockwatchVault.Pref memory p = _pref(LockwatchVault.Mode.RELOCK);
        p.relockDuration = 60 days; // > 30d max
        _register(alice, id, p);
        vm.warp(_end(id));
        (, uint256 nid) = _protect(id);
        assertEq(nid, 0);
        assertEq(alice.balance, 1 ether);
        assertEq(btc.allowance(address(vault), address(ve)), 0);
    }

    // ------------------------------------------------ MUSD
    function _musdPref(LockwatchVault.Mode m, uint256 asset, uint256 debt, address recipient)
        internal view returns (LockwatchVault.Pref memory p)
    {
        p.mode = m;
        p.debt = debt;
        p.deadline = uint64(block.timestamp + 60 days);
        p.sig = _signTrove(alicePk, asset, debt, recipient, p.deadline);
    }

    function test_musd_opensTroveOwnedByOwner() public {
        uint256 id = _lock(alice, 0.1 ether, 10 days);
        _register(alice, id, _musdPref(LockwatchVault.Mode.MUSD, 0.1 ether, 3000e18, alice));
        vm.warp(_end(id));
        _protect(id);
        assertEq(bos.troveColl(alice), 0.1 ether);
        assertEq(bos.troveDebt(alice), 3000e18);
        assertEq(musd.balanceOf(alice), 3000e18);
        assertEq(address(vault).balance, 0);
        assertEq(musd.balanceOf(address(vault)), 0);
    }

    function test_musdSavings_depositsSharesToOwner() public {
        uint256 id = _lock(alice, 0.1 ether, 10 days);
        _register(alice, id, _musdPref(LockwatchVault.Mode.MUSD_SAVINGS, 0.1 ether, 3000e18, address(vault)));
        vm.warp(_end(id));
        _protect(id);
        assertEq(smusd.balanceOf(alice), 3000e18);
        assertEq(smusd.balanceOf(address(vault)), 0);
        assertEq(musd.balanceOf(address(vault)), 0);
    }

    function test_musdSavings_depositFails_musdToOwner() public {
        smusd.setReverts(true);
        uint256 id = _lock(alice, 0.1 ether, 10 days);
        _register(alice, id, _musdPref(LockwatchVault.Mode.MUSD_SAVINGS, 0.1 ether, 3000e18, address(vault)));
        vm.warp(_end(id));
        _protect(id);
        assertEq(musd.balanceOf(alice), 3000e18);
        assertEq(bos.troveDebt(alice), 3000e18);
    }

    function test_musd_badSig_fallsBackToReturn() public {
        uint256 id = _lock(alice, 0.1 ether, 10 days);
        LockwatchVault.Pref memory p = _musdPref(LockwatchVault.Mode.MUSD, 0.2 ether, 3000e18, alice); // wrong asset
        _register(alice, id, p);
        vm.warp(_end(id));
        _protect(id);
        assertEq(alice.balance, 0.1 ether);
        assertEq(bos.troveDebt(alice), 0);
    }

    function test_musd_nonceConsumed_fallsBack() public {
        uint256 id = _lock(alice, 0.1 ether, 10 days);
        _register(alice, id, _musdPref(LockwatchVault.Mode.MUSD, 0.1 ether, 3000e18, alice));
        stdstore_bumpNonce(alice);
        vm.warp(_end(id));
        _protect(id);
        assertEq(alice.balance, 0.1 ether);
    }

    function test_musd_deadlinePassed_fallsBack() public {
        uint256 id = _lock(alice, 0.1 ether, 10 days);
        LockwatchVault.Pref memory p = _musdPref(LockwatchVault.Mode.MUSD, 0.1 ether, 3000e18, alice);
        p.deadline = uint64(block.timestamp + 1 days);
        p.sig = _signTrove(alicePk, 0.1 ether, 3000e18, alice, p.deadline);
        _register(alice, id, p);
        vm.warp(_end(id));
        _protect(id);
        assertEq(alice.balance, 0.1 ether);
    }

    function test_musd_priceDrop_icrFails_fallsBack() public {
        uint256 id = _lock(alice, 0.1 ether, 10 days);
        _register(alice, id, _musdPref(LockwatchVault.Mode.MUSD, 0.1 ether, 7000e18, alice));
        bos.setPrice(60_000e18);
        vm.warp(_end(id));
        _protect(id);
        assertEq(alice.balance, 0.1 ether);
    }

    function stdstore_bumpNonce(address who) internal {
        // nonces live in mapping slot of MockBOS.getNonce
        bytes32 slot = keccak256(abi.encode(who, uint256(1)));
        vm.store(address(bos), slot, bytes32(uint256(1)));
        assertEq(bos.getNonce(who), 1);
    }

    // ------------------------------------------------ votes
    function test_votedLock_resetThenWithdraw() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.prank(alice);
        voter.vote(id);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(_end(id) + 30 minutes);
        (bool ok, uint8 why) = vault.isProtectable(id);
        assertFalse(ok);
        assertEq(why, 6, "distribute window");
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotProtectable.selector, uint8(6)));
        _protect(id);
        vm.warp(_end(id) + 61 minutes);
        _protect(id);
        assertEq(alice.balance, 1 ether);
        assertFalse(ve.voted(id));
    }

    // ------------------------------------------------ guards
    function test_revert_notExpired() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(_end(id) - 1);
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotProtectable.selector, uint8(3)));
        _protect(id);
    }

    function test_revert_notRegistered() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.warp(_end(id));
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotProtectable.selector, uint8(1)));
        _protect(id);
    }

    function test_revert_notApproved() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.prank(alice);
        vault.register(id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(_end(id));
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotProtectable.selector, uint8(5)));
        _protect(id);
    }

    function test_approvalForAll_works() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.startPrank(alice);
        ve.setApprovalForAll(address(vault), true);
        vault.register(id, _pref(LockwatchVault.Mode.RETURN));
        vm.stopPrank();
        vm.warp(_end(id));
        _protect(id);
        assertEq(alice.balance, 1 ether);
    }

    function test_revert_staleOwnerAfterTransfer() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.prank(alice);
        ve.transferFrom(alice, bob, id);
        vm.prank(bob);
        ve.approve(address(vault), id); // even if new owner approves, alice's pref must not run
        vm.warp(_end(id));
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotProtectable.selector, uint8(2)));
        _protect(id);
    }

    function test_revert_permanent() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        ve.setPermanent(id, true);
        vm.warp(_end(id));
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotProtectable.selector, uint8(4)));
        _protect(id);
    }

    function test_revert_managedNft() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        ve.setEscrowType(id, 2);
        vm.warp(_end(id));
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotProtectable.selector, uint8(7)));
        _protect(id);
    }

    function test_revert_doubleProtect() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(_end(id));
        _protect(id);
        vm.expectRevert(abi.encodeWithSelector(LockwatchVault.NotProtectable.selector, uint8(1)));
        _protect(id);
    }

    function test_register_onlyOwner() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        vm.prank(bob);
        vm.expectRevert(LockwatchVault.NotLockOwner.selector);
        vault.register(id, _pref(LockwatchVault.Mode.RETURN));
    }

    function test_register_validation() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        LockwatchVault.Pref memory p = _pref(LockwatchVault.Mode.RELOCK);
        p.relockDuration = 0;
        vm.startPrank(alice);
        vm.expectRevert(LockwatchVault.InvalidPref.selector);
        vault.register(id, p);
        p.mode = LockwatchVault.Mode.MUSD; // no sig
        vm.expectRevert(LockwatchVault.InvalidPref.selector);
        vault.register(id, p);
        vm.stopPrank();
    }

    function test_savingsDisabled_rejectsMode() public {
        LockwatchVault v2 = new LockwatchVault(
            IVeBTC(address(ve)), IBorrowerOperationsSignatures(address(bos)), IERC20Min(address(musd)), ISavingsMUSD(address(0)), 30 days
        );
        uint256 id = _lock(alice, 1 ether, 10 days);
        LockwatchVault.Pref memory p = _musdPref(LockwatchVault.Mode.MUSD_SAVINGS, 1 ether, 3000e18, address(v2));
        vm.prank(alice);
        vm.expectRevert(LockwatchVault.InvalidPref.selector);
        v2.register(id, p);
    }

    function test_unregister() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.prank(bob);
        vm.expectRevert(LockwatchVault.NotLockOwner.selector);
        vault.unregister(id);
        vm.prank(alice);
        vault.unregister(id);
        assertEq(vault.prefs(id).owner, address(0));
    }

    function test_newOwner_canOverwrite() public {
        uint256 id = _lock(alice, 1 ether, 10 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.prank(alice);
        ve.transferFrom(alice, bob, id);
        _register(bob, id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(_end(id));
        _protect(id);
        assertEq(bob.balance, 1 ether);
        assertEq(alice.balance, 0);
    }

    function test_receive_rejectsDirectBtc() public {
        vm.deal(bob, 1 ether);
        vm.prank(bob);
        (bool ok,) = address(vault).call{value: 1 ether}("");
        assertFalse(ok);
    }

    function test_protectOne_onlySelf() public {
        vm.expectRevert(LockwatchVault.OnlySelf.selector);
        vault.protectOne(1, address(0), address(0));
    }

    // ------------------------------------------------ batch
    function test_batch_isolatesFailures() public {
        uint256 a = _lock(alice, 1 ether, 10 days);
        uint256 b = _lock(bob, 2 ether, 10 days);
        uint256 c = _lock(bob, 3 ether, 10 days);
        _register(alice, a, _pref(LockwatchVault.Mode.RETURN));
        _register(bob, b, _pref(LockwatchVault.Mode.RETURN));
        // c is not registered
        vm.warp(_end(a));
        uint256[] memory ids = new uint256[](3);
        (ids[0], ids[1], ids[2]) = (a, c, b);
        address[] memory z = new address[](3);
        bool[] memory ok = vault.protectBatch(ids, z, z);
        assertTrue(ok[0]);
        assertFalse(ok[1]);
        assertTrue(ok[2]);
        assertEq(alice.balance, 1 ether);
        assertEq(bob.balance, 2 ether);
    }

    function test_batch_lengthMismatch() public {
        vm.expectRevert(LockwatchVault.LengthMismatch.selector);
        vault.protectBatch(new uint256[](2), new address[](1), new address[](2));
    }

    // ------------------------------------------------ fuzz
    function testFuzz_return(uint96 amt, uint32 dur, address caller) public {
        amt = uint96(bound(amt, 1, 1e24));
        dur = uint32(bound(dur, 7 days, 30 days));
        vm.assume(caller != alice && caller != address(vault) && caller.code.length == 0 && caller > address(0x100));
        uint256 id = _lock(alice, amt, dur);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        vm.warp(_end(id));
        uint256 cb = caller.balance;
        vm.prank(caller);
        vault.protect(id, address(0), address(0));
        assertEq(alice.balance, amt);
        assertEq(caller.balance, cb);
        assertEq(address(vault).balance, 0);
    }

    function testFuzz_relockDuration(uint96 amt, uint32 relock) public {
        amt = uint96(bound(amt, 1, 1e24));
        relock = uint32(bound(relock, 1, 90 days));
        uint256 id = _lock(alice, amt, 10 days);
        LockwatchVault.Pref memory p = _pref(LockwatchVault.Mode.RELOCK);
        p.relockDuration = relock;
        _register(alice, id, p);
        vm.warp(_end(id) + 1 days);
        (, uint256 nid) = _protect(id);
        if (nid == 0) assertEq(alice.balance, amt); // fallback
        else assertEq(ve.ownerOf(nid), alice);
        assertEq(address(vault).balance, 0);
    }

    function testFuzz_cannotProtectEarly(uint32 dt) public {
        uint256 id = _lock(alice, 1 ether, 20 days);
        _register(alice, id, _pref(LockwatchVault.Mode.RETURN));
        uint256 e = _end(id);
        vm.warp(bound(dt, block.timestamp, e - 1));
        vm.expectRevert();
        _protect(id);
    }
}

contract Rejector {
    receive() external payable { revert("no"); }
}

contract GasGriefTest is Base {
    /// A keeper must not be able to downgrade MUSD mode to RETURN by starving the inner call of gas.
    function test_gasGriefing_neverForcesFallback() public {
        uint256 id = _lock(alice, 0.1 ether, 10 days);
        LockwatchVault.Pref memory p;
        p.mode = LockwatchVault.Mode.MUSD;
        p.debt = 3000e18;
        p.deadline = uint64(block.timestamp + 60 days);
        p.sig = _signTrove(alicePk, 0.1 ether, 3000e18, alice, p.deadline);
        _register(alice, id, p);
        bos.setGasBurn(3_000_000); // real SortedTroves insert with poor hints can cost millions
        vm.warp(_end(id));
        uint256 snap = vm.snapshotState();
        uint256 successes;
        for (uint256 gas = 2_800_000; gas <= 3_600_000; gas += 4_000) {
            vm.revertToState(snap);
            vm.prank(keeper);
            try vault.protect{gas: gas}(id, address(0), address(0)) {
                successes++;
                assertEq(bos.troveDebt(alice), 3000e18, "succeeded without opening the trove = griefed");
                assertEq(alice.balance, 0);
            } catch {}
        }
        assertGt(successes, 0, "some gas level must succeed");
    }
}
