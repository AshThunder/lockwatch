// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IVeBTC} from "../../src/interfaces/IMezo.sol";

address constant MEZO_BTC = 0x7b7C000000000000000000000000000000000000;

/// @notice Emulates Mezo's BTC ERC-20 precompile: balanceOf == native balance, transfer moves native
///         BTC without calling the recipient (implemented with vm.deal). Etch at MEZO_BTC.
contract MezoBTCMock {
    Vm internal constant vm = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    mapping(address => mapping(address => uint256)) public allowance;

    function decimals() external pure returns (uint8) { return 18; }
    function balanceOf(address a) public view returns (uint256) { return a.balance; }

    function transfer(address to, uint256 v) external returns (bool) { _move(msg.sender, to, v); return true; }

    function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; return true; }

    function transferFrom(address f, address t, uint256 v) external returns (bool) {
        uint256 a = allowance[f][msg.sender];
        require(a >= v, "allowance");
        if (a != type(uint256).max) allowance[f][msg.sender] = a - v;
        _move(f, t, v);
        return true;
    }

    function _move(address f, address t, uint256 v) internal {
        require(f.balance >= v, "balance");
        vm.deal(f, f.balance - v);
        vm.deal(t, t.balance + v);
    }
}

contract MockERC20 {
    string public symbol;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;
    constructor(string memory s) { symbol = s; }
    function mint(address to, uint256 v) external { balanceOf[to] += v; totalSupply += v; }
    function approve(address s, uint256 v) external returns (bool) { allowance[msg.sender][s] = v; return true; }
    function transfer(address t, uint256 v) external returns (bool) { balanceOf[msg.sender] -= v; balanceOf[t] += v; return true; }
    function transferFrom(address f, address t, uint256 v) external returns (bool) {
        allowance[f][msg.sender] -= v; balanceOf[f] -= v; balanceOf[t] += v; return true;
    }
}

contract MockVoter {
    IVeBTCAdmin public ve;
    mapping(uint256 => uint256) public lastVoted;
    bool public resetReverts;
    function setVe(address v) external { ve = IVeBTCAdmin(v); }
    function setResetReverts(bool b) external { resetReverts = b; }
    function vote(uint256 id) external {
        require(ve.isApprovedOrOwner(msg.sender, id), "NotApprovedOrOwner");
        lastVoted[id] = block.timestamp;
        ve.voting(id, true);
    }
    function reset(uint256 id) external {
        require(!resetReverts, "reset");
        uint256 es = block.timestamp - (block.timestamp % 1 weeks);
        require(es > lastVoted[id], "AlreadyVotedOrDeposited");
        require(block.timestamp > es + 1 hours, "DistributeWindow");
        require(ve.isApprovedOrOwner(msg.sender, id), "NotApprovedOrOwner");
        ve.voting(id, false);
    }
}

interface IVeBTCAdmin {
    function isApprovedOrOwner(address, uint256) external view returns (bool);
    function voting(uint256, bool) external;
}

/// @notice Behavioural model of Mezo veBTC (tigris ve/Escrow.sol): weekly-rounded ends, 30d max,
///         withdraw pays msg.sender, approval cleared on transfer, voted locks cannot withdraw.
contract MockVeBTC {
    uint256 constant WEEK = 1 weeks;
    address public token;
    address public voter;
    uint256 public maxLockTime = 30 days;
    uint256 public tokenId;
    mapping(uint256 => address) public _owner;
    mapping(uint256 => address) public getApproved;
    mapping(address => mapping(address => bool)) public isApprovedForAll;
    mapping(uint256 => IVeBTC.LockedBalance) internal _locked;
    mapping(uint256 => bool) public voted;
    mapping(uint256 => uint8) public escrowType;

    constructor(address t, address v) { token = t; voter = v; }

    function ownerOf(uint256 id) public view returns (address o) { o = _owner[id]; require(o != address(0), "nonexistent"); }
    function locked(uint256 id) external view returns (IVeBTC.LockedBalance memory) { return _locked[id]; }
    function isApprovedOrOwner(address s, uint256 id) public view returns (bool) {
        address o = _owner[id];
        return s == o || getApproved[id] == s || isApprovedForAll[o][s];
    }
    function approve(address s, uint256 id) external { require(isApprovedOrOwner(msg.sender, id)); getApproved[id] = s; }
    function setApprovalForAll(address s, bool b) external { isApprovedForAll[msg.sender][s] = b; }
    function voting(uint256 id, bool b) external { require(msg.sender == voter, "voter"); voted[id] = b; }
    function setPermanent(uint256 id, bool b) external { _locked[id].isPermanent = b; }
    function setEscrowType(uint256 id, uint8 t) external { escrowType[id] = t; }

    function transferFrom(address f, address t, uint256 id) external {
        require(isApprovedOrOwner(msg.sender, id) && _owner[id] == f, "auth");
        _owner[id] = t; delete getApproved[id];
    }

    function createLock(uint256 v, uint256 d) external returns (uint256) { return _create(v, d, msg.sender); }
    function createLockFor(uint256 v, uint256 d, address to) external returns (uint256) { return _create(v, d, to); }

    function _create(uint256 v, uint256 d, address to) internal returns (uint256 id) {
        uint256 end = ((block.timestamp + d) / WEEK) * WEEK;
        require(v > 0, "ZeroAmount");
        require(end > block.timestamp, "LockDurationNotInFuture");
        require(end <= block.timestamp + maxLockTime, "LockDurationTooLong");
        require(IERC20T(token).transferFrom(msg.sender, address(this), v), "tf");
        id = ++tokenId;
        _owner[id] = to;
        _locked[id] = IVeBTC.LockedBalance(int128(int256(v)), end, false);
    }

    function withdraw(uint256 id) external {
        address sender = msg.sender;
        require(isApprovedOrOwner(sender, id), "NotApprovedOrOwner");
        require(!voted[id], "AlreadyVoted");
        require(escrowType[id] == 0, "NotNormalNFT");
        IVeBTC.LockedBalance memory l = _locked[id];
        require(!l.isPermanent, "PermanentLock");
        require(block.timestamp >= l.end, "LockNotExpired");
        delete _owner[id]; delete getApproved[id]; delete _locked[id];
        require(IERC20T(token).transfer(sender, uint256(int256(l.amount))), "t");
    }
}

interface IERC20T {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/// @notice Model of MUSD BorrowerOperationsSignatures.openTroveWithSignature with the exact EIP-712
///         domain ("BorrowerOperationsSignatures","1") and OpenTrove typehash + per-borrower nonce.
contract MockBOS {
    bytes32 public constant OPEN_TROVE_TYPEHASH = keccak256(
        "OpenTrove(uint256 assetAmount,uint256 debtAmount,address borrower,address recipient,uint256 nonce,uint256 deadline)"
    );
    MockERC20 public musd;
    mapping(address => uint256) public getNonce;
    mapping(address => uint256) public troveColl;
    mapping(address => uint256) public troveDebt;
    uint256 public minDebt = 2000e18;
    uint256 public price = 82_000e18;

    constructor(MockERC20 m) { musd = m; }
    function setPrice(uint256 p) external { price = p; }
    uint256 public gasBurn; // emulate SortedTroves walking with bad hints
    function setGasBurn(uint256 g) external { gasBurn = g; }

    function domainSeparator() public view returns (bytes32) {
        return keccak256(abi.encode(
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
            keccak256("BorrowerOperationsSignatures"), keccak256("1"), block.chainid, address(this)));
    }

    function digest(uint256 asset, uint256 debt, address borrower, address recipient, uint256 nonce, uint256 deadline)
        public view returns (bytes32)
    {
        bytes32 sh = keccak256(abi.encodePacked(OPEN_TROVE_TYPEHASH, abi.encode(asset, debt, borrower, recipient), nonce, deadline));
        return keccak256(abi.encodePacked("\x19\x01", domainSeparator(), sh));
    }

    function openTroveWithSignature(uint256 debt, address, address, address borrower, address recipient, bytes calldata sig, uint256 deadline)
        external payable
    {
        require(block.timestamp <= deadline, "Signature expired");
        uint256 stop = gasleft() > gasBurn ? gasleft() - gasBurn : 0;
        while (gasleft() > stop) {}
        bytes32 d = digest(msg.value, debt, borrower, recipient, getNonce[borrower], deadline);
        require(sig.length == 65, "siglen");
        bytes32 r = bytes32(sig[0:32]); bytes32 s = bytes32(sig[32:64]); uint8 v = uint8(sig[64]);
        require(ecrecover(d, v, r, s) == borrower, "BorrowerOperationsSignatures: Invalid signature");
        getNonce[borrower]++;
        require(troveDebt[borrower] == 0, "trove exists");
        require(debt >= minDebt, "min debt");
        require(msg.value * price / 1e18 * 100 >= debt * 110, "ICR < MCR");
        troveColl[borrower] = msg.value;
        troveDebt[borrower] = debt;
        musd.mint(recipient, debt);
    }
}

contract MockSMUSD {
    MockERC20 public musd;
    mapping(address => uint256) public balanceOf;
    bool public reverts;
    constructor(MockERC20 m) { musd = m; }
    function setReverts(bool b) external { reverts = b; }
    function deposit(uint256 a) external { require(!reverts, "paused"); musd.transferFrom(msg.sender, address(this), a); balanceOf[msg.sender] += a; }
    function transfer(address t, uint256 v) external returns (bool) { balanceOf[msg.sender] -= v; balanceOf[t] += v; return true; }
}
