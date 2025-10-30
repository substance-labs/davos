// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Test, console} from "forge-std/Test.sol";
import {LLMAdapter} from "../src/adapters/LLMAdapter.sol";

contract LLMAdapterTest is Test {
/*LLMAdapter public adapter;
    address public user = address(1);

    event Asked(uint256 promptId, string query);
    event Answered(uint256 promptId, string response);

    function setUp() public {
        adapter = new LLMAdapter();
        vm.label(address(adapter), "LLMAdapter");
        vm.label(user, "User");
    }

    function test_Query() public {
        string memory queryText = "What is the capital of France?";

        vm.expectEmit(true, true, true, true);
        emit Asked(uint256(keccak256(abi.encodePacked(block.chainid, queryText, block.timestamp))), queryText);

        adapter.query(queryText);
    }

    function test_Response() public {
        string memory queryText = "What is the capital of France?";
        uint256 promptId = uint256(keccak256(abi.encodePacked(block.chainid, queryText, block.timestamp)));
        string memory responseText = "Paris";

        // First query
        adapter.query(queryText);

        // Then respond
        vm.expectEmit(true, true, true, true);
        emit Answered(promptId, responseText);

        adapter.respond(promptId, responseText);

        // Verify response is stored
        assertEq(adapter.queries(promptId), responseText);
    }

    function test_RevertWhen_DuplicateResponse() public {
        string memory queryText = "What is the capital of France?";
        uint256 promptId = uint256(keccak256(abi.encodePacked(block.chainid, queryText, block.timestamp)));

        adapter.query(queryText);
        adapter.respond(promptId, "Paris");

        vm.expectRevert(abi.encodeWithSelector(LLMAdapter.ResponseAlreadyExists.selector, promptId));
        adapter.respond(promptId, "London");
    }

    function test_QueryFromDifferentUser() public {
        string memory queryText = "What is the capital of France?";

        vm.prank(user);
        vm.expectEmit(true, true, true, true);
        emit Asked(uint256(keccak256(abi.encodePacked(block.chainid, queryText, block.timestamp))), queryText);

        adapter.query(queryText);
    }

    function test_GetResponse() public {
        string memory queryText = "What is the capital of France?";
        uint256 promptId = uint256(keccak256(abi.encodePacked(block.chainid, queryText, block.timestamp)));
        string memory responseText = "Paris";

        adapter.query(queryText);
        adapter.respond(promptId, responseText);

        assertEq(adapter.getResponse(promptId), responseText);
    }*/
}
