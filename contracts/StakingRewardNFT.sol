// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract StakingRewardNFT is ERC721, Ownable {
    uint256 private _nextTokenId = 1;

    constructor(
        string memory name,
        string memory symbol,
        address initialOwner
    ) ERC721(name, symbol) Ownable(initialOwner) {}

    function mintReward(address to) external onlyOwner returns (uint256) {
        uint256 tokenId = _nextTokenId;
        _safeMint(to, tokenId);
        unchecked {
            _nextTokenId++;
        }
        return tokenId;
    }

    function totalMinted() external view returns (uint256) {
        return _nextTokenId - 1;
    }
}