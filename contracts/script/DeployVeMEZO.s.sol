// SPDX-License-Identifier: Apache-2.0
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {LockwatchVault} from "../src/LockwatchVault.sol";
import {IVeBTC, IBorrowerOperationsSignatures, IERC20Min, ISavingsMUSD} from "../src/interfaces/IMezo.sol";

/// veMEZO instance of LockwatchVault: no MUSD wiring (RETURN/RELOCK only), 4-year max lock.
/// forge script script/DeployVeMEZO.s.sol --rpc-url mezo_testnet --broadcast
contract DeployVeMEZO is Script {
    function run() external returns (LockwatchVault v) {
        address ve = block.chainid == 31612
            ? 0xb90fdAd3DFD180458D62Cc6acedc983D78E20122
            : 0xaCE816CA2bcc9b12C59799dcC5A959Fb9b98111b;
        vm.startBroadcast();
        v = new LockwatchVault(
            IVeBTC(ve), IBorrowerOperationsSignatures(address(0)), IERC20Min(address(0)), ISavingsMUSD(address(0)), 4 * 365 days
        );
        vm.stopBroadcast();
        console2.log("LockwatchVault(veMEZO)", address(v));
    }
}
