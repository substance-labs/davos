pragma solidity ^0.8.28;

import "forge-std/Script.sol";
import {DeleGate} from "../src/DeleGate.sol";

contract SubscribeScript is Script {
    address target = 0xbB246b30a4eAfDcCd8e9eE67331029F929aC3FBF;
    uint256 pk = 0x5d4d3e595d7c2bc65a6e844f256eddaeb4dbc35b4a6998d22fcd405792ce903f;
    function subscribe() public {
        // Provided private key
        
        // Parameters for the subscribe call
        string memory spaceName = "vanilladao.eth";
        address voter = 0xE6C2542904a67E1c87b1f76A8AbC949213b54414; // Add voter parameter
        address module = 0xFC67bC30E1577adf87d6CCdd8Ba6dda64bd2d956;

        vm.startBroadcast(pk);
        DeleGate(target).subscribe(spaceName, voter, module);
        vm.stopBroadcast();
    }

    function setKmsAdapter(address kmsAdapter, address user) public {
        vm.startBroadcast(pk);
        DeleGate(target).setKmsAdapter(kmsAdapter, user);
        vm.stopBroadcast();
    }



    function castSpaceVoteFor() public {
        // Parameters for the castSpaceVoteFor call
        address voter = 0xE6C2542904a67E1c87b1f76A8AbC949213b54414;
        uint256 targetChainId = 1;
        string memory space = "vanilladao.eth";
        uint256 proposalId = 0x675f74402f432194ffa5d403a95c8229e0dd6550558dc9eb9789aab43bdb2ea7;
        string memory vote = "Would you like to vote for this proposal? This is a test, the answer is yes";
        address module = 0xFC67bC30E1577adf87d6CCdd8Ba6dda64bd2d956;
        bytes memory voteProof = "0x";

        vm.startBroadcast(pk);
        DeleGate(target).castSpaceVoteFor(voter, targetChainId, space, proposalId, vote, module, voteProof);
        vm.stopBroadcast();
    }
}