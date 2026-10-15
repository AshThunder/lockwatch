// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import "./Base.t.sol";
import {CommonBase} from "forge-std/Base.sol";
import {StdUtils} from "forge-std/StdUtils.sol";
import {StdCheats} from "forge-std/StdCheats.sol";

contract Handler is CommonBase, StdCheats, StdUtils {
    LockwatchVault vault;
    MockVeBTC ve;
    MockVoter voter;
    MezoBTCMock btc;
    address[] public actors;
    uint256[] public ids;
    uint256 public minted;
    uint256 public misdirected; // ghost: BTC that reached anyone other than the recorded owner
    uint256 public protects;

    constructor(LockwatchVault v, MockVeBTC e, MockVoter vo, MezoBTCMock b) {
        vault = v; ve = e; voter = vo; btc = b;
        for (uint256 i; i < 4; ++i) actors.push(address(uint160(0xBEEF00 + i)));
    }

    function _actor(uint256 s) internal view returns (address) { return actors[s % actors.length]; }
    function _id(uint256 s) internal view returns (uint256) { return ids.length == 0 ? 0 : ids[s % ids.length]; }

    function createLock(uint256 a, uint96 amt, uint32 dur) external {
        address who = _actor(a);
        amt = uint96(bound(amt, 1, 100 ether));
        dur = uint32(bound(dur, 7 days, 30 days));
        vm.deal(who, who.balance + amt);
        minted += amt;
        vm.startPrank(who);
        btc.approve(address(ve), amt);
        ids.push(ve.createLock(amt, dur));
        vm.stopPrank();
    }

    function register(uint256 s, uint8 mode, bool approve, uint32 relock) external {
        uint256 id = _id(s);
        if (id == 0 || ve._owner(id) == address(0)) return;
        address o = ve._owner(id);
        LockwatchVault.Pref memory p;
        p.mode = LockwatchVault.Mode(mode % 2); // RETURN / RELOCK (MUSD covered by unit tests)
        p.relockDuration = uint32(bound(relock, 1, 40 days));
        vm.startPrank(o);
        if (approve) ve.approve(address(vault), id);
        vault.register(id, p);
        vm.stopPrank();
    }

    function transfer(uint256 s, uint256 to) external {
        uint256 id = _id(s);
        if (id == 0 || ve._owner(id) == address(0)) return;
        address o = ve._owner(id);
        vm.prank(o);
        ve.transferFrom(o, _actor(to), id);
    }

    function vote(uint256 s) external {
        uint256 id = _id(s);
        if (id == 0 || ve._owner(id) == address(0)) return;
        vm.prank(ve._owner(id));
        try voter.vote(id) {} catch {}
    }

    function warp(uint32 dt) external {
        vm.warp(block.timestamp + bound(dt, 1 minutes, 10 days));
    }

    function protect(uint256 s, uint256 callerSeed) external {
        uint256 id = _id(s);
        if (id == 0) return;
        address owner = vault.prefs(id).owner;
        address caller = _actor(callerSeed);
        uint256[] memory before = new uint256[](actors.length);
        for (uint256 i; i < actors.length; ++i) before[i] = actors[i].balance;
        uint256 nextId = ve.tokenId() + 1;
        vm.prank(caller);
        try vault.protect(id, address(0), address(0)) returns (uint256 amount, uint256 newId) {
            protects++;
            for (uint256 i; i < actors.length; ++i) {
                uint256 gained = actors[i].balance - before[i] > 0 ? actors[i].balance - before[i] : 0;
                if (actors[i] != owner && gained > 0) misdirected += gained;
                if (actors[i] == owner && newId == 0 && gained != amount) misdirected += 1;
            }
            if (newId != 0) {
                if (newId != nextId || ve._owner(newId) != owner) misdirected += 1;
                ids.push(newId);
            }
        } catch {}
    }

    uint256 public extends;
    uint256 public badExtends; // ghost: extend that shortened a lock, changed its owner, or exceeded max

    function setExtend(uint256 s, uint32 trig, uint32 dur, bool approve) external {
        uint256 id = _id(s);
        if (id == 0 || ve._owner(id) == address(0)) return;
        address o = ve._owner(id);
        vm.startPrank(o);
        if (approve) ve.approve(address(vault), id);
        try vault.setExtendPolicy(id, uint32(bound(trig, 1, 30 days)), uint32(bound(dur, 0, 30 days))) {} catch {}
        vm.stopPrank();
    }

    function extend(uint256 s, uint256 callerSeed) external {
        uint256 id = _id(s);
        if (id == 0 || ve._owner(id) == address(0)) return;
        address o = ve._owner(id);
        uint256 end0 = ve.locked(id).end;
        vm.prank(_actor(callerSeed));
        try vault.extend(id) returns (uint256 newEnd) {
            extends++;
            if (newEnd <= end0 || newEnd > block.timestamp + 30 days || ve._owner(id) != o) badExtends++;
        } catch {}
    }

    function actorsLength() external view returns (uint256) { return actors.length; }
}

contract LockwatchVaultInvariant is Base {
    Handler h;

    function setUp() public override {
        super.setUp();
        h = new Handler(vault, ve, voter, btc);
        targetContract(address(h));
    }

    /// 1. The vault never ends a tx holding BTC, MUSD or sMUSD.
    function invariant_vaultHoldsNothing() public view {
        assertEq(address(vault).balance, 0);
        assertEq(musd.balanceOf(address(vault)), 0);
        assertEq(smusd.balanceOf(address(vault)), 0);
    }

    /// 2. Funds / new locks only ever reach the recorded owner (== ownerOf at protect time).
    function invariant_onlyOwnerPaid() public view {
        assertEq(h.misdirected(), 0);
    }

    /// 3. BTC is conserved: every minted sat is in an actor wallet or still locked in veBTC.
    function invariant_btcConserved() public view {
        uint256 sum = address(ve).balance;
        for (uint256 i; i < h.actorsLength(); ++i) sum += h.actors(i).balance;
        assertEq(sum, h.minted());
    }

    /// 5. Auto-extend only ever lengthens a lock, within maxLock, without touching ownership.
    function invariant_extendSafe() public view {
        assertEq(h.badExtends(), 0);
    }

    /// 4. Vault leaves no lingering BTC allowance to veBTC.
    function invariant_noAllowance() public view {
        assertEq(btc.allowance(address(vault), address(ve)), 0);
    }
}
