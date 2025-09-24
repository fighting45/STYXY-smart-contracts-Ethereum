const hre = require("hardhat");

async function main() {
  const [deployer] = await hre.ethers.getSigners();

  console.log("Deploying contracts with the account:", deployer.address);
  console.log(
    "Account balance:",
    (await deployer.provider.getBalance(deployer.address)).toString()
  );

  const MyToken = await hre.ethers.getContractFactory("MyToken");

  const initialSupply = hre.ethers.parseEther("1000000"); // 1M tokens

  console.log(
    "Deploying MyToken with initial supply:",
    initialSupply.toString()
  );

  const myToken = await MyToken.deploy(initialSupply);

  // Wait for deployment to be mined
  await myToken.waitForDeployment();

  const contractAddress = await myToken.getAddress();

  console.log("\n🎉 Deployment successful!");
  console.log("MyToken deployed to:", contractAddress);
  console.log("Token name:", await myToken.name());
  console.log("Token symbol:", await myToken.symbol());
  console.log("Total supply:", (await myToken.totalSupply()).toString());
  console.log("Decimals:", await myToken.decimals());
  console.log(
    "Owner balance:",
    (await myToken.balanceOf(deployer.address)).toString()
  );

  // Save deployment info
  console.log("\n📝 Contract verification command:");
  console.log(
    `npx hardhat verify --network ${
      hre.network.name
    } ${contractAddress} "${initialSupply.toString()}"`
  );
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("❌ Deployment failed:", error);
    process.exit(1);
  });
