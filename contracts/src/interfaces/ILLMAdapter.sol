// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface ILLMAdapter {
    enum PromptStatus {
        NotInitiated,
        Initiated,
        Completed
    }

    event Asked(bytes32 indexed promptId, string prompt);
    event Answered(bytes32 indexed promptId, string answer);

    error ResponseAlreadyExists(bytes32 promptId);
    error InvalidPromptStatus();

    function ask(string calldata prompt) external returns (bytes32);

    function respond(bytes32 promptId, string calldata answer, bytes calldata proof) external;
}
