// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { AccessControlEnumerableUpgradeable } from "@openzeppelin/contracts-upgradeable/access/extensions/AccessControlEnumerableUpgradeable.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
// import { OperationDecoder } from "./libraries/OperationDecoder.sol";
import { IKeyringGateway } from "./interfaces/IKeyringGateway.sol";
// import { IKeyringTarget } from "./interfaces/IKeyringTarget.sol";

struct SnapshotVote {
    string space;
    uint256 proposal;
    string voteType;
    uint choice;
}

struct TallyVote {
    address governorAddress;
    uint256 proposalId;
    uint8 support; // 0 = Against, 1 = For, 2 = Abstain
    string reason;
}

event snapshotSignVote(address indexed sender, SnapshotVote vote);
event tallySignVote(address indexed sender, TallyVote vote);

contract KeyringGateway is IKeyringGateway, UUPSUpgradeable, AccessControlEnumerableUpgradeable {
    // using OperationDecoder for bytes;

    mapping(address => bool) private _enabledSigners;
    mapping(bytes32 => bool) private _executedOperations;

    function initialize(address owner) public initializer {
        __AccessControlEnumerable_init();
        __UUPSUpgradeable_init();
        _grantRole(DEFAULT_ADMIN_ROLE, owner);
    }

    function canBeExecuted(bytes calldata operation) external view returns (bool) {
        return _executedOperations[sha256(operation)];
    }

    function sign(bytes calldata data) external {
        (string memory space, uint256 proposalId, uint8 support) = abi.decode(data, (string, uint256, uint8));

        SnapshotVote memory vote = SnapshotVote({
            space: space,
            proposal: proposalId,
            voteType: "single-choice",
            choice: support
        });
        
        emit snapshotSignVote(msg.sender, vote);
    }

    /**
     * @dev Sign and emit a Tally vote via Governor contract
     * @param governorAddress The address of the Governor contract
     * @param proposalId The proposal ID on the Governor
     * @param support The vote choice: 0 = Against, 1 = For, 2 = Abstain
     * @param reason Optional reason for the vote
     */
    function signTallyVote(
        address governorAddress,
        uint256 proposalId,
        uint8 support,
        string calldata reason
    ) external {
        require(governorAddress != address(0), "Invalid governor address");
        require(support <= 2, "Invalid support value (must be 0, 1, or 2)");

        TallyVote memory vote = TallyVote({
            governorAddress: governorAddress,
            proposalId: proposalId,
            support: support,
            reason: reason
        });

        emit tallySignVote(msg.sender, vote);
    }

    function _authorizeUpgrade(address) internal override onlyRole(DEFAULT_ADMIN_ROLE) {}
}
