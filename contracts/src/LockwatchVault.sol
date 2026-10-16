// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20Min, IVeBTC, IVoter, IBorrowerOperationsSignatures, ISavingsMUSD} from "./interfaces/IMezo.sol";

/// @title LockwatchVault (v2)
/// @notice v2 adds auto-extend (keeper calls veBTC.increaseUnlockTime as the approved operator so voting
///         power never lapses) and reward auto-claim (keeper calls Voter.claimBribes/claimFees for registered
///         gauges; the reward contracts pay `ownerOf(tokenId)` directly, so the vault never touches rewards).
/// @notice Permissionless auto-protection for expired vote-escrow locks on Mezo (veBTC and veMEZO).
///         One instance per escrow: the veMEZO instance is deployed with bos/musd/smusd = 0, so only RETURN
///         (MEZO back to the owner) and RELOCK are available; `btc` then holds the MEZO token (ve.token()).
///         A lock owner approves this contract on one tokenId and records what should happen at expiry.
///         After expiry anyone (a keeper) can call `protect`, which clears votes, withdraws the BTC and
///         immediately returns it to the owner, re-locks it in the owner's name, or opens an MUSD trove
///         owned by the owner (optionally depositing the MUSD into sMUSD for the owner).
/// @dev Security model:
///      - No owner, no admin, no proxy, no upgrade, no arbitrary call, no `to` parameter.
///      - Uses plain `msg.sender` only. Never trusts Mezo's ERC-2771 forwarder (Oct 5 2026 exploit class).
///      - Funds can only ever go to `prefs[id].owner`, which must equal `veBTC.ownerOf(id)` at protect time.
///      - The vault ends every transaction holding zero BTC, MUSD and sMUSD.
///      - If any mode-specific step fails, the BTC is returned to the owner (fail-safe RETURN).
///      - Storage-based reentrancy guard (EVM london: no transient storage).
contract LockwatchVault {
    enum Mode {
        RETURN, // send BTC back to the owner
        RELOCK, // createLockFor(owner) with `relockDuration`
        MUSD, // open a trove owned by owner, MUSD to owner (EIP-712 signed by owner)
        MUSD_SAVINGS // open a trove owned by owner, MUSD -> sMUSD -> owner
    }

    struct Pref {
        address owner;
        Mode mode;
        uint32 relockDuration; // seconds, RELOCK only
        uint64 deadline; // EIP-712 signature deadline, MUSD modes only
        uint256 debt; // MUSD debt for the trove, MUSD modes only
        bytes sig; // owner's OpenTrove signature for BorrowerOperationsSignatures
    }

    // Fail reasons (for the Fallback event and isProtectable)
    uint8 internal constant OK = 0;
    uint8 internal constant NOT_REGISTERED = 1;
    uint8 internal constant STALE_OWNER = 2;
    uint8 internal constant NOT_EXPIRED = 3;
    uint8 internal constant PERMANENT = 4;
    uint8 internal constant NOT_APPROVED = 5;
    uint8 internal constant VOTE_RESET_BLOCKED = 6;
    uint8 internal constant NOT_NORMAL = 7;

    IVeBTC public immutable ve;
    IVoter public immutable voter;
    IERC20Min public immutable btc; // Mezo BTC ERC-20 precompile (0x7b7C…): balance == native balance
    IBorrowerOperationsSignatures public immutable bos;
    IERC20Min public immutable musd;
    ISavingsMUSD public immutable smusd; // address(0) disables MUSD_SAVINGS

    /// @notice Auto-extend policy. When `end - now <= triggerWithin`, anyone may call `extend`, which sets the
    ///         lock end to floor((now + duration) / week) * week via increaseUnlockTime. duration 0 = maxLock.
    struct ExtendPolicy {
        address owner;
        uint32 triggerWithin; // seconds before expiry that the extension may run
        uint32 duration; // seconds; 0 = keep at maximum
    }

    uint256 internal constant WEEK = 1 weeks;
    uint8 internal constant TOO_EARLY = 8;
    uint8 internal constant ALREADY_EXPIRED = 9;
    uint8 internal constant NO_GAIN = 10;

    uint256 public immutable maxLock; // veBTC maxLockTime (not exposed by veBTC; set at deploy)

    mapping(uint256 => Pref) internal _prefs;
    mapping(uint256 => ExtendPolicy) internal _extend;
    mapping(uint256 => address) public rewardsOwner; // opted-in owner for reward auto-claim
    uint256 private _lock = 1;

    event Registered(uint256 indexed tokenId, address indexed owner, Mode mode);
    event Unregistered(uint256 indexed tokenId, address indexed owner);
    event Protected(uint256 indexed tokenId, address indexed owner, Mode mode, uint256 amount, uint256 newLockId);
    event Fallback(uint256 indexed tokenId, address indexed owner, Mode requested, bytes reason);
    event ExtendSet(uint256 indexed tokenId, address indexed owner, uint32 triggerWithin, uint32 duration);
    event ExtendCleared(uint256 indexed tokenId, address indexed owner);
    event Extended(uint256 indexed tokenId, address indexed owner, uint256 oldEnd, uint256 newEnd);
    event RewardsAutoSet(uint256 indexed tokenId, address indexed owner, bool enabled);
    event RewardsClaimed(uint256 indexed tokenId, address indexed owner, uint256 gauges);

    error Reentrancy();
    error NotLockOwner();
    error NotRegistered();
    error NotProtectable(uint8 reason);
    error InvalidPref();
    error TransferFailed();
    error LengthMismatch();
    error OnlySelf();
    error InsufficientGas();
    error NotExtendable(uint8 reason);
    error NotGauge(address gauge);
    error RewardsNotEnabled();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(
        IVeBTC ve_,
        IBorrowerOperationsSignatures bos_,
        IERC20Min musd_,
        ISavingsMUSD smusd_,
        uint256 maxLock_
    ) {
        maxLock = maxLock_;
        ve = ve_;
        voter = IVoter(ve_.voter());
        btc = IERC20Min(ve_.token());
        bos = bos_;
        musd = musd_;
        smusd = smusd_;
    }

    /// @notice Accept BTC only from the protocol contracts during a protect flow.
    receive() external payable {
        if (_lock != 2) revert Reentrancy();
    }

    // ---------------------------------------------------------------- owner actions

    /// @notice Register (or overwrite) protection for `tokenId`. Caller must own the lock.
    ///         Also call `veBTC.approve(vault, tokenId)` (order does not matter).
    function register(uint256 tokenId, Pref calldata p) external {
        if (ve.ownerOf(tokenId) != msg.sender) revert NotLockOwner();
        _validate(p);
        Pref storage s = _prefs[tokenId];
        s.owner = msg.sender;
        s.mode = p.mode;
        s.relockDuration = p.relockDuration;
        s.deadline = p.deadline;
        s.debt = p.debt;
        s.sig = p.sig;
        emit Registered(tokenId, msg.sender, p.mode);
    }

    function unregister(uint256 tokenId) external {
        address o = _prefs[tokenId].owner;
        if (o == address(0)) revert NotRegistered();
        // registered owner or current NFT owner may clear it
        if (msg.sender != o && msg.sender != _ownerOrZero(tokenId)) revert NotLockOwner();
        delete _prefs[tokenId];
        emit Unregistered(tokenId, o);
    }

    /// @notice Set auto-extend for `tokenId`. Caller must own the lock and approve the vault on it.
    function setExtendPolicy(uint256 tokenId, uint32 triggerWithin, uint32 duration) external {
        if (ve.ownerOf(tokenId) != msg.sender) revert NotLockOwner();
        if (triggerWithin == 0 || triggerWithin > maxLock || duration > maxLock) revert InvalidPref();
        if (duration != 0 && duration < WEEK) revert InvalidPref();
        _extend[tokenId] = ExtendPolicy(msg.sender, triggerWithin, duration);
        emit ExtendSet(tokenId, msg.sender, triggerWithin, duration);
    }

    function clearExtendPolicy(uint256 tokenId) external {
        address o = _extend[tokenId].owner;
        if (o == address(0)) revert NotRegistered();
        if (msg.sender != o && msg.sender != _ownerOrZero(tokenId)) revert NotLockOwner();
        delete _extend[tokenId];
        emit ExtendCleared(tokenId, o);
    }

    /// @notice Opt `tokenId` in/out of reward auto-claim. Rewards always go to the lock owner.
    function setRewardsAuto(uint256 tokenId, bool enabled) external {
        if (ve.ownerOf(tokenId) != msg.sender) revert NotLockOwner();
        rewardsOwner[tokenId] = enabled ? msg.sender : address(0);
        emit RewardsAutoSet(tokenId, msg.sender, enabled);
    }

    // ---------------------------------------------------------------- keeper actions

    /// @notice Permissionless. Extends a lock per its owner's policy. Moves no funds.
    function extend(uint256 tokenId) external nonReentrant returns (uint256 newEnd) {
        (bool can, uint8 why, uint256 end, uint256 target) = _extendCheck(tokenId);
        if (!can) revert NotExtendable(why);
        ExtendPolicy memory e = _extend[tokenId];
        ve.increaseUnlockTime(tokenId, e.duration == 0 ? maxLock : e.duration);
        newEnd = ve.locked(tokenId).end;
        assert(newEnd == target);
        emit Extended(tokenId, e.owner, end, newEnd);
    }

    /// @notice Permissionless. Claims bribe and fee rewards for registered Voter gauges. Mezo's reward
    ///         contracts pay `veBTC.ownerOf(tokenId)` directly; the vault only acts as the approved caller.
    function claimRewards(
        uint256 tokenId,
        address[] calldata gauges,
        address[][] calldata bribeTokens,
        address[][] calldata feeTokens
    ) external nonReentrant {
        address o = rewardsOwner[tokenId];
        if (o == address(0) || o != _ownerOrZero(tokenId)) revert RewardsNotEnabled();
        if (ve.getApproved(tokenId) != address(this) && !ve.isApprovedForAll(o, address(this))) {
            revert NotProtectable(NOT_APPROVED);
        }
        uint256 n = gauges.length;
        if (bribeTokens.length != n || feeTokens.length != n) revert LengthMismatch();
        address[] memory bribes = new address[](n);
        bool anyFees;
        for (uint256 i; i < n; ++i) {
            if (!voter.isGauge(gauges[i])) revert NotGauge(gauges[i]);
            bribes[i] = voter.gaugeToBribe(gauges[i]);
            if (feeTokens[i].length != 0) anyFees = true;
        }
        voter.claimBribes(bribes, bribeTokens, tokenId);
        // veMEZO's BoostVoter has bribes only (no gaugeToFees/claimFees): keepers pass empty fee token lists.
        if (anyFees) _claimFees(tokenId, gauges, feeTokens);
        emit RewardsClaimed(tokenId, o, n);
    }

    /// @notice Permissionless. Protects an expired, registered, approved lock.
    /// @param upperHint lowerHint SortedTroves insert hints for MUSD modes (untrusted; only affect gas).
    function protect(uint256 tokenId, address upperHint, address lowerHint)
        external
        nonReentrant
        returns (uint256 amount, uint256 newLockId)
    {
        return _protect(tokenId, upperHint, lowerHint);
    }

    /// @notice Protect many ids; a failing id never blocks the others.
    function protectBatch(uint256[] calldata ids, address[] calldata uppers, address[] calldata lowers)
        external
        returns (bool[] memory ok)
    {
        if (ids.length != uppers.length || ids.length != lowers.length) revert LengthMismatch();
        ok = new bool[](ids.length);
        for (uint256 i; i < ids.length; ++i) {
            try this.protectOne(ids[i], uppers[i], lowers[i]) {
                ok[i] = true;
            } catch {}
        }
    }

    /// @dev External hop so protectBatch can try/catch per id. Only callable by this contract.
    function protectOne(uint256 tokenId, address upperHint, address lowerHint) external nonReentrant {
        if (msg.sender != address(this)) revert OnlySelf();
        _protect(tokenId, upperHint, lowerHint);
    }

    // ---------------------------------------------------------------- views

    function prefs(uint256 tokenId) external view returns (Pref memory) {
        return _prefs[tokenId];
    }

    /// @notice Keeper helper. Returns (true, 0) when `protect` should succeed now.
    function isProtectable(uint256 tokenId) public view returns (bool, uint8) {
        Pref storage p = _prefs[tokenId];
        if (p.owner == address(0)) return (false, NOT_REGISTERED);
        address cur = _ownerOrZero(tokenId);
        if (cur != p.owner) return (false, STALE_OWNER);
        if (ve.escrowType(tokenId) != 0) return (false, NOT_NORMAL);
        IVeBTC.LockedBalance memory l = ve.locked(tokenId);
        if (l.isPermanent) return (false, PERMANENT);
        if (block.timestamp < l.end) return (false, NOT_EXPIRED);
        if (ve.getApproved(tokenId) != address(this) && !ve.isApprovedForAll(cur, address(this))) {
            return (false, NOT_APPROVED);
        }
        if (ve.voted(tokenId) && !_resetWindowOpen(tokenId)) return (false, VOTE_RESET_BLOCKED);
        return (true, OK);
    }

    function extendPolicy(uint256 tokenId) external view returns (ExtendPolicy memory) {
        return _extend[tokenId];
    }

    /// @notice Keeper helper for auto-extend: (ok, reason, current end, end after extend).
    function canExtend(uint256 tokenId) external view returns (bool, uint8, uint256, uint256) {
        return _extendCheck(tokenId);
    }

    // ---------------------------------------------------------------- internals

    function _extendCheck(uint256 tokenId) internal view returns (bool, uint8, uint256 end, uint256 target) {
        ExtendPolicy memory e = _extend[tokenId];
        if (e.owner == address(0)) return (false, NOT_REGISTERED, 0, 0);
        address cur = _ownerOrZero(tokenId);
        if (cur != e.owner) return (false, STALE_OWNER, 0, 0);
        if (ve.escrowType(tokenId) != 0) return (false, NOT_NORMAL, 0, 0);
        IVeBTC.LockedBalance memory l = ve.locked(tokenId);
        end = l.end;
        if (l.isPermanent) return (false, PERMANENT, end, 0);
        if (block.timestamp >= end) return (false, ALREADY_EXPIRED, end, 0);
        if (ve.getApproved(tokenId) != address(this) && !ve.isApprovedForAll(cur, address(this))) {
            return (false, NOT_APPROVED, end, 0);
        }
        if (end - block.timestamp > e.triggerWithin) return (false, TOO_EARLY, end, 0);
        target = ((block.timestamp + (e.duration == 0 ? maxLock : e.duration)) / WEEK) * WEEK;
        if (target <= end) return (false, NO_GAIN, end, target);
        return (true, OK, end, target);
    }

    function _claimFees(uint256 tokenId, address[] calldata gauges, address[][] calldata feeTokens) internal {
        address[] memory fees = new address[](gauges.length);
        for (uint256 i; i < gauges.length; ++i) {
            fees[i] = voter.gaugeToFees(gauges[i]);
        }
        voter.claimFees(fees, feeTokens, tokenId);
    }

    function _protect(uint256 tokenId, address upperHint, address lowerHint)
        internal
        returns (uint256 amount, uint256 newLockId)
    {
        (bool can, uint8 why) = isProtectable(tokenId);
        if (!can) revert NotProtectable(why);

        Pref memory p = _prefs[tokenId];
        delete _prefs[tokenId]; // effects before interactions
        delete _extend[tokenId];
        delete rewardsOwner[tokenId];

        if (ve.voted(tokenId)) voter.reset(tokenId);

        uint256 before = btc.balanceOf(address(this));
        ve.withdraw(tokenId);
        amount = btc.balanceOf(address(this)) - before;

        if (p.mode == Mode.RELOCK) {
            newLockId = _relock(tokenId, p, amount);
        } else if (p.mode == Mode.MUSD || p.mode == Mode.MUSD_SAVINGS) {
            _openTrove(tokenId, p, amount, upperHint, lowerHint);
        } else {
            _sendBtc(p.owner, amount);
        }

        emit Protected(tokenId, p.owner, p.mode, amount, newLockId);
    }

    function _relock(uint256 tokenId, Pref memory p, uint256 amount) internal returns (uint256 newId) {
        btc.approve(address(ve), amount);
        uint256 g = gasleft();
        try ve.createLockFor(amount, p.relockDuration, p.owner) returns (uint256 id) {
            newId = id;
        } catch (bytes memory reason) {
            _revertIfStarved(g);
            btc.approve(address(ve), 0);
            emit Fallback(tokenId, p.owner, p.mode, reason);
            _sendBtc(p.owner, amount);
        }
    }

    function _openTrove(uint256 tokenId, Pref memory p, uint256 amount, address upper, address lower) internal {
        bool savings = p.mode == Mode.MUSD_SAVINGS;
        uint256 musd0 = savings ? musd.balanceOf(address(this)) : 0;
        (bool ok, bytes memory reason) = _tryOpen(p, amount, upper, lower, savings ? address(this) : p.owner);
        if (ok) {
            if (savings) _toSavings(tokenId, p, musd.balanceOf(address(this)) - musd0);
        } else {
            emit Fallback(tokenId, p.owner, p.mode, reason);
            _sendBtc(p.owner, amount);
        }
    }

    function _tryOpen(Pref memory p, uint256 amount, address upper, address lower, address recipient)
        internal
        returns (bool ok, bytes memory reason)
    {
        bytes memory data = abi.encodeCall(
            IBorrowerOperationsSignatures.openTroveWithSignature,
            (p.debt, upper, lower, p.owner, recipient, p.sig, p.deadline)
        );
        uint256 g = gasleft();
        // Triage: `bos` is the immutable Mezo BorrowerOperationsSignatures set in the constructor, not a
        // user-chosen address; `amount` is the owner's own released lock BTC, opened as their trove's collateral.
        // slither-disable-next-line arbitrary-send-eth,low-level-calls
        (ok, reason) = address(bos).call{value: amount}(data);
        if (!ok) _revertIfStarved(g);
    }

    function _toSavings(uint256 tokenId, Pref memory p, uint256 musdAmount) internal {
        uint256 s0 = smusd.balanceOf(address(this));
        musd.approve(address(smusd), musdAmount);
        uint256 g = gasleft();
        try smusd.deposit(musdAmount) {
            uint256 shares = smusd.balanceOf(address(this)) - s0;
            if (!smusd.transfer(p.owner, shares)) revert TransferFailed();
        } catch (bytes memory reason) {
            _revertIfStarved(g);
            musd.approve(address(smusd), 0);
            emit Fallback(tokenId, p.owner, p.mode, reason);
            if (!musd.transfer(p.owner, musdAmount)) revert TransferFailed();
        }
    }

    /// @dev Anti-griefing: a permissionless caller could pick a gas limit that makes the inner call run out
    ///      of gas while leaving enough (the 1/64 retained by EIP-150) for the RETURN fallback, downgrading the
    ///      owner's chosen mode. If the failed call burned (nearly) all gas forwarded to it, revert the whole tx
    ///      instead so the keeper retries with enough gas.
    function _revertIfStarved(uint256 gasBefore) internal view {
        if (gasleft() <= gasBefore / 63) revert InsufficientGas();
    }

    /// @dev Pays via the BTC ERC-20 precompile: on Mezo this moves native BTC without invoking the
    ///      recipient's code, so contract owners that reject plain value transfers still get paid.
    function _sendBtc(address to, uint256 amount) internal {
        if (amount == 0) return;
        if (!btc.transfer(to, amount)) revert TransferFailed();
    }

    function _validate(Pref calldata p) internal view {
        if (p.mode == Mode.RELOCK) {
            if (p.relockDuration == 0) revert InvalidPref();
        } else if (p.mode == Mode.MUSD || p.mode == Mode.MUSD_SAVINGS) {
            if (address(bos) == address(0)) revert InvalidPref(); // veMEZO instance: no MUSD flows
            if (p.debt == 0 || p.sig.length == 0 || p.deadline <= block.timestamp) revert InvalidPref();
            if (p.mode == Mode.MUSD_SAVINGS && address(smusd) == address(0)) revert InvalidPref();
        }
    }

    function _ownerOrZero(uint256 tokenId) internal view returns (address o) {
        try ve.ownerOf(tokenId) returns (address a) {
            o = a;
        } catch {}
    }

    /// @dev Mirrors Voter.onlyNewEpoch: reset needs a new epoch since lastVoted and the
    ///      1h distribute window after the Thursday 00:00 UTC epoch flip to have passed.
    function _resetWindowOpen(uint256 tokenId) internal view returns (bool) {
        // Triage: modulo here is epoch arithmetic (round down to Thursday 00:00 UTC), not randomness.
        // slither-disable-next-line weak-prng
        uint256 epochStart = block.timestamp - (block.timestamp % 1 weeks);
        if (epochStart <= voter.lastVoted(tokenId)) return false;
        return block.timestamp > epochStart + 1 hours;
    }
}
