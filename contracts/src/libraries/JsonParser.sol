// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

library JsonParser {
    error InvalidJsonArray();
    error InvalidCharacter();

    /// @notice Parses a JSON string representing a uint256 array (e.g. "[0,6,2]") and returns the decoded uint256 array.
    /// @param json The input JSON string.
    /// @return numbers The decoded uint256 array.
    function parseUintArray(string memory json) internal pure returns (uint256[] memory numbers) {
        bytes memory b = bytes(json);
        require(b.length >= 2, InvalidJsonArray());
        require(b[0] == "[" && b[b.length - 1] == "]", InvalidJsonArray());

        uint256 count = 0;
        bool inNumber = false;
        for (uint256 i = 1; i < b.length - 1; i++) {
            bytes1 char = b[i];
            if (isWhitespace(char)) {
                continue;
            }
            if (isDigit(char)) {
                if (!inNumber) {
                    inNumber = true;
                    count++;
                }
            } else if (char == ",") {
                inNumber = false;
            } else {
                revert InvalidCharacter();
            }
        }

        // Allocate array with the proper size.
        numbers = new uint256[](count);

        // Second pass: parse and extract numbers.
        uint256 numberIndex = 0;
        uint256 currentNumber = 0;
        inNumber = false;
        for (uint256 i = 1; i < b.length - 1; i++) {
            bytes1 char = b[i];
            if (isWhitespace(char)) {
                continue;
            }
            if (isDigit(char)) {
                inNumber = true;
                // Multiply previous value by 10 and add new digit.
                currentNumber = currentNumber * 10 + (uint8(char) - 48);
            } else if (char == ",") {
                if (inNumber) {
                    numbers[numberIndex] = currentNumber;
                    numberIndex++;
                    currentNumber = 0;
                    inNumber = false;
                }
            }
        }
        // Add the last number if we were in the middle of parsing one.
        if (inNumber) {
            numbers[numberIndex] = currentNumber;
        }

        return numbers;
    }

    /// @notice Checks if a byte is a digit (0-9).
    /// @param char The byte to check.
    /// @return True if the byte is a digit, false otherwise.
    function isDigit(bytes1 char) internal pure returns (bool) {
        return char >= 0x30 && char <= 0x39;
    }

    /// @notice Checks if a byte is whitespace (space, tab, newline, or carriage return).
    /// @param char The byte to check.
    /// @return True if the byte is whitespace, false otherwise.
    function isWhitespace(bytes1 char) internal pure returns (bool) {
        return char == 0x20 || char == 0x09 || char == 0x0A || char == 0x0D;
    }
}
