// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {LockwatchVault} from "../src/LockwatchVault.sol";
import {IVeBTC, IBorrowerOperationsSignatures, IERC20Min, ISavingsMUSD} from "../src/interfaces/IMezo.sol";
import "./mocks/Mocks.sol";

abstract contract Base is Test {
    MezoBTCMock btc;
    MockVoter voter;
    MockVeBTC ve;
    MockERC20 musd;
    MockBOS bos;
    MockSMUSD smusd;
    LockwatchVault vault;

    uint256 alicePk = 0xA11CE;
    address alice;
    address bob = makeAddr("bob");
    address keeper = makeAddr("keeper");

    uint256 constant T0 = 1_791_590_400 + 3 days; // a Sunday (epochs flip Thu 00:00 UTC)

    function setUp() public virtual {
        vm.warp(T0);
        alice = vm.addr(alicePk);
        vm.etch(MEZO_BTC, address(new MezoBTCMock()).code);
        btc = MezoBTCMock(MEZO_BTC);
        voter = new MockVoter();
        ve = new MockVeBTC(MEZO_BTC, address(voter));
        voter.setVe(address(ve));
        musd = new MockERC20("MUSD");
        bos = new MockBOS(musd);
        smusd = new MockSMUSD(musd);
        vault = new LockwatchVault(
            IVeBTC(address(ve)), IBorrowerOperationsSignatures(address(bos)), IERC20Min(address(musd)), ISavingsMUSD(address(smusd)), 30 days
        );
        vm.label(address(vault), "vault");
    }

    function _lock(address who, uint256 amt, uint256 dur) internal returns (uint256 id) {
        vm.deal(who, who.balance + amt);
        vm.startPrank(who);
        btc.approve(address(ve), amt);
        id = ve.createLock(amt, dur);
        vm.stopPrank();
    }

    function _end(uint256 id) internal view returns (uint256) {
        return ve.locked(id).end;
    }

    function _pref(LockwatchVault.Mode m) internal view returns (LockwatchVault.Pref memory p) {
        p.mode = m;
        if (m == LockwatchVault.Mode.RELOCK) p.relockDuration = 14 days;
    }

    function _signTrove(uint256 pk, uint256 asset, uint256 debt, address recipient, uint256 deadline)
        internal view returns (bytes memory)
    {
        address b = vm.addr(pk);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, bos.digest(asset, debt, b, recipient, bos.getNonce(b), deadline));
        return abi.encodePacked(r, s, v);
    }

    function _register(address who, uint256 id, LockwatchVault.Pref memory p) internal {
        vm.startPrank(who);
        ve.approve(address(vault), id);
        vault.register(id, p);
        vm.stopPrank();
    }

    function _protect(uint256 id) internal returns (uint256 a, uint256 n) {
        vm.prank(keeper);
        (a, n) = vault.protect(id, address(0), address(0));
    }
}
