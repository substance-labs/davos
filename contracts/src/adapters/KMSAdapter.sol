// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IKMSAdapter} from "../interfaces/IKMSAdapter.sol";
import {IKeyringGateway} from "../interfaces/IKeyringGateway.sol";

contract KMSAdapter is IKMSAdapter {
    address public immutable KEYRING_GATEWAY;
    address public immutable DELEGATE;

    modifier onlyDeleGate() {
        require(msg.sender == DELEGATE, NotDeleGate());
        _;
    }

    constructor(address keyringGateway, address delegate) {
        KEYRING_GATEWAY = keyringGateway;
        DELEGATE = delegate;
    }

    function sign(bytes calldata data) external onlyDeleGate {
        IKeyringGateway(KEYRING_GATEWAY).sign(data);
    }
}
