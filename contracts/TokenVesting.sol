// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";


contract TokenVesting is Ownable, ReentrancyGuard {
    IERC20 public immutable token;
    uint64 public immutable cliffDuration;
    uint256 public startTime;

    mapping(address => uint256) public allocations;
    mapping(address => uint256) public released;
    mapping(address => bool) public revoked;
    address[] public beneficiaries;
    uint256 public totalAllocated;
    bool public paused;
    bool private beneficiariesSet;

    event TokensReleased(address indexed beneficiary, uint256 amount);
    event ContractFunded(uint256 amount);
    event VestingScheduleCreated(address indexed beneficiary, uint256 allocation);
    event Paused();
    event Unpaused();
    event BeneficiaryRevoked(address indexed beneficiary);
    event BeneficiaryUnrevoked(address indexed beneficiary);

    constructor(address _token, uint64 _cliffDuration) Ownable(msg.sender) {
        require(_token != address(0), "Token address cannot be zero");
        require(_cliffDuration > 0, "Cliff duration must be greater than zero");

        token = IERC20(_token);
        cliffDuration = _cliffDuration;
    }

    // Allow contract to receive ETH (e.g., for test scenarios)
    receive() external payable {}

    function setBeneficiaries(address[] calldata _beneficiaries, uint256[] calldata _allocations) external onlyOwner {
        require(!beneficiariesSet, "Beneficiaries already configured");
        require(_beneficiaries.length > 0, "Empty beneficiaries array");
        require(_beneficiaries.length == _allocations.length, "Array length mismatch");

        uint256 newTotalAllocated;
        for (uint256 i = 0; i < _beneficiaries.length; i++) {
            address beneficiary = _beneficiaries[i];
            uint256 allocation = _allocations[i];

            require(beneficiary != address(0), "Zero address beneficiary");
            require(allocation > 0, "Zero allocation");
            require(allocations[beneficiary] == 0, "Duplicate beneficiary");

            allocations[beneficiary] = allocation;
            released[beneficiary] = 0;
            beneficiaries.push(beneficiary);
            newTotalAllocated += allocation;

            emit VestingScheduleCreated(beneficiary, allocation);
        }

        require(newTotalAllocated > 0, "Zero total allocation");

        totalAllocated = newTotalAllocated;
        startTime = block.timestamp;
        beneficiariesSet = true;
    }

    function fund(uint256 amount) external onlyOwner {
        require(amount > 0, "Amount must be greater than zero");
        bool success = token.transferFrom(msg.sender, address(this), amount);
        require(success, "Token transfer failed");

        emit ContractFunded(amount);
    }

    function pause() external onlyOwner {
        require(!paused, "Contract already paused");
        paused = true;

        emit Paused();
    }

    function unpause() external onlyOwner {
        require(paused, "Contract is not paused");
        paused = false;

        emit Unpaused();
    }

    function revokeBeneficiary(address beneficiary) external onlyOwner {
        require(allocations[beneficiary] > 0, "Not a beneficiary");
        require(!revoked[beneficiary], "Already revoked");

        revoked[beneficiary] = true;

        emit BeneficiaryRevoked(beneficiary);
    }

    function unrevokeBeneficiary(address beneficiary) external onlyOwner {
        require(revoked[beneficiary], "Not revoked");

        revoked[beneficiary] = false;

        emit BeneficiaryUnrevoked(beneficiary);
    }

    function release(address beneficiary) external {
    require(beneficiariesSet, "Beneficiaries not configured");
    require(!paused, "Contract is paused");
    require(!revoked[beneficiary], "Beneficiary is revoked");
    require(block.timestamp >= startTime + cliffDuration, "Cliff period not reached");

    uint256 allocation = allocations[beneficiary];
    require(allocation > 0, "Beneficiary has no allocation");

    uint256 unreleased = allocation - released[beneficiary];
    require(unreleased > 0, "No tokens to release");

    // Calculate remaining obligation (sum of unreleased allocations for all non-revoked beneficiaries)
    uint256 remainingObligation = 0;
    for (uint256 i = 0; i < beneficiaries.length; i++) {
        address addr = beneficiaries[i];
        if (!revoked[addr]) {
            uint256 unreleasedForAddr = allocations[addr] - released[addr];
            remainingObligation += unreleasedForAddr;
        }
    }

    require(token.balanceOf(address(this)) >= remainingObligation, "Insufficient contract balance for total allocations");
    require(token.balanceOf(address(this)) >= unreleased, "Insufficient contract balance");

    released[beneficiary] += unreleased;
    token.transfer(beneficiary, unreleased);

    emit TokensReleased(beneficiary, unreleased);
}

    function releasableAmount(address beneficiary) public view returns (uint256) {
        if (!beneficiariesSet || paused || revoked[beneficiary]) {
            return 0;
        }
        if (!isCliffPassed()) {
            return 0;
        }
        uint256 allocation = allocations[beneficiary];
        if (allocation == 0) {
            return 0;
        }
        uint256 alreadyReleased = released[beneficiary];
        if (alreadyReleased >= allocation) {
            return 0;
        }
        return allocation - alreadyReleased;
    }

    function getVestingInfo(address beneficiary)
        external
        view
        returns (
            uint256 allocation,
            uint256 releasedAmount,
            uint256 releasable,
            uint256 cliffEndTime,
            bool isRevoked
        )
    {
        allocation = allocations[beneficiary];
        releasedAmount = released[beneficiary];
        releasable = releasableAmount(beneficiary);
        cliffEndTime = startTime + cliffDuration;
        isRevoked = revoked[beneficiary];
    }

    function isCliffPassed() public view returns (bool) {
        if (!beneficiariesSet) {
            return false;
        }
        return block.timestamp >= startTime + cliffDuration;
    }

    function getContractStatus()
        external
        view
        returns (
            bool isPaused,
            bool isConfigured,
            uint256 currentBalance,
            uint256 totalAllocation
        )
    {
        isPaused = paused;
        isConfigured = beneficiariesSet;
        currentBalance = token.balanceOf(address(this));
        totalAllocation = totalAllocated;
    }

    function getBeneficiaries() external view returns (address[] memory) {
        return beneficiaries;
    }
}
