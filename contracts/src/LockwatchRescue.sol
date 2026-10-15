// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {IERC20Min, IERC20From, IBorrowerOperationsSignatures, ITroveManager, IPriceFeed} from "./interfaces/IMezo.sol";

/// @title LockwatchRescue
/// @notice Opt-in loan rescue for MUSD borrowers. A borrower escrows BTC and/or MUSD here, sets a trigger ICR,
///         and pre-signs ONE MUSD `AddColl` and/or `RepayMUSD` EIP-712 permission for a fixed amount at their
///         current BorrowerOperationsSignatures nonce. When their trove's ICR falls below the trigger, anyone
///         (the Lockwatch keeper) may call `rescue`, which forwards the escrowed amount into the borrower's own
///         trove via addCollWithSignature / repayMUSDWithSignature.
/// @dev Safety:
///      - No owner, admin, upgrade, arbitrary call or `to` parameter. Plain msg.sender only.
///      - Escrowed funds can only (a) enter `borrower`'s own trove (MUSD binds the trove to the signer) or
///        (b) be withdrawn by the borrower to themselves.
///      - Each signature is single-use and nonce-bounded: any other signed action by the borrower bumps the
///        MUSD nonce and invalidates it; the borrower can also revoke at any time.
///      - Trigger is checked on-chain against TroveManager.getCurrentICR, so nobody can force an unneeded top-up.
///      - Invariant: BTC balance == sum(btcOf), MUSD balance >= sum(musdOf).
contract LockwatchRescue {
    struct Rule {
        uint64 triggerIcr; // 1e18 = 100%; rescue allowed when ICR < triggerIcr
        uint64 deadline; // signature deadline
        uint128 addAmount; // BTC to add (must equal the signed AddColl assetAmount)
        uint128 repayAmount; // MUSD to repay (must equal the signed RepayMUSD amount)
        bytes addSig;
        bytes repaySig;
    }

    IBorrowerOperationsSignatures public immutable bos;
    ITroveManager public immutable troveManager;
    IPriceFeed public immutable priceFeed;
    IERC20Min public immutable btc; // Mezo BTC precompile (balance == native balance)
    IERC20Min public immutable musd;

    mapping(address => uint256) public btcOf;
    mapping(address => uint256) public musdOf;
    mapping(address => Rule) internal _rules;
    uint256 public totalBtc;
    uint256 public totalMusd;
    uint256 private _lock = 1;

    uint256 internal constant TROVE_ACTIVE = 1;

    event Deposited(address indexed borrower, uint256 btc, uint256 musd);
    event Withdrawn(address indexed borrower, uint256 btc, uint256 musd);
    event RuleSet(address indexed borrower, uint64 triggerIcr, uint128 addAmount, uint128 repayAmount, uint64 deadline);
    event RuleCleared(address indexed borrower);
    event Rescued(address indexed borrower, address indexed caller, uint256 icrBefore, uint256 btcAdded, uint256 musdRepaid);

    error Reentrancy();
    error InvalidRule();
    error NotTriggered(uint256 icr);
    error NothingToDo();
    error TroveNotActive();
    error TransferFailed();

    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    constructor(IBorrowerOperationsSignatures bos_, ITroveManager tm_, IPriceFeed pf_, IERC20Min btc_, IERC20Min musd_) {
        bos = bos_;
        troveManager = tm_;
        priceFeed = pf_;
        btc = btc_;
        musd = musd_;
    }

    /// @notice Escrow BTC for your own rescue.
    function depositBtc() external payable nonReentrant {
        btcOf[msg.sender] += msg.value;
        totalBtc += msg.value;
        emit Deposited(msg.sender, msg.value, 0);
    }

    /// @notice Escrow MUSD for your own rescue (approve first).
    function depositMusd(uint256 amount) external nonReentrant {
        uint256 b0 = musd.balanceOf(address(this));
        if (!IERC20From(address(musd)).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        uint256 got = musd.balanceOf(address(this)) - b0;
        musdOf[msg.sender] += got;
        totalMusd += got;
        emit Deposited(msg.sender, 0, got);
    }

    /// @notice Withdraw any of your escrow, any time. Always pays msg.sender.
    function withdraw(uint256 btcAmount, uint256 musdAmount) external nonReentrant {
        btcOf[msg.sender] -= btcAmount;
        musdOf[msg.sender] -= musdAmount;
        totalBtc -= btcAmount;
        totalMusd -= musdAmount;
        if (btcAmount != 0 && !btc.transfer(msg.sender, btcAmount)) revert TransferFailed();
        if (musdAmount != 0 && !musd.transfer(msg.sender, musdAmount)) revert TransferFailed();
        emit Withdrawn(msg.sender, btcAmount, musdAmount);
    }

    function setRule(Rule calldata r) external {
        if (r.triggerIcr < 1.1e18 || r.triggerIcr > 10e18) revert InvalidRule(); // MCR is 110%
        if (r.deadline <= block.timestamp) revert InvalidRule();
        if (r.addAmount == 0 && r.repayAmount == 0) revert InvalidRule();
        if ((r.addAmount != 0) != (r.addSig.length != 0)) revert InvalidRule();
        if ((r.repayAmount != 0) != (r.repaySig.length != 0)) revert InvalidRule();
        _rules[msg.sender] = r;
        emit RuleSet(msg.sender, r.triggerIcr, r.addAmount, r.repayAmount, r.deadline);
    }

    function clearRule() external {
        delete _rules[msg.sender];
        emit RuleCleared(msg.sender);
    }

    function rules(address borrower) external view returns (Rule memory) {
        return _rules[borrower];
    }

    /// @notice Keeper helper: (canRescue, current ICR, btc that would be added, musd that would be repaid).
    function check(address borrower) public view returns (bool, uint256 icr, uint256 addBtc, uint256 repay) {
        Rule storage r = _rules[borrower];
        if (r.triggerIcr == 0 || block.timestamp > r.deadline) return (false, 0, 0, 0);
        if (troveManager.getTroveStatus(borrower) != TROVE_ACTIVE) return (false, 0, 0, 0);
        icr = troveManager.getCurrentICR(borrower, priceFeed.fetchPrice());
        if (r.addAmount != 0 && btcOf[borrower] >= r.addAmount) addBtc = r.addAmount;
        if (r.repayAmount != 0 && musdOf[borrower] >= r.repayAmount) repay = r.repayAmount;
        return (icr < r.triggerIcr && (addBtc != 0 || repay != 0), icr, addBtc, repay);
    }

    /// @notice Permissionless. Tops up / repays `borrower`'s own trove when it is below their trigger ICR.
    ///         Uses each available pre-signed permission once; the MUSD nonce makes order matter, so the
    ///         borrower signs AddColl at nonce n and RepayMUSD at nonce n+1 (the UI does this).
    function rescue(address borrower, address upperHint, address lowerHint) external nonReentrant {
        Rule storage s = _rules[borrower];
        uint256 trig = s.triggerIcr;
        if (trig == 0) revert NothingToDo();
        if (troveManager.getTroveStatus(borrower) != TROVE_ACTIVE) revert TroveNotActive();
        uint256 icr = troveManager.getCurrentICR(borrower, priceFeed.fetchPrice());
        if (icr >= trig) revert NotTriggered(icr);

        // Checks-effects-interactions: consume every permission and settle all accounting
        // (including deleting a fully spent rule) BEFORE any value-moving call to BorrowerOperations.
        Exec memory x;
        x.deadline = s.deadline;
        (x.added, x.addSig) = _takeAdd(s, borrower);
        (x.repaid, x.repaySig) = _takeRepay(s, borrower);
        if (x.added == 0 && x.repaid == 0) revert NothingToDo();
        if (s.addAmount == 0 && s.repayAmount == 0) delete _rules[borrower];
        emit Rescued(borrower, msg.sender, icr, x.added, x.repaid);
        _execute(x, borrower, upperHint, lowerHint);
    }

    struct Exec {
        uint256 added;
        uint256 repaid;
        uint256 deadline;
        bytes addSig;
        bytes repaySig;
    }

    /// @dev Effects only: debits the borrower's BTC escrow and burns the one-shot AddColl permission.
    function _takeAdd(Rule storage s, address borrower) internal returns (uint256 added, bytes memory sig) {
        added = s.addAmount;
        if (added == 0 || btcOf[borrower] < added) return (0, sig);
        sig = s.addSig;
        btcOf[borrower] -= added;
        totalBtc -= added;
        s.addAmount = 0;
        delete s.addSig;
    }

    /// @dev Effects only: debits the borrower's MUSD escrow and burns the one-shot RepayMUSD permission.
    function _takeRepay(Rule storage s, address borrower) internal returns (uint256 repaid, bytes memory sig) {
        repaid = s.repayAmount;
        if (repaid == 0 || musdOf[borrower] < repaid) return (0, sig);
        sig = s.repaySig;
        musdOf[borrower] -= repaid;
        totalMusd -= repaid;
        s.repayAmount = 0;
        delete s.repaySig;
    }

    /// @dev Interactions only, after all state is final.
    function _execute(Exec memory x, address borrower, address upper, address lower) internal {
        if (x.added != 0) bos.addCollWithSignature{value: x.added}(upper, lower, borrower, x.addSig, x.deadline);
        if (x.repaid != 0) {
            uint256 m0 = musd.balanceOf(address(this));
            bos.repayMUSDWithSignature(x.repaid, upper, lower, borrower, x.repaySig, x.deadline);
            // MUSD burns exactly `repaid` from this contract (the caller); anything else is a protocol breach.
            // Triage: the before/after delta IS the safety check; rescue() is nonReentrant and all state is
            // already final, so a reentrant balance change can only make this revert, never pass wrongly.
            // slither-disable-next-line reentrancy-balance
            if (m0 - musd.balanceOf(address(this)) != x.repaid) revert TransferFailed();
        }
    }

    /// @notice BTC enters only via depositBtc (payable). Plain transfers are refused.
    receive() external payable {
        revert InvalidRule();
    }
}
