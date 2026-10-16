// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {LockwatchVault} from "../../src/LockwatchVault.sol";
import {IVeBTC, IBorrowerOperationsSignatures, IERC20Min, ISavingsMUSD} from "../../src/interfaces/IMezo.sol";
import {MockERC20} from "../mocks/Mocks.sol";

interface IVeM is IVeBTC {
    function createLock(uint256 value, uint256 duration) external returns (uint256);
    function approve(address to, uint256 tokenId) external;
    function tokenId() external view returns (uint256);
}

/// @notice veMEZO against live Mezo testnet state (real VeMEZO + BoostVoter bytecode). Run with:
///   FOUNDRY_PROFILE=fork forge test --match-path 'test/fork/*' --fork-url https://rpc.test.mezo.org
/// MEZO (0x7B7c…01) is a precompile a local EVM cannot execute; we etch a plain ERC-20 there.
contract VeMEZOTestnetForkTest is Test {
    IVeM constant VE = IVeM(0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b);
    address constant MEZO = 0x7B7c000000000000000000000000000000000001;
    uint256 constant MAX = 4 * 365 days;
    LockwatchVault vault;
    MockERC20 mezo;
    address alice = makeAddr("alice");

    function setUp() public {
        if (block.chainid != 31611) return;
        vm.etch(MEZO, address(new MockERC20("MEZO")).code);
        mezo = MockERC20(MEZO);
        vault = new LockwatchVault(VE, IBorrowerOperationsSignatures(address(0)), IERC20Min(address(0)), ISavingsMUSD(address(0)), MAX);
    }

    function _lock(uint256 amt, uint256 dur) internal returns (uint256 id) {
        mezo.mint(alice, amt);
        vm.startPrank(alice);
        mezo.approve(address(VE), amt);
        id = VE.createLock(amt, dur);
        VE.approve(address(vault), id);
        vm.stopPrank();
    }

    function test_fork_wiring() public view {
        if (block.chainid != 31611) return;
        assertEq(VE.token(), MEZO);
        assertEq(address(vault.voter()), 0x21d7bDF5a5929AD179F8cA0c9014A0B62ae6Bfd1);
    }

    function test_fork_returnMezo() public {
        if (block.chainid != 31611) return;
        uint256 id = _lock(250e18, 7 days);
        LockwatchVault.Pref memory p;
        vm.prank(alice);
        vault.register(id, p);
        vm.warp(VE.locked(id).end + 2 hours);
        vault.protect(id, address(0), address(0));
        assertEq(mezo.balanceOf(alice), 250e18);
        assertEq(mezo.balanceOf(address(vault)), 0);
    }

    function test_fork_relockMezo() public {
        if (block.chainid != 31611) return;
        uint256 id = _lock(10e18, 7 days);
        LockwatchVault.Pref memory p;
        p.mode = LockwatchVault.Mode.RELOCK;
        p.relockDuration = 365 days;
        vm.prank(alice);
        vault.register(id, p);
        vm.warp(VE.locked(id).end + 2 hours);
        (, uint256 n) = vault.protect(id, address(0), address(0));
        assertEq(VE.ownerOf(n), alice);
        assertEq(uint256(int256(VE.locked(n).amount)), 10e18);
    }

    function test_fork_autoExtendToMax() public {
        if (block.chainid != 31611) return;
        uint256 id = _lock(1e18, 14 days);
        vm.prank(alice);
        vault.setExtendPolicy(id, 14 days, 0);
        uint256 e = vault.extend(id);
        assertEq(e, ((block.timestamp + MAX) / 1 weeks) * 1 weeks);
        assertEq(VE.locked(id).end, e);
    }

    function test_fork_claimBribesEmptyNoFees() public {
        if (block.chainid != 31611) return;
        uint256 id = _lock(1e18, 14 days);
        vm.prank(alice);
        vault.setRewardsAuto(id, true);
        address[] memory gs = new address[](0);
        address[][] memory t = new address[][](0);
        vault.claimRewards(id, gs, t, t); // BoostVoter.claimBribes with no gauges; claimFees never called
    }
}
