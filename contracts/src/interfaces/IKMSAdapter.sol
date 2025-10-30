// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IKMSAdapter {
    error NotDeleGate();

    function sign(bytes calldata data) external;
}
