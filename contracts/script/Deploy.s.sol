// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {LockwatchVault} from "../src/LockwatchVault.sol";
import {LockwatchRescue} from "../src/LockwatchRescue.sol";
import {ITroveManager, IPriceFeed} from "../src/interfaces/IMezo.sol";
import {IVeBTC, IBorrowerOperationsSignatures, IERC20Min, ISavingsMUSD} from "../src/interfaces/IMezo.sol";

/// forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast  (needs a funded DEPLOYER key)
contract Deploy is Script {
    function run() external returns (LockwatchVault v, LockwatchRescue r) {
        (address ve, address bos, address musd, address smusd) = block.chainid == 31612
            ? (
                0x7D807e9CE1ef73048FEe9A4214e75e894ea25914,
                vm.envAddress("MAINNET_BOS"), // not in musd repo deployments yet; set explicitly
                0xdD468A1DDc392dcdbEf6db6e34E89AA338F9F186,
                0xb4D498029af77680cD1eF828b967f010d06C51CC // sMUSD "MUSD Savings Rate"
            )
            : (
                0xB63fcCd03521Cf21907627bd7fA465C129479231,
                0xD757e3646AF370b15f32EB557F0F8380Df7D639e,
                0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503,
                vm.envOr("TESTNET_SMUSD", address(0)) // no sMUSD on testnet yet
            );
        vm.startBroadcast();
        v = new LockwatchVault(IVeBTC(ve), IBorrowerOperationsSignatures(bos), IERC20Min(musd), ISavingsMUSD(smusd), vm.envOr("MAX_LOCK", uint256(30 days)));
        if (block.chainid == 31611) {
            // testnet MUSD: TroveManager / PriceFeed read from BorrowerOperations
            r = new LockwatchRescue(
                IBorrowerOperationsSignatures(bos),
                ITroveManager(0xE47c80e8c23f6B4A1aE41c34837a0599D5D16bb0),
                IPriceFeed(0x86bCF0841622a5dAC14A313a15f96A95421b9366),
                IERC20Min(0x7b7C000000000000000000000000000000000000),
                IERC20Min(musd)
            );
        }
        vm.stopBroadcast();
        console2.log("LockwatchVault", address(v));
        console2.log("LockwatchRescue", address(r));
    }
}
