const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("🚀 Starting combined deployment...");
  console.log("Deploying contracts with account:", deployer.address);
  console.log(
    "Account balance:",
    (await deployer.provider.getBalance(deployer.address)).toString()
  );

  // ======================
  // 1. Deploy ERC20 Token
  // ======================

  console.log("\n📄 Step 1: Deploying MyToken (ERC20)...");

  const MyToken = await hre.ethers.getContractFactory("MyToken");
  const initialSupply = hre.ethers.parseEther("1000000000"); // 1B tokens

  const myToken = await MyToken.deploy(initialSupply);
  await myToken.waitForDeployment();

  const tokenAddress = await myToken.getAddress();

  console.log("✅ Styxy deployed to:", tokenAddress);
  console.log("Token name:", await myToken.name());
  console.log("Token symbol:", await myToken.symbol());
  console.log("Total supply:", (await myToken.totalSupply()).toString());

  // =========================
  // 2. Deploy Staking Contract
  // =========================

  console.log("\n🥩 Step 2: Deploying TokenStaking contract...");

  const TokenStaking = await hre.ethers.getContractFactory("TokenStaking");

  const stakingContract = await TokenStaking.deploy(
    tokenAddress, // Staking token (MyToken)
    tokenAddress, // Reward token (same MyToken)
    hre.ethers.parseEther("0.01"), // 1 tokens per second per token staked
    5 // 5 sec lockup period
  );

  await stakingContract.waitForDeployment();
  const stakingAddress = await stakingContract.getAddress();

  console.log("✅ TokenStaking deployed to:", stakingAddress);
  console.log("Staking token:", tokenAddress);
  console.log("Reward token:", tokenAddress);
  console.log("Reward rate: 0.01 tokens per second per token staked");
  console.log("Lockup period: 1 day");

  // ===========================
  // 3. Setup Initial Rewards
  // ===========================

  console.log("\n💰 Step 3: Adding initial rewards to staking contract...");

  const rewardAmount = hre.ethers.parseEther("1000000"); // 1M tokens as rewards

  // Approve staking contract to spend tokens
  console.log("Approving staking contract to spend tokens...");
  await myToken.approve(stakingAddress, rewardAmount);

  // Add rewards to staking contract
  console.log("Adding rewards to staking pool...");
  await stakingContract.addRewards(rewardAmount);

  console.log("Reading reward pool");
  const rewardPool = await stakingContract.rewardPool();
  console.log("✅ Reward pool balance:", rewardPool.toString());

  // =====================
  // 4. Final Summary
  // =====================

  console.log("\n🎉 DEPLOYMENT COMPLETE!");
  console.log("=".repeat(50));
  console.log("MyToken Address:", tokenAddress);
  console.log("Staking Address:", stakingAddress);
  console.log("Owner:", deployer.address);
  console.log(
    "Owner Token Balance:",
    (await myToken.balanceOf(deployer.address)).toString()
  );
  console.log("Staking Reward Pool:", rewardPool.toString());

  // Calculate APR
  try {
    const apr = await stakingContract.getAPR();
    console.log("Current APR:", apr.toString() + "%");
  } catch (error) {
    console.log("APR: 0% (no tokens staked yet)");
  }

  console.log("\n📝 Contract Verification Commands:");
  console.log("-".repeat(50));
  console.log(
    `MyToken: npx hardhat verify --network ${
      hre.network.name
    } ${tokenAddress} "${initialSupply.toString()}"`
  );
  console.log(
    `Staking: npx hardhat verify --network ${
      hre.network.name
    } ${stakingAddress} "${tokenAddress}" "${tokenAddress}" "${hre.ethers.parseEther(
      "0.01"
    )}" "86400"`
  );

  console.log("\n🔧 Next Steps:");
  console.log("-".repeat(50));
  console.log("1. Verify contracts on Etherscan (commands above)");
  console.log("2. Users can now:");
  console.log("   - Approve staking contract to spend their tokens");
  console.log("   - Stake tokens and earn rewards");
  console.log("   - Check rewards and unstake after lockup period");

  console.log("\n📊 Contract Interaction Examples:");
  console.log("-".repeat(50));
  console.log("// Approve staking contract");
  console.log(`await myToken.approve("${stakingAddress}", amount);`);
  console.log("\n// Stake tokens");
  console.log(`await stakingContract.stake(amount);`);
  console.log("\n// Check stake info");
  console.log(`await stakingContract.getStakeInfo(userAddress);`);
  console.log("\n// Claim rewards");
  console.log(`await stakingContract.claimRewards();`);
  console.log("\n// Unstake tokens");
  console.log(`await stakingContract.unstake(amount);`);

  return {
    tokenAddress,
    stakingAddress,
    deployer: deployer.address,
  };
}

main()
  .then((result) => {
    console.log("\n✅ All contracts deployed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
