// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {KeyringGateway} from "../src/KeyringGateway.sol";
import {KMSAdapter} from "../src/adapters/KMSAdapter.sol";
import {KeyringDeleGateModule} from "../src/KeyringDeleGateModule.sol";
import {DeleGate} from "../src/DeleGate.sol";
import {LLMAdapter} from "../src/adapters/LLMAdapter.sol";

contract DeployKMSAdapter is Script {
    function run(address keyringGateway, address delegateContract) public returns (address) {
        // Pull values from environment variables
        uint256 privateKey = vm.envUint("PRIVATE_KEY");

        vm.startBroadcast(privateKey);
        // Deploy KMSAdapter using the KeyringGateway and Delegate addresses
        KMSAdapter kmsAdapter = new KMSAdapter(address(keyringGateway), address(delegateContract));
        console.log("KMSAdapter deployed at:", address(kmsAdapter));
        vm.stopBroadcast();

        return address(kmsAdapter);
    }
}