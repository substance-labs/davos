// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IDeleGate {
    struct Ethos {
        string ethos;
    }

    struct PendingPromptData {
        uint256 targetChainId;
        address voter;
        bytes target;
        bytes data;
    }

    struct Subscription {
        string space;
        address module;
    }

    event EndVoteCast(address indexed voter, bytes32 promptId);
    event EthosDefined(address indexed user, Ethos ethos);
    event LLMAdapterSet(address llmAdapter);
    event KMSAdapterSet(address indexed user, address kmsAdapter);
    event StartVoteCast(address indexed voter, bytes32 promptId);
    event Subscribed(string indexed space, address indexed voter, address module);
    event Unsubscribed(string space, address indexed user, address module);

    error KmsAdapterNotSet();
    error InvalidEthos();
    error InvalidPromptData();
    error SubscriptionNotFound();

    function castSpaceVoteFor(
        address voter,
        uint256 targetChainId,
        string calldata space,
        uint256 proposalId,
        string calldata vote,
        address keyringDeleGateModule,
        bytes calldata voteProof
    ) external;

    function defineEthos(Ethos calldata ethos) external;

    function getUserEthos(address user) external view returns (Ethos memory);

    function getUserKmsAdapter(address user) external view returns (address);

    function onAnswer(bytes32 promptId, string calldata answer) external;

    function setLlmAdapter(address newLlmAdapter) external;

    function setKmsAdapter(address kmsAdapter, address user) external;

    function subscribe(string calldata space, address voter, address module) external;

    function unsubscribe(string calldata space, address voter, address module) external;
}
