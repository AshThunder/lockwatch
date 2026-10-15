// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

/// @notice Minimal views of Mezo contracts used by Lockwatch (see mezo-org/tigris, mezo-org/musd).
interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
}

interface IVeBTC {
    struct LockedBalance {
        int128 amount;
        uint256 end;
        bool isPermanent;
    }

    function token() external view returns (address);
    function voter() external view returns (address);
    function ownerOf(uint256 tokenId) external view returns (address);
    function getApproved(uint256 tokenId) external view returns (address);
    function isApprovedForAll(address owner, address operator) external view returns (bool);
    function locked(uint256 tokenId) external view returns (LockedBalance memory);
    function voted(uint256 tokenId) external view returns (bool);
    function escrowType(uint256 tokenId) external view returns (uint8);
    function withdraw(uint256 tokenId) external;
    function createLockFor(uint256 value, uint256 lockDuration, address to) external returns (uint256);
}

interface IVoter {
    function reset(uint256 tokenId) external;
    function lastVoted(uint256 tokenId) external view returns (uint256);
}

interface IBorrowerOperationsSignatures {
    function openTroveWithSignature(
        uint256 debtAmount,
        address upperHint,
        address lowerHint,
        address borrower,
        address recipient,
        bytes calldata signature,
        uint256 deadline
    ) external payable;

    function getNonce(address user) external view returns (uint256);
}

/// @notice Mezo "MUSD Savings Rate" (sMUSD). deposit() mints to msg.sender; shares are a plain ERC-20.
interface ISavingsMUSD {
    function deposit(uint256 amount) external;
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
}
