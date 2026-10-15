// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {LockwatchVault} from "../src/LockwatchVault.sol";
import {IVeBTC, IBorrowerOperationsSignatures, IERC20Min, ISavingsMUSD} from "../src/interfaces/IMezo.sol";

/// forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast  (needs a funded DEPLOYER key)
contract Deploy is Script {
    function run() external returns (LockwatchVault v) {
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
        v = new LockwatchVault(IVeBTC(ve), IBorrowerOperationsSignatures(bos), IERC20Min(musd), ISavingsMUSD(smusd));
        vm.stopBroadcast();
        console2.log("LockwatchVault", address(v));
    }
}
