// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {Script, console} from "forge-std/Script.sol";
import {KeyringDeleGateModule} from "../src/KeyringDeleGateModule.sol";

contract KeyringDeleGateModuleDeploy is Script {
    function setUp() public {}

    function run() public {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        KeyringDeleGateModule module = new KeyringDeleGateModule(
            vm.envAddress("OWNER"),
            vm.envAddress("GATEWAY"),
            vm.envAddress("SIGNER"),
            vm.envAddress("DELEGATE"),
            vm.envUint("CHAIN_ID")
        );

        console.log("KeyringDeleGateModule deployed to:", address(module));

        vm.stopBroadcast();
    }
}
