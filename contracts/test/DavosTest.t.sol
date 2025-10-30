// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import "forge-std/Test.sol";
import "../src/DeleGate.sol";
import "../src/KeyringGateway.sol";
import "../src/adapters/LLMAdapter.sol";
import "../src/adapters/KMSAdapter.sol";

contract DavosTest is Test {
  DeleGate deleGate;
  LLMAdapter llmAdapter;
  address owner = address(0xABCD);
  address voter = address(0xBEEF);
  address dummyKmsAdapter = address(0xDEAD);
  address dummyModule = address(0x1234);
  uint256 targetChainId = 1;
  string space = "testSpace";
  uint256 proposalId = 42;
  string vote = "yes";
  bytes voteProof = "";

  // redeclare event to use expectEmit
  event StartVoteCast(address indexed voter, bytes32 promptId);

  function setUp() public {
    // Deploy and initialize DeleGate

    KeyringGateway keyringGateway = new KeyringGateway();
    keyringGateway.initialize(owner);

    deleGate = new DeleGate();
    deleGate.initialize(owner);

    // Deploy LLMAdapter passing the DeleGate address as delegate, then set it in DeleGate.
    llmAdapter = new LLMAdapter(address(deleGate));
    vm.prank(owner);
    deleGate.setLlmAdapter(address(llmAdapter));

    // Set a dummy KMS adapter for the voter.
    vm.prank(voter);
    deleGate.setKmsAdapter(dummyKmsAdapter, voter);

    // For the subscription check, _checkSubscription uses:
    // keccak256(abi.encode(targetChainId, space, voter, dummyModule))
    // We'll manually store 'true' in the private mapping _enabledSubscriptions.
    // Note: _enabledSubscriptions is the 5th state variable declared in DeleGate.
    // The mapping slot is assumed here to be "4" (starting from 0); adjust if your storage layout changes.
    bytes32 subKey = keccak256(abi.encode(targetChainId, space, voter, dummyModule));
    uint256 mappingSlot = 4;
    // Compute the storage slot for _enabledSubscriptions[subKey]:
    bytes32 mappingLocation = keccak256(abi.encode(abi.encode(subKey), mappingSlot));
    // Mark the subscription as enabled (true == 1)
    vm.store(address(deleGate), mappingLocation, bytes32(uint256(1)));
  }

  function test_castSpaceVoteFor() public {
    // Expect the StartVoteCast event to be emitted.
    // vm.expectEmit(true, false, false, true);
    // emit StartVoteCast(voter, bytes32(0)); // The promptId is unpredictable, so we use a wildcard match.

    // Call castSpaceVoteFor from the owner (or any caller).
    vm.prank(voter);

    deleGate.subscribe(
      space,
      voter,
      dummyModule
    );

    deleGate.castSpaceVoteFor(
      voter,
      targetChainId,
      space,
      proposalId,
      vote,
      dummyModule,
      voteProof
    );
  }
}