// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {KeyringGateway} from "../src/KeyringGateway.sol";

contract DeployKeyringGateway is Script {
    function run() public {
        // Pull values from environment variables
        uint256 privateKey = vm.envUint("PRIVATE_KEY");
        address owner = vm.envAddress("OWNER");

        vm.startBroadcast(privateKey);

        // Deploy KeyringGateway and initialize it
        KeyringGateway keyringGateway = new KeyringGateway();
        keyringGateway.initialize(owner);

        console.log("KeyringGateway deployed at:", address(keyringGateway));
        console.log("Owner:", owner);

        vm.stopBroadcast();
    }
}