// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IVeBTC} from "../../src/interfaces/IMezo.sol";
import {MockERC20} from "../mocks/Mocks.sol";

interface IRewardsDistributor {
    function claimable(uint256) external view returns (uint256);
    function claimMany(uint256[] calldata) external returns (bool);
    function depositor() external view returns (address);
    function ve() external view returns (address);
}

interface ISplitter {
    function activePeriod() external view returns (uint256);
}

/// @notice Rebase auto-claim against the live veMEZO RewardsDistributor (what the keeper calls).
///   FOUNDRY_PROFILE=fork forge test --match-path 'test/fork/*' --fork-url https://rpc.test.mezo.org
/// MEZO is a precompile, so a plain ERC-20 is etched there and the distributor is funded with its own tracked balance.
contract RebaseTestnetForkTest is Test {
    IRewardsDistributor constant DIST = IRewardsDistributor(0x2962E8817ae716019F759d098e2caE658bDcAd04);
    IVeBTC constant VE = IVeBTC(0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b);
    address constant MEZO = 0x7B7c000000000000000000000000000000000001;
    address keeper = makeAddr("keeper");

    function setUp() public {
        if (block.chainid != 31611) return;
        vm.etch(MEZO, address(new MockERC20("MEZO")).code);
        MockERC20(MEZO).mint(address(DIST), 1e30);
        vm.prank(address(DIST)); // etched storage is empty: restore the distributor's allowance to ve
        MockERC20(MEZO).approve(address(VE), type(uint256).max);
    }

    function _find(bool live) internal view returns (uint256 id, uint256 amt) {
        for (uint256 i = 920; i > 600; --i) {
            uint256 c = DIST.claimable(i);
            if (c == 0) continue;
            IVeBTC.LockedBalance memory l = VE.locked(i);
            if (l.isPermanent) continue;
            if (live == (l.end > block.timestamp)) return (i, c);
        }
    }

    function test_fork_wiring() public view {
        if (block.chainid != 31611) return;
        assertEq(DIST.ve(), address(VE));
    }

    function test_fork_claimManyCompoundsLiveAndPaysExpired() public {
        if (block.chainid != 31611) return;
        if (ISplitter(DIST.depositor()).activePeriod() < (block.timestamp / 1 weeks) * 1 weeks) return; // epoch not rolled yet
        (uint256 a, uint256 ca) = _find(true);
        (uint256 b, uint256 cb) = _find(false);
        require(a != 0 && b != 0, "no candidates");
        int128 before = VE.locked(a).amount;
        address ownerB = VE.ownerOf(b);
        uint256 balB = MockERC20(MEZO).balanceOf(ownerB);
        uint256[] memory ids = new uint256[](2);
        ids[0] = a;
        ids[1] = b;
        vm.prank(keeper); // anyone may claim
        DIST.claimMany(ids);
        assertEq(uint256(int256(VE.locked(a).amount - before)), ca, "live lock compounded");
        assertEq(MockERC20(MEZO).balanceOf(ownerB) - balB, cb, "expired lock's owner paid");
        assertEq(MockERC20(MEZO).balanceOf(keeper), 0, "keeper gets nothing");
        assertEq(DIST.claimable(a), 0);
        assertEq(DIST.claimable(b), 0);
    }
}
