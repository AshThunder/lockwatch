// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Cheatcode-free emulator of Mezo's BTC ERC-20 precompile for anvil forks (scripts/fork-e2e).
///         Credits are REAL native BTC (sent from this contract's float via a self-destructing pusher, so the
///         recipient's code is never invoked, like the precompile). Debits can't be taken from another
///         account's native balance without cheatcodes, so they are tracked in `debit` and subtracted in
///         balanceOf. Net effect: balanceOf(a) == native balance the precompile would report.
contract AnvilMezoBTC {
    mapping(address => uint256) public debit;
    mapping(address => mapping(address => uint256)) public allowance;

    receive() external payable {}
    function decimals() external pure returns (uint8) { return 18; }
    function balanceOf(address a) public view returns (uint256) { uint256 b = a.balance; uint256 d = debit[a]; return b > d ? b - d : 0; }
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
        require(balanceOf(f) >= v, "balance");
        debit[f] += v;
        if (debit[t] >= v) debit[t] -= v; // recipient previously debited: just cancel it
        else { uint256 n = v - debit[t]; debit[t] = 0; new Pusher{value: n}(payable(t)); }
    }
}

contract Pusher { constructor(address payable t) payable { selfdestruct(t); } }

/// @notice Fresh BTC/USD feed at Mezo's oracle precompile (live price passed in at etch time via storage slot 0).
contract AnvilOracle {
    int256 public price;
    function setPrice(int256 p) external { price = p; }
    function decimals() external pure returns (uint8) { return 18; }
    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, price, block.timestamp, block.timestamp, 1);
    }
}
