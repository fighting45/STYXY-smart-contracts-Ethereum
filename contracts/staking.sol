// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./StakingRewardNFT.sol";

contract TokenStaking is ReentrancyGuard, Ownable{
    IERC20 public stakingToken;
    IERC20 public rewardToken;
    StakingRewardNFT public rewardNFT;

    uint256 public rewardRate; //APR in basis points (e.g 1000 = 10%)
    uint256 public lockupPeriod;
    uint256 public constant SECONDS_PER_YEAR = 365 days;
    uint256 public constant BASIS_POINTS = 10000;

    struct StakeInfo {
        uint256 amount;
        uint256 stakeTime;
        uint256 lastRewardTime;
        uint256 pendingRewards;
        uint256 lastRewardRate;
    }
    mapping(address => StakeInfo) public stakes;
    uint256 public totalStaked;
    uint256 public rewardPool;

    event Staked(address indexed user, uint256 amount);
    event Unstaked(address indexed user, uint256 amount);
    event NFTRewardMinted(address indexed user, uint256 tokenId);
    event RewardClaimed(address indexed user, uint256 amount);
    // event RewardRateUpdated(uint256 newRate);
    event APRUpdated(uint256 newAPR);

    constructor(
        address _stakingToken,
        address _rewardToken,
        uint256 _initialAPR,
        uint256 _lockupPeriod
    ) Ownable(msg.sender) {
        stakingToken = IERC20(_stakingToken);
        rewardToken = IERC20(_rewardToken);
        rewardRate = _initialAPR;
        lockupPeriod = _lockupPeriod;

        rewardNFT = new StakingRewardNFT(
            "Staking Reward NFT",
            "SRNFT",
            address(this)
        );
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
            userStake.lastRewardRate = rewardRate;
        }
        userStake.amount += _amount;
        totalStaked += _amount;

        emit Staked(msg.sender,_amount);
    }
    function unStake(uint256 _amount) external nonReentrant {
        StakeInfo storage userStake = stakes[msg.sender];
        require(userStake.amount >= _amount, "Insufficient staked amounts");
        require(
            block.timestamp >= userStake.stakeTime + lockupPeriod,
            "Funds are still in lockup period"
            );
        updateRewards(msg.sender);

        userStake.amount -= _amount;
        totalStaked -= _amount;

        stakingToken.transfer(msg.sender, _amount);

        uint256 nftTokenId = rewardNFT.mintReward(msg.sender);
        emit NFTRewardMinted(msg.sender, nftTokenId);

        emit Unstaked(msg.sender, _amount);
    }
    function claimRewards() external nonReentrant {
        updateRewards(msg.sender);

        StakeInfo storage userStake = stakes[msg.sender];
        uint256 rewards = userStake.pendingRewards;

        require(rewards > 0, "No rewards to claim");
        require(rewardToken.balanceOf(address(this)) >= rewards, "Insufficient Reward Pool funds");

        userStake.pendingRewards = 0;
        rewardPool -= rewards;
        rewardToken.transfer(msg.sender, rewards);

        emit RewardClaimed(msg.sender, rewards);
    }
    function updateRewards(address _user) internal {

        StakeInfo storage userStake = stakes[_user];
        if(userStake.amount > 0){
            uint256 timeElapsed = block.timestamp - userStake.lastRewardTime;
            uint256 earnedRewards = (userStake.amount * userStake.lastRewardRate * timeElapsed) / (SECONDS_PER_YEAR * BASIS_POINTS);
            userStake.pendingRewards += earnedRewards;
            userStake.lastRewardTime = block.timestamp;
            userStake.lastRewardRate = rewardRate;
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
            uint256 earnedRewards = (userStake.amount * userStake.lastRewardRate * timeElapsed)/(SECONDS_PER_YEAR * BASIS_POINTS);
            pendingRewards = userStake.pendingRewards + earnedRewards ;
        }
        else {
            pendingRewards = userStake.pendingRewards;
        }

    }
      function updateAPR(uint256 _newAPR) external onlyOwner {
        require(_newAPR <= 5000, "APR too high"); // Max 50% APR for safety
        require(_newAPR >= 100, "APR too low");   // Min 1% APR
        
        rewardRate = _newAPR;
        emit APRUpdated(_newAPR);
    }
    function getAPR() external view returns (uint256){
        return rewardRate / 100; 
    }   

    //Owner Functions

    function addRewards(uint256 _amount) external onlyOwner {
        require(_amount > 0, "Amount must be greater than 0");
        rewardToken.transferFrom(msg.sender, address(this), _amount);
        rewardPool += _amount;
    }
  
    function setLockupPeriod(uint256 _newPeriod) external onlyOwner {
        lockupPeriod = _newPeriod;
    }
    function emergencyWithdraw(address _token, uint256 _amount) external onlyOwner {
        IERC20(_token).transfer(owner(), _amount);
    }
}
    
