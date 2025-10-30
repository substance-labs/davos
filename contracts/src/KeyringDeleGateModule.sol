// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AccessControlEnumerable} from "@openzeppelin/contracts/access/extensions/AccessControlEnumerable.sol";
import {IGovernor} from "@openzeppelin/contracts/governance/IGovernor.sol";
import {IKeyringTarget} from "./interfaces/keyring/IKeyringTarget.sol";
import {Operation} from "./interfaces/keyring/Operation.sol";
import {IKeyringDeleGateModule} from "./interfaces/IKeyringDeleGateModule.sol";

contract KeyringDeleGateModule is IKeyringDeleGateModule, IKeyringTarget, AccessControlEnumerable {
    bytes32 public constant UPDATE_GATEWAY_ROLE = keccak256("UPDATE_GATEWAY_ROLE");
    bytes32 public constant ON_OPERATION_ROLE = keccak256("ON_OPERATION_ROLE");
    bytes32 public constant UPDATE_KMS_ADAPTER_ROLE = keccak256("UPDATE_KMS_ADAPTER_ROLE");
    bytes32 public constant UPDATE_EXPECTED_SIGNER = keccak256("UPDATE_EXPECTED_SIGNER");

    address public gateway;
    address public expectedSigner;
    address public kmsAdapter;
    uint256 public expectedSourceChainId;

    constructor(
        address owner,
        address gateway_,
        address expectedSigner_,
        address kmsAdapter_,
        uint256 expectedSourceChainId_
    ) {
        gateway = gateway_;
        expectedSigner = expectedSigner_;
        kmsAdapter = kmsAdapter_;
        expectedSourceChainId = expectedSourceChainId_;

        _grantRole(DEFAULT_ADMIN_ROLE, owner);
        _grantRole(UPDATE_GATEWAY_ROLE, owner);
        _grantRole(UPDATE_KMS_ADAPTER_ROLE, owner);
        _grantRole(UPDATE_EXPECTED_SIGNER, owner);
        _grantRole(ON_OPERATION_ROLE, gateway);
    }

    function onOperation(address signer, Operation memory operation) external onlyRole(ON_OPERATION_ROLE) {
        require(signer == expectedSigner, InvalidSigner());
        require(address(bytes20(operation.sender)) == kmsAdapter, NotDeleGate());
        require(operation.sourceChainId == expectedSourceChainId, InvalidSourceChainId());

        (address governor, uint256 proposalId, uint8 support) = abi.decode(operation.data, (address, uint256, uint8));
        IGovernor(governor).castVote(proposalId, support);
    }

    function updateKmsAdapter(address newKmsAdapter) external onlyRole(UPDATE_KMS_ADAPTER_ROLE) {
        kmsAdapter = newKmsAdapter;
        emit KmsAdapterUpdated(newKmsAdapter);
    }

    function updateExpectedSigner(address newExpectedSigner) external onlyRole(UPDATE_EXPECTED_SIGNER) {
        expectedSigner = newExpectedSigner;
        emit ExpectedSignerUpdated(newExpectedSigner);
    }

    function updateGateway(address newGateway) external onlyRole(UPDATE_GATEWAY_ROLE) {
        _revokeRole(ON_OPERATION_ROLE, gateway);
        _grantRole(ON_OPERATION_ROLE, newGateway);
        gateway = newGateway;
        emit GatewayUpdated(newGateway);
    }
}
