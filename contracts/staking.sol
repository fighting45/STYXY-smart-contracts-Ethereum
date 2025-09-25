// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract TokenStaking is ReentrancyGuard, Ownable{
    IERC20 public stakingToken;
    IERC20 public rewardToken;

    uint256 public rewardRate;
    uint256 public lockupPeriod;
    struct StakeInfo {
        uint256 amount;
        uint256 stakeTime;
        uint256 lastRewardTime;
        uint256 pendingRewards;
    }
    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;
    uint256 public rewardPool;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event RewardClaimed(address indexed user, uint256 amount);
    event RewardRateUpdated(uint256 newRate);

    constructor(
        address _stakingToken,
        address _rewardToken,
        uint256 _rewardRate,
        uint256 _lockupPeriod
    ) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardRate = _rewardRate;
        lockupPeriod = _lockupPeriod;
    }
    function stake(uint256 _amount) external nonReentrant {
        require(_amount > 0, "Amount must be greater than '0'!");
        require(stakingToken.balanceOf(msg.sender)>= _amount, "Insufficient balance!");

        // Update rewards before changing stake
        updateRewards(msg.sender);

        //Transfer token to deployed contract
        stakingToken.transferFrom(msg.sender, address(this), _amount);

        StakeInfo storage userStake = stakes[msg.sender];
        if (userStake.amount == 0){
            //New Stake
            userStake.stakeTime = block.timestamp;
            userStake.lastRewardTime = block.timestamp;
        }
        userStake.amount += _amount;
        totalStaked += _amount;

        emit Staked(msg.sender,_amount);
    }
    function unStake(uint256 _amount) external nonReentrant {
        StakeInfo storage userStake = stakes[msg.sender];
        require(userStake.amount >= 0, "Insufficient staked amounts");
        require(
            block.timestamp >= userStake.stakeTime + lockupPeriod,
            "Funds are still in lockup period"
            );
        updateRewards(msg.sender);

        userStake.amount -= _amount;
        totalStaked -= _amount;

        stakingToken.transfer(msg.sender, _amount);

        emit Unstaked(msg.sender, _amount);
    }
    function claimRewards() external nonReentrant {
        updateRewards(msg.sender);

        StakeInfo storage userStake = stakes[msg.sender];
        uint256 rewards = userStake.pendingRewards;

        require(rewards > 0, "No rewards to claim");
        require(rewardToken.balanceOf(address(this)) >=0, "Insufficient Reward Pool funds");

        userStake.pendingRewards = 0;
        rewardPool -= rewards;
        rewardToken.transfer(msg.sender, rewards);

        emit RewardClaimed(msg.sender, rewards);
    }
    function updateRewards(address _user) internal {

        StakeInfo storage userStake = stakes[_user];
        if(userStake.amount > 0){
            uint256 timeElapsed = block.timestamp - userStake.lastRewardTime;
            uint256 earnedRewards = (userStake.amount * rewardRate * timeElapsed);

            userStake.pendingRewards += earnedRewards;
            userStake.lastRewardTime += block.timestamp;
        }
    }
    function getStakeInfo(address _user) external view returns (
        uint256 amount,
        uint256 stakeTime,
        uint256 lockupRemaining,
        uint256 pendingRewards
    ){
        StakeInfo storage userStake = stakes[_user];
        amount = userStake.amount;
        stakeTime = userStake.stakeTime;

        if (stakeTime > 0) {
            uint256 lockupEnd = userStake.stakeTime + lockupPeriod;
            lockupRemaining = lockupEnd > block.timestamp ? lockupEnd - block.timestamp : 0;
        }
        //calculate current pending rewards
        if (userStake.amount > 0){
            uint256 timeElapsed = block.timestamp - userStake.lastRewardTime;
            uint256 earnedRewards = (userStake.amount * rewardRate * timeElapsed);
            pendingRewards = userStake.pendingRewards + earnedRewards ;
        }
        else {
            pendingRewards = userStake.pendingRewards;
        }

    }
    function getAPR() external view returns (uint256){
        if (totalStaked == 0) return 0;
        uint256 yearlyRewards = rewardRate * 365 days;
        return (yearlyRewards * 100) / 1e18; 
    }

    //Owner Functions

    function addRewards(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Amount must be greater than 0");
        rewardToken.transferFrom(msg.sender, address(this), _amount);
        rewardPool += _amount;
    }
    function setRewardRate(uint256 _newRate) external onlyOwner {
        rewardRate = _newRate;
        emit RewardRateUpdated(_newRate);
    }
    function setLockupPeriod(uint256 _newPeriod) external onlyOwner {
        lockupPeriod = _newPeriod;
    }
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).transfer(owner(), _amount);
    }
}
    