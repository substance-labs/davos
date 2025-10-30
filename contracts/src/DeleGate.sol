pragma solidity ^0.8.28;

import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlEnumerableUpgradeable} from
    "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import {JsonParser} from "./libraries/JsonParser.sol";
import {IDeleGate} from "./interfaces/IDeleGate.sol";
import {ILLMAdapter} from "./interfaces/ILLMAdapter.sol";
import {IKMSAdapter} from "./interfaces/IKMSAdapter.sol";

contract DeleGate is IDeleGate, UUPSUpgradeable, AccessControlEnumerableUpgradeable {
    bytes32 public constant AGENT_ORCHESTRATOR = keccak256(abi.encodePacked("AGENT_ORCHESTRATOR"));
    bytes32 public constant SET_LLM_ADAPTER_ADMIN_ROLE = keccak256(abi.encodePacked("SET_LLM_ADAPTER_ADMIN_ROLE"));
    bytes32 public constant ON_ASWER_ROLE = keccak256(abi.encodePacked("ON_ASWER_ROLE"));

    mapping(address => Ethos) private _usersEthos;
    mapping(bytes32 => PendingPromptData) private _pendingPromptData;
    mapping(address => address) private _usersKmsAdapter;
    mapping(address => Subscription[]) private _userSubscribtions;
    mapping(bytes32 => bool) private _enabledSubscriptions;
    address public llmAdapter;

    function initialize(address owner) public initializer {
        __AccessControlEnumerable_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(SET_LLM_ADAPTER_ADMIN_ROLE, owner);
        _grantRole(AGENT_ORCHESTRATOR, owner);
    }

    function castSpaceVoteFor(
        address voter,
        uint256 targetChainId,
        string calldata space,
        uint256 proposalId,
        string calldata vote,
        address module,
        bytes calldata voteProof
    ) external {
        // TODO: verify zkTLS proof (voteProof)
        Ethos memory ethos = _usersEthos[voter];
        _checkKmsAdapterExistence(voter);
        _checkSubscription(space, voter, module);

        string memory prompt = string(
            abi.encodePacked(
                "given this vote: ",
                vote,
                ". Consider to return a result based on the following ethos: ",
                ethos.ethos
            )
        );

        bytes32 promptId = ILLMAdapter(llmAdapter).ask(prompt);

        _pendingPromptData[promptId] = PendingPromptData({
            targetChainId: targetChainId,
            target: abi.encodePacked(module),
            voter: voter,
            data: abi.encode(space, proposalId)
        });
        emit StartVoteCast(voter, promptId);
    }

    function defineEthos(Ethos calldata ethos) external {
        _validateEthos(ethos);
        _usersEthos[msg.sender] = ethos;
        emit EthosDefined(msg.sender, ethos);
    }

    function getUserKmsAdapter(address user) external view returns (address) {
        return _usersKmsAdapter[user];
    }

    function getUserEthos(address user) external view returns (Ethos memory) {
        return _usersEthos[user];
    }

    function getUserSubscriptions(address user) external view returns (Subscription[] memory) {
        return _userSubscribtions[user];
    }

    function isSubscribed(string calldata space, address voter, address module) external view returns (bool) {
        bytes32 subscriptionId = keccak256(abi.encode(space, voter, module));
        return _enabledSubscriptions[subscriptionId];
    }

    function onAnswer(bytes32 promptId, string calldata answer) external onlyRole(ON_ASWER_ROLE) {
        PendingPromptData storage promptData = _pendingPromptData[promptId];
        require(promptData.targetChainId != 0, InvalidPromptData());

        (string memory space, uint256 proposalId) = abi.decode(promptData.data, (string, uint256));

        IKMSAdapter(_usersKmsAdapter[promptData.voter]).sign(
            abi.encode(space, proposalId, JsonParser.parseUintArray(answer)[0])
        );
        emit EndVoteCast(promptData.voter, promptId);
        delete _pendingPromptData[promptId];
    }

    function setLlmAdapter(address newLlmAdapter) external onlyRole(SET_LLM_ADAPTER_ADMIN_ROLE) {
        _revokeRole(ON_ASWER_ROLE, llmAdapter);
        _grantRole(ON_ASWER_ROLE, newLlmAdapter);
        llmAdapter = newLlmAdapter;
        emit LLMAdapterSet(newLlmAdapter);
    }

    function setKmsAdapter(address kmsAdapter, address user) external {
        // NOTE: Each user must deploy their own `KmsAdapter` because the KeyringGateway needs to associate
        // a unique key with each user (msg.sender). In this context, the msg.sender within KeyringGateway.executeOperation
        // is referenced by the `KmsAdapter`.
        _usersKmsAdapter[user] = kmsAdapter;
        emit KMSAdapterSet(user, kmsAdapter);
    }

    function subscribe(string calldata space, address voter, address module) external onlyRole(AGENT_ORCHESTRATOR) {
        bytes32 subscriptionId = keccak256(abi.encode(space, voter, module));
        require (_enabledSubscriptions[subscriptionId] == false, "Already subscribed");
        Subscription[] storage subscriptions = _userSubscribtions[voter];
        subscriptions.push(Subscription({space: space, module: module}));
        _enabledSubscriptions[subscriptionId] = true;
        emit Subscribed(space, voter, module);
    }

    function unsubscribe(string calldata space, address voter, address module) external onlyRole(AGENT_ORCHESTRATOR) {
        bytes32 subscriptionId = keccak256(abi.encode(space, voter, module));

        // Check if subscription exists
        require(_enabledSubscriptions[subscriptionId] == true, "Subscription not found");

        // Remove from enabled subscriptions map
        _enabledSubscriptions[subscriptionId] = false;

        // Find and remove from voter's subscriptions array
        Subscription[] storage subscriptions = _userSubscribtions[voter];
        for (uint256 i = 0; i < subscriptions.length; i++) {
            if (
                keccak256(abi.encode(subscriptions[i].space)) == keccak256(abi.encode(space)) &&
                subscriptions[i].module == module
            ) {
                // Replace the item to remove with the last item
                if (i < subscriptions.length - 1) {
                    subscriptions[i] = subscriptions[subscriptions.length - 1];
                }
                // Remove the last item
                subscriptions.pop();
                break;
            }
        }

        emit Unsubscribed(space, voter, module);
    }

    function _checkKmsAdapterExistence(address user) internal view {
        require(_usersKmsAdapter[user] != address(0), KmsAdapterNotSet());
    }

    function _checkSubscription(string calldata space, address voter, address module) internal view {
        bytes32 subscriptionId = keccak256(abi.encode(space, voter, module));
        require(_enabledSubscriptions[subscriptionId] == true, SubscriptionNotFound());
    }

    function _validateEthos(Ethos memory ethos) internal pure {
        require(abi.encodePacked(ethos.ethos).length > 0, InvalidEthos());
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
