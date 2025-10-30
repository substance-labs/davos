// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Upgrades} from "openzeppelin-foundry-upgrades/Upgrades.sol";
import {Script, console} from "forge-std/Script.sol";
import {DeleGate} from "../src/DeleGate.sol";

contract DeleGateDeploy is Script {
    function setUp() public {}

    function run() public {
        vm.startBroadcast(vm.envUint("PRIVATE_KEY"));

        address proxy =
            Upgrades.deployUUPSProxy("DeleGate.sol", abi.encodeCall(DeleGate.initialize, (vm.envAddress("OWNER"))));

        console.log("DeleGate deployed to:", address(proxy));

        vm.stopBroadcast();
    }
}
