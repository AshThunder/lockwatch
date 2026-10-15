// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {LockwatchVault} from "../../src/LockwatchVault.sol";
import {IVeBTC, IVoter, IBorrowerOperationsSignatures, IERC20Min, ISavingsMUSD} from "../../src/interfaces/IMezo.sol";
import {MezoBTCMock, MEZO_BTC} from "../mocks/Mocks.sol";

interface IVeFull is IVeBTC {
    function createLock(uint256 value, uint256 duration) external returns (uint256);
    function approve(address to, uint256 tokenId) external;
    function tokenId() external view returns (uint256);
}

interface IVoterFull is IVoter {
    function vote(uint256 tokenId, address[] calldata pools, uint256[] calldata weights) external;
    function pools(uint256) external view returns (address);
    function length() external view returns (uint256);
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
        vault = new LockwatchVault(VE, BOS, MUSD, ISavingsMUSD(address(0)));
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
