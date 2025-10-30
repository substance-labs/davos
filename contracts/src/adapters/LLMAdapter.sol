// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ILLMAdapter} from "../interfaces/ILLMAdapter.sol";
import {IDeleGate} from "../interfaces/IDeleGate.sol";

contract LLMAdapter is ILLMAdapter {
    mapping(bytes32 => PromptStatus) private _promptsStatus;
    address public immutable DELEGATE;

    constructor(address delegate) {
        DELEGATE = delegate;
    }

    function ask(string calldata prompt) external returns (bytes32) {
        bytes32 promptId = keccak256(abi.encodePacked(block.chainid, block.timestamp, prompt));
        require(_promptsStatus[promptId] == PromptStatus.NotInitiated, InvalidPromptStatus());
        _promptsStatus[promptId] = PromptStatus.Initiated;
        emit Asked(promptId, prompt);
        return promptId;
    }

    function respond(bytes32 promptId, string calldata answer, bytes calldata proof) external {
        // TODO: verify proof
        require(_promptsStatus[promptId] == PromptStatus.Initiated, InvalidPromptStatus());
        _promptsStatus[promptId] = PromptStatus.Completed;
        IDeleGate(DELEGATE).onAnswer(promptId, answer);
        emit Answered(promptId, answer);
    }
}
