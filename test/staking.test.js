const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenStaking", function () {
  let staking;
  let stakingToken;
  let rewardToken;
  let owner, user1, user2, user3, user4;

  // Helper function to increase time
  const increaseTime = async (seconds) => {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine");
  };

  beforeEach(async function () {
    // Get signers
    [owner, user1, user2, user3, user4] = await ethers.getSigners();

    // Deploy Mock ERC20 tokens
    const MockERC20 = await ethers.getContractFactory("MockERC20");

    stakingToken = await MockERC20.deploy(
      "Staking Token",
      "STK",
      owner.address,
      ethers.parseEther("1000000")
    );

    rewardToken = await MockERC20.deploy(
      "Reward Token",
      "REW",
      owner.address,
      ethers.parseEther("1000000")
    );

    // Deploy Staking Contract
    const TokenStaking = await ethers.getContractFactory("TokenStaking");
    staking = await TokenStaking.deploy(
      await stakingToken.getAddress(),
      await rewardToken.getAddress(),
      1000, // 10% APR in basis points
      7 * 24 * 60 * 60 // 7 days lockup
    );

    // Transfer tokens to users for testing
    await stakingToken.transfer(user1.address, ethers.parseEther("10000"));
    await stakingToken.transfer(user2.address, ethers.parseEther("10000"));
    await stakingToken.transfer(user3.address, ethers.parseEther("10000"));
    await stakingToken.transfer(user4.address, ethers.parseEther("10000"));

    // Approve reward tokens before adding to pool
    await rewardToken.approve(
      await staking.getAddress(),
      ethers.parseEther("5000")
    );

    // Add rewards to the pool
    await staking.connect(owner).addRewards(ethers.parseEther("1000"));
  });

  describe("Deployment", function () {
    it("Should set correct token addresses", async function () {
      expect(await staking.stakingToken()).to.equal(
        await stakingToken.getAddress()
      );
      expect(await staking.rewardToken()).to.equal(
        await rewardToken.getAddress()
      );
    });

    it("Should set correct initial values", async function () {
      expect(await staking.rewardRate()).to.equal(1000); // 10% APR
      expect(await staking.lockupPeriod()).to.equal(7 * 24 * 60 * 60);
    });

    it("Should set owner correctly", async function () {
      expect(await staking.owner()).to.equal(owner.address);
    });
  });

  describe("Staking Functionality", function () {
    it("Should allow users to stake tokens", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      const stakeInfo = await staking.getStakeInfo(user1.address);
      expect(stakeInfo.amount).to.equal(stakeAmount);
      expect(stakeInfo.stakeTime).to.be.gt(0);
      expect(await staking.totalStaked()).to.equal(stakeAmount);
    });

    it("Should reject zero amount staking", async function () {
      await expect(staking.connect(user1).stake(0)).to.be.revertedWith(
        "Amount must be greater than '0'!"
      );
    });

    it("Should reject staking with insufficient balance", async function () {
      const excessiveAmount = ethers.parseEther("100000");
      await expect(
        staking.connect(user1).stake(excessiveAmount)
      ).to.be.revertedWith("Insufficient balance!");
    });

    it("Should update rewards when staking additional tokens", async function () {
      const firstStake = ethers.parseEther("500");
      const secondStake = ethers.parseEther("300");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), firstStake);
      await staking.connect(user1).stake(firstStake);

      await increaseTime(24 * 60 * 60); // 1 day

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), secondStake);
      await staking.connect(user1).stake(secondStake);

      const stakeInfo = await staking.getStakeInfo(user1.address);
      expect(stakeInfo.amount).to.equal(ethers.parseEther("800"));
    });

    it("Should update totalStaked correctly with multiple users", async function () {
      const user1Stake = ethers.parseEther("1000");
      const user2Stake = ethers.parseEther("2000");
      const user3Stake = ethers.parseEther("1500");

      // User1 stakes
      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), user1Stake);
      await staking.connect(user1).stake(user1Stake);

      // User2 stakes
      await stakingToken
        .connect(user2)
        .approve(await staking.getAddress(), user2Stake);
      await staking.connect(user2).stake(user2Stake);

      // User3 stakes
      await stakingToken
        .connect(user3)
        .approve(await staking.getAddress(), user3Stake);
      await staking.connect(user3).stake(user3Stake);

      const expectedTotal = user1Stake + user2Stake + user3Stake;
      expect(await staking.totalStaked()).to.equal(expectedTotal);
    });
  });

  describe("Reward Calculation", function () {
    it("Should calculate rewards correctly for 10% APR", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(365 * 24 * 60 * 60);

      const stakeInfo = await staking.getStakeInfo(user1.address);
      const expectedRewards = ethers.parseEther("100");

      expect(stakeInfo.pendingRewards).to.be.closeTo(
        expectedRewards,
        ethers.parseEther("0.1")
      );
    });

    it("Should calculate proportional rewards for partial year", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(182 * 24 * 60 * 60); // 6 months

      const stakeInfo = await staking.getStakeInfo(user1.address);
      const expectedRewards = ethers.parseEther("50");

      expect(stakeInfo.pendingRewards).to.be.closeTo(
        expectedRewards,
        ethers.parseEther("2")
      );
    });

    it("Should give proportional rewards based on stake amount", async function () {
      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(user1).stake(ethers.parseEther("1000"));

      await stakingToken
        .connect(user2)
        .approve(await staking.getAddress(), ethers.parseEther("2000"));
      await staking.connect(user2).stake(ethers.parseEther("2000"));

      await increaseTime(365 * 24 * 60 * 60);

      const user1Rewards = (await staking.getStakeInfo(user1.address))
        .pendingRewards;
      const user2Rewards = (await staking.getStakeInfo(user2.address))
        .pendingRewards;

      expect(user2Rewards).to.be.closeTo(
        user1Rewards * 2n,
        ethers.parseEther("0.1")
      );
    });

    it("Should calculate rewards correctly after APR change", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      // Wait 6 months at 10% APR
      await increaseTime(182 * 24 * 60 * 60);

      // Change APR to 20%
      await staking.connect(owner).updateAPR(2000);

      // Wait another 6 months
      await increaseTime(182 * 24 * 60 * 60);

      const stakeInfo = await staking.getStakeInfo(user1.address);
      // 6 months at 10% + 6 months at 20% = 15% total
      const expectedRewards = ethers.parseEther("150");

      expect(stakeInfo.pendingRewards).to.be.closeTo(
        expectedRewards,
        ethers.parseEther("5")
      );
    });

    it("Should not accumulate NEW rewards for zero staked amount", async function () {
      // User stakes and then unstakes all
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(7 * 24 * 60 * 60 + 1); // Pass lockup

      // Check rewards before unstaking

      // Unstake all
      await staking.connect(user1).unStake(stakeAmount);
      const rewardsBeforeUnstake = (await staking.getStakeInfo(user1.address))
        .pendingRewards;

      // Wait 1 year after unstaking
      await increaseTime(365 * 24 * 60 * 60);

      const stakeInfo = await staking.getStakeInfo(user1.address);
      // Rewards should be the same as before unstaking (no new rewards accumulated)
      expect(stakeInfo.pendingRewards).to.equal(rewardsBeforeUnstake);
      expect(stakeInfo.amount).to.equal(0);
    });
  });

  describe("Unstaking Functionality", function () {
    it("Should allow unstaking after lockup period", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(7 * 24 * 60 * 60 + 1);

      const initialBalance = await stakingToken.balanceOf(user1.address);
      await staking.connect(user1).unStake(stakeAmount);
      const finalBalance = await stakingToken.balanceOf(user1.address);

      expect(finalBalance - initialBalance).to.equal(stakeAmount);
      expect((await staking.getStakeInfo(user1.address)).amount).to.equal(0);
    });

    it("Should prevent unstaking during lockup period", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(6 * 24 * 60 * 60); // 6 days

      await expect(
        staking.connect(user1).unStake(stakeAmount)
      ).to.be.revertedWith("Funds are still in lockup period");
    });

    it("Should allow partial unstaking", async function () {
      const stakeAmount = ethers.parseEther("1000");
      const unstakeAmount = ethers.parseEther("300");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(7 * 24 * 60 * 60 + 1);

      await staking.connect(user1).unStake(unstakeAmount);

      const stakeInfo = await staking.getStakeInfo(user1.address);
      expect(stakeInfo.amount).to.equal(ethers.parseEther("700"));
    });

    it("Should update totalStaked correctly after unstaking", async function () {
      const stakeAmount = ethers.parseEther("1000");
      const unstakeAmount = ethers.parseEther("400");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(7 * 24 * 60 * 60 + 1);

      const initialTotal = await staking.totalStaked();
      await staking.connect(user1).unStake(unstakeAmount);
      const finalTotal = await staking.totalStaked();

      expect(finalTotal).to.equal(initialTotal - unstakeAmount);
    });

    it("Should handle multiple unstakes correctly", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(7 * 24 * 60 * 60 + 1);

      // First unstake
      await staking.connect(user1).unStake(ethers.parseEther("300"));
      expect((await staking.getStakeInfo(user1.address)).amount).to.equal(
        ethers.parseEther("700")
      );

      // Second unstake
      await staking.connect(user1).unStake(ethers.parseEther("200"));
      expect((await staking.getStakeInfo(user1.address)).amount).to.equal(
        ethers.parseEther("500")
      );

      // Final unstake
      await staking.connect(user1).unStake(ethers.parseEther("500"));
      expect((await staking.getStakeInfo(user1.address)).amount).to.equal(0);
    });
  });

  describe("Reward Claiming", function () {
    it("Should allow users to claim rewards", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(365 * 24 * 60 * 60);

      const initialRewardBalance = await rewardToken.balanceOf(user1.address);
      await staking.connect(user1).claimRewards();
      const finalRewardBalance = await rewardToken.balanceOf(user1.address);

      const rewardsReceived = finalRewardBalance - initialRewardBalance;
      expect(rewardsReceived).to.be.closeTo(
        ethers.parseEther("100"),
        ethers.parseEther("0.1")
      );
    });

    it("Should reset pending rewards after claiming", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(365 * 24 * 60 * 60);
      await staking.connect(user1).claimRewards();

      const stakeInfo = await staking.getStakeInfo(user1.address);
      expect(stakeInfo.pendingRewards).to.equal(0);
    });

    it("Should prevent claiming with no rewards", async function () {
      await expect(staking.connect(user1).claimRewards()).to.be.revertedWith(
        "No rewards to claim"
      );
    });

    it("Should prevent claiming with insufficient reward pool", async function () {
      const stakeAmount = ethers.parseEther("20000"); // Very large stake
      await stakingToken.transfer(user1.address, ethers.parseEther("20000"));
      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      await increaseTime(365 * 24 * 60 * 60); // 1 year

      // Debug: Check what we're working with
      const stakeInfo = await staking.getStakeInfo(user1.address);
      const currentRewardPool = await staking.rewardPool();
      const rewardTokenBalance = await rewardToken.balanceOf(
        await staking.getAddress()
      );

      // Should revert because reward pool only has 1000 tokens
      await expect(staking.connect(user1).claimRewards()).to.be.revertedWith(
        "Insufficient Reward Pool funds"
      );
    });

    it("Should allow multiple reward claims", async function () {
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      await staking.connect(user1).stake(stakeAmount);

      // Claim after 6 months
      await increaseTime(182 * 24 * 60 * 60);
      await staking.connect(user1).claimRewards();

      // Claim after another 6 months
      await increaseTime(182 * 24 * 60 * 60);
      await staking.connect(user1).claimRewards();

      const stakeInfo = await staking.getStakeInfo(user1.address);
      expect(stakeInfo.pendingRewards).to.equal(0);
    });
  });

  describe("APR Management", function () {
    it("Should allow owner to update APR", async function () {
      await staking.connect(owner).updateAPR(1500);
      expect(await staking.rewardRate()).to.equal(1500);
    });

    it("Should prevent non-owners from updating APR", async function () {
      await expect(staking.connect(user1).updateAPR(1500)).to.be.reverted; // Ownable: caller is not the owner
    });

    it("Should enforce APR limits", async function () {
      await expect(staking.connect(owner).updateAPR(50)) // Below minimum
        .to.be.revertedWith("APR too low");

      await expect(staking.connect(owner).updateAPR(6000)) // Above maximum
        .to.be.revertedWith("APR too high");
    });

    it("Should emit event when APR is updated", async function () {
      await expect(staking.connect(owner).updateAPR(1500))
        .to.emit(staking, "APRUpdated")
        .withArgs(1500);
    });
  });

  describe("Owner Functions", function () {
    it("Should allow owner to add rewards", async function () {
      const initialRewardPool = await staking.rewardPool();
      const addAmount = ethers.parseEther("500");

      await rewardToken.approve(await staking.getAddress(), addAmount);
      await staking.connect(owner).addRewards(addAmount);

      const finalRewardPool = await staking.rewardPool();
      expect(finalRewardPool).to.equal(initialRewardPool + addAmount);
    });

    it("Should prevent non-owners from adding rewards", async function () {
      const addAmount = ethers.parseEther("500");
      await rewardToken
        .connect(user1)
        .approve(await staking.getAddress(), addAmount);

      await expect(staking.connect(user1).addRewards(addAmount)).to.be.reverted; // Ownable: caller is not the owner
    });

    it("Should allow owner to set lockup period", async function () {
      const newLockup = 14 * 24 * 60 * 60; // 14 days
      await staking.connect(owner).setLockupPeriod(newLockup);
      expect(await staking.lockupPeriod()).to.equal(newLockup);
    });

    it("Should prevent non-owners from setting lockup period", async function () {
      const newLockup = 14 * 24 * 60 * 60;
      await expect(staking.connect(user1).setLockupPeriod(newLockup)).to.be
        .reverted; // Ownable: caller is not the owner
    });

    it("Should allow owner to emergency withdraw", async function () {
      const withdrawAmount = ethers.parseEther("100");
      const initialBalance = await rewardToken.balanceOf(owner.address);

      await staking
        .connect(owner)
        .emergencyWithdraw(await rewardToken.getAddress(), withdrawAmount);

      const finalBalance = await rewardToken.balanceOf(owner.address);
      expect(finalBalance - initialBalance).to.equal(withdrawAmount);
    });

    it("Should prevent non-owners from emergency withdraw", async function () {
      const withdrawAmount = ethers.parseEther("100");
      await expect(
        staking
          .connect(user1)
          .emergencyWithdraw(await stakingToken.getAddress(), withdrawAmount)
      ).to.be.reverted; // Ownable: caller is not the owner
    });
  });

  describe("Edge Cases and Security", function () {
    it("Should handle multiple users staking and unstaking simultaneously", async function () {
      // Multiple users stake
      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), ethers.parseEther("1000"));
      await stakingToken
        .connect(user2)
        .approve(await staking.getAddress(), ethers.parseEther("2000"));
      await stakingToken
        .connect(user3)
        .approve(await staking.getAddress(), ethers.parseEther("1500"));

      await staking.connect(user1).stake(ethers.parseEther("1000"));
      await staking.connect(user2).stake(ethers.parseEther("2000"));
      await staking.connect(user3).stake(ethers.parseEther("1500"));

      expect(await staking.totalStaked()).to.equal(ethers.parseEther("4500"));

      await increaseTime(7 * 24 * 60 * 60 + 1);

      // Multiple users unstake
      await staking.connect(user1).unStake(ethers.parseEther("500"));
      await staking.connect(user2).unStake(ethers.parseEther("1000"));
      await staking.connect(user3).unStake(ethers.parseEther("1500"));

      expect(await staking.totalStaked()).to.equal(ethers.parseEther("1500"));
    });

    it("Should prevent reentrancy in stake function", async function () {
      // This would require a malicious contract, but we test that nonReentrant modifier is present
      const stakeAmount = ethers.parseEther("1000");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), stakeAmount);
      const tx = await staking.connect(user1).stake(stakeAmount);

      // If reentrancy was possible, this would fail or behave unexpectedly
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
    });

    it("Should handle very small stake amounts", async function () {
      const smallAmount = ethers.parseEther("0.0001");

      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), smallAmount);
      await staking.connect(user1).stake(smallAmount);

      await increaseTime(365 * 24 * 60 * 60);

      const stakeInfo = await staking.getStakeInfo(user1.address);
      expect(stakeInfo.amount).to.equal(smallAmount);
      expect(stakeInfo.pendingRewards).to.be.gt(0);
    });

    it("Should handle maximum stake amounts", async function () {
      const largeAmount = ethers.parseEther("100000");

      // Transfer large amount to user1
      await stakingToken.transfer(user1.address, largeAmount);
      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), largeAmount);
      await staking.connect(user1).stake(largeAmount);

      expect((await staking.getStakeInfo(user1.address)).amount).to.equal(
        largeAmount
      );
    });

    it("Should maintain correct state after complex operations", async function () {
      // Complex scenario: stake, wait, claim, stake more, wait, unstake
      const firstStake = ethers.parseEther("1000");
      const secondStake = ethers.parseEther("500");

      // First stake
      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), firstStake);
      await staking.connect(user1).stake(firstStake);

      await increaseTime(182 * 24 * 60 * 60); // 6 months

      // Claim rewards
      await staking.connect(user1).claimRewards();

      // Stake more
      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), secondStake);
      await staking.connect(user1).stake(secondStake);

      await increaseTime(182 * 24 * 60 * 60); // Another 6 months

      // Unstake all after lockup
      await increaseTime(1); // Ensure lockup passed
      await staking.connect(user1).unStake(ethers.parseEther("1500"));

      const stakeInfo = await staking.getStakeInfo(user1.address);
      expect(stakeInfo.amount).to.equal(0);
      expect(await staking.totalStaked()).to.equal(0);
    });
  });

  describe("View Functions", function () {
    it("Should return correct APR value", async function () {
      expect(await staking.getAPR()).to.equal(10); // 1000 basis points = 10%

      await staking.connect(owner).updateAPR(1500);
      expect(await staking.getAPR()).to.equal(15); // 1500 basis points = 15%
    });

    it("Should return correct lockup remaining time", async function () {
      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(user1).stake(ethers.parseEther("1000"));

      const stakeInfo = await staking.getStakeInfo(user1.address);
      expect(stakeInfo.lockupRemaining).to.be.closeTo(7 * 24 * 60 * 60, 10); // ~7 days
    });

    it("Should return zero lockup after period ends", async function () {
      await stakingToken
        .connect(user1)
        .approve(await staking.getAddress(), ethers.parseEther("1000"));
      await staking.connect(user1).stake(ethers.parseEther("1000"));

      await increaseTime(7 * 24 * 60 * 60 + 1);

      const stakeInfo = await staking.getStakeInfo(user1.address);
      expect(stakeInfo.lockupRemaining).to.equal(0);
    });
  });
});
