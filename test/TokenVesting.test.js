const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("TokenVesting", function () {
  const DAY = 24 * 60 * 60;
  const CLIFF_DURATION = 30 * DAY;
  const TOTAL_SUPPLY = ethers.parseUnits("1000000", 18);
  const GAS_THRESHOLD_SET = 500000n;
  const GAS_THRESHOLD_RELEASE = 150000n;

  let owner;
  let beneficiary1;
  let beneficiary2;
  let beneficiary3;
  let beneficiary4;
  let beneficiary5;
  let nonBeneficiary;
  let additionalSigners;

  let token;
  let vesting;

  const toTokens = (value) => ethers.parseUnits(value.toString(), 18);

  const getDefaultBeneficiaries = () => [
    beneficiary1.address,
    beneficiary2.address,
    beneficiary3.address,
    beneficiary4.address,
    beneficiary5.address,
  ];

  const getDefaultAllocations = () => [
    toTokens(1000),
    toTokens(2000),
    toTokens(1500),
    toTokens(2500),
    toTokens(1000),
  ];

  const getDefaultTotalAllocation = () =>
    getDefaultAllocations().reduce((acc, value) => acc + value, 0n);

  const getGasUsed = async (txResponse) => {
    const receipt = await txResponse.wait();
    return receipt.gasUsed;
  };

  async function increaseTime(seconds) {
    await ethers.provider.send("evm_increaseTime", [seconds]);
    await ethers.provider.send("evm_mine", []);
  }

  async function configureDefaultBeneficiaries() {
    const addresses = getDefaultBeneficiaries();
    const allocations = getDefaultAllocations();
    const tx = await vesting
      .connect(owner)
      .setBeneficiaries(addresses, allocations);
    await tx.wait();
    return { addresses, allocations };
  }

  async function fundContract(amount) {
    await token.connect(owner).approve(vesting.target, amount);
    const tx = await vesting.connect(owner).fund(amount);
    await tx.wait();
    return tx;
  }

  async function percentOfDefault(totalPercentage) {
    const total = getDefaultTotalAllocation();
    return (total * BigInt(totalPercentage)) / 100n;
  }

  async function setStorageValue(address, slot, value) {
    const paddedValue = ethers.toBeHex(value, 32);
    await ethers.provider.send("hardhat_setStorageAt", [
      address,
      ethers.toBeHex(BigInt(slot), 32),
      paddedValue,
    ]);
  }

  async function findTotalAllocatedSlot(expectedValue) {
    for (let i = 0; i < 100; i += 1) {
      const storageValue = await ethers.provider.getStorage(vesting.target, i);
      if (ethers.toBigInt(storageValue) === expectedValue) {
        return i;
      }
    }
    throw new Error("Unable to locate totalAllocated storage slot");
  }

  beforeEach(async function () {
    [
      owner,
      beneficiary1,
      beneficiary2,
      beneficiary3,
      beneficiary4,
      beneficiary5,
      nonBeneficiary,
      ...additionalSigners
    ] = await ethers.getSigners();

    const tokenFactory = await ethers.getContractFactory("MockERC20");
    token = await tokenFactory.deploy(
      "Vesting Token",
      "VEST",
      owner.address,
      TOTAL_SUPPLY
    );
    await token.waitForDeployment();

    const vestingFactory = await ethers.getContractFactory("TokenVesting");
    vesting = await vestingFactory.deploy(token.target, BigInt(CLIFF_DURATION));
    await vesting.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Should set correct token address", async function () {
      expect(await vesting.token()).to.equal(token.target);
    });

    it("Should set correct cliff duration", async function () {
      expect(await vesting.cliffDuration()).to.equal(BigInt(CLIFF_DURATION));
    });

    it("Should set owner correctly", async function () {
      expect(await vesting.owner()).to.equal(owner.address);
    });

    it("Should initialize with zero startTime", async function () {
      expect(await vesting.startTime()).to.equal(0n);
    });

    it("Should initialize with beneficiariesSet as false", async function () {
      const [, isConfigured] = await vesting.getContractStatus();
      expect(isConfigured).to.equal(false);
    });

    it("Should initialize with paused as false", async function () {
      expect(await vesting.paused()).to.equal(false);
    });

    it("Should reject zero token address in constructor", async function () {
      const vestingFactory = await ethers.getContractFactory("TokenVesting");
      await expect(
        vestingFactory.deploy(ethers.ZeroAddress, BigInt(CLIFF_DURATION))
      ).to.be.rejectedWith("Token address cannot be zero");
    });

    it("Should reject zero cliff duration in constructor", async function () {
      const vestingFactory = await ethers.getContractFactory("TokenVesting");
      await expect(vestingFactory.deploy(token.target, 0)).to.be.rejectedWith(
        "Cliff duration must be greater than zero"
      );
    });
  });

  describe("setBeneficiaries", function () {
    it("Should allow owner to set beneficiaries", async function () {
      const addresses = getDefaultBeneficiaries();
      const allocations = getDefaultAllocations();
      const totalAllocation = getDefaultTotalAllocation();

      const tx = await vesting
        .connect(owner)
        .setBeneficiaries(addresses, allocations);
      await tx.wait();

      expect(await vesting.totalAllocated()).to.equal(totalAllocation);
      expect(await vesting.startTime()).to.be.gt(0n);

      const [, isConfigured] = await vesting.getContractStatus();
      expect(isConfigured).to.equal(true);

      for (let i = 0; i < addresses.length; i += 1) {
        const allocation = await vesting.allocations(addresses[i]);
        expect(allocation).to.equal(allocations[i]);
      }

      const storedBeneficiaries = await vesting.getBeneficiaries();
      expect(storedBeneficiaries).to.deep.equal(addresses);
    });

    it("Should emit VestingScheduleCreated events for each beneficiary", async function () {
      const addresses = getDefaultBeneficiaries();
      const allocations = getDefaultAllocations();

      const tx = await vesting
        .connect(owner)
        .setBeneficiaries(addresses, allocations);

      for (let i = 0; i < addresses.length; i += 1) {
        await expect(tx)
          .to.emit(vesting, "VestingScheduleCreated")
          .withArgs(addresses[i], allocations[i]);
      }
    });

    it("Should prevent non-owner from calling setBeneficiaries", async function () {
      const addresses = getDefaultBeneficiaries();
      const allocations = getDefaultAllocations();

      // Align non-owner access-control tests with OpenZeppelin v5 custom errors.
      // Expect OwnableUnauthorizedAccount with the unauthorized caller address.
      await expect(
        vesting.connect(beneficiary1).setBeneficiaries(addresses, allocations)
      )
        .to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
        .withArgs(beneficiary1.address);
    });

    it("Should prevent calling setBeneficiaries twice", async function () {
      const addresses = getDefaultBeneficiaries();
      const allocations = getDefaultAllocations();

      await vesting.connect(owner).setBeneficiaries(addresses, allocations);

      await expect(
        vesting.connect(owner).setBeneficiaries(addresses, allocations)
      ).to.be.revertedWith("Beneficiaries already configured");
    });

    it("Should reject empty beneficiaries array", async function () {
      await expect(
        vesting.connect(owner).setBeneficiaries([], [])
      ).to.be.revertedWith("Empty beneficiaries array");
    });

    it("Should reject array length mismatch", async function () {
      const addresses = getDefaultBeneficiaries();
      const allocations = getDefaultAllocations().slice(
        0,
        addresses.length - 1
      );

      await expect(
        vesting.connect(owner).setBeneficiaries(addresses, allocations)
      ).to.be.revertedWith("Array length mismatch");
    });

    it("Should reject zero address beneficiary", async function () {
      const addresses = [...getDefaultBeneficiaries()];
      addresses[2] = ethers.ZeroAddress;
      const allocations = getDefaultAllocations();

      await expect(
        vesting.connect(owner).setBeneficiaries(addresses, allocations)
      ).to.be.revertedWith("Zero address beneficiary");
    });

    it("Should reject zero allocation", async function () {
      const addresses = getDefaultBeneficiaries();
      const allocations = getDefaultAllocations();
      allocations[1] = 0n;

      await expect(
        vesting.connect(owner).setBeneficiaries(addresses, allocations)
      ).to.be.revertedWith("Zero allocation");
    });

    it("Should reject duplicate beneficiaries", async function () {
      const addresses = getDefaultBeneficiaries();
      addresses[4] = addresses[0];
      const allocations = getDefaultAllocations();

      await expect(
        vesting.connect(owner).setBeneficiaries(addresses, allocations)
      ).to.be.revertedWith("Duplicate beneficiary");
    });

    it("Should handle single beneficiary", async function () {
      const singleBeneficiary = [beneficiary1.address];
      const singleAllocation = [toTokens(5000)];

      const tx = await vesting
        .connect(owner)
        .setBeneficiaries(singleBeneficiary, singleAllocation);
      await tx.wait();

      expect(await vesting.totalAllocated()).to.equal(singleAllocation[0]);
      expect(await vesting.allocations(beneficiary1.address)).to.equal(
        singleAllocation[0]
      );
      expect(await vesting.getBeneficiaries()).to.deep.equal(singleBeneficiary);
    });

    it("Should handle maximum reasonable number of beneficiaries", async function () {
      const extraNeeded = 15;
      if (additionalSigners.length < extraNeeded) {
        throw new Error("Not enough additional signers for this test");
      }

      const manyBeneficiaries = [
        beneficiary1.address,
        beneficiary2.address,
        beneficiary3.address,
        beneficiary4.address,
        beneficiary5.address,
        ...additionalSigners
          .slice(0, extraNeeded)
          .map((signer) => signer.address),
      ];

      const manyAllocations = manyBeneficiaries.map((_, index) =>
        toTokens(100 + index)
      );

      const totalAllocation = manyAllocations.reduce(
        (acc, value) => acc + value,
        0n
      );

      const tx = await vesting
        .connect(owner)
        .setBeneficiaries(manyBeneficiaries, manyAllocations);
      await tx.wait();

      expect(await vesting.totalAllocated()).to.equal(totalAllocation);
      expect(await vesting.getBeneficiaries()).to.deep.equal(manyBeneficiaries);
    });
  });

  describe("Funding", function () {
    it("Should allow owner to fund contract", async function () {
      await configureDefaultBeneficiaries();
      const totalAllocation = getDefaultTotalAllocation();

      await token.connect(owner).approve(vesting.target, totalAllocation);
      await expect(vesting.connect(owner).fund(totalAllocation))
        .to.emit(vesting, "ContractFunded")
        .withArgs(totalAllocation);

      expect(await token.balanceOf(vesting.target)).to.equal(totalAllocation);
    });

    it("Should allow multiple funding calls", async function () {
      const firstAmount = toTokens(4000);
      const secondAmount = toTokens(4000);
      const total = firstAmount + secondAmount;

      await token.connect(owner).approve(vesting.target, total);

      await fundContract(firstAmount);
      await fundContract(secondAmount);

      expect(await token.balanceOf(vesting.target)).to.equal(total);
    });

    it("Should prevent non-owner from funding", async function () {
      const amount = toTokens(1000);
      await token.connect(owner).approve(vesting.target, amount);

      await expect(vesting.connect(beneficiary1).fund(amount))
        .to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
        .withArgs(beneficiary1.address);
    });

    it("Should reject zero amount funding", async function () {
      await expect(vesting.connect(owner).fund(0)).to.be.revertedWith(
        "Amount must be greater than zero"
      );
    });

    it("Should handle underfunding scenario", async function () {
      await configureDefaultBeneficiaries();
      const underFundAmount = toTokens(5000);

      await fundContract(underFundAmount);

      expect(await token.balanceOf(vesting.target)).to.equal(underFundAmount);
    });

    it("Should handle overfunding scenario", async function () {
      await configureDefaultBeneficiaries();
      const overFundAmount = toTokens(10000);

      await fundContract(overFundAmount);

      expect(await token.balanceOf(vesting.target)).to.equal(overFundAmount);
    });
  });

  describe("Release - Basic Flow", function () {
    it("Should prevent release before beneficiaries are set", async function () {
      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.be.revertedWith("Beneficiaries not configured");
    });

    it("Should prevent release before cliff period", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());

      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.be.revertedWith("Cliff period not reached");
    });

    it("Should allow release after cliff period", async function () {
      const { allocations, addresses } = await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      const beneficiaryAddress = addresses[0];
      const allocation = allocations[0];

      await expect(vesting.connect(owner).release(beneficiaryAddress))
        .to.emit(vesting, "TokensReleased")
        .withArgs(beneficiaryAddress, allocation);

      expect(await token.balanceOf(beneficiaryAddress)).to.equal(allocation);
      expect(await vesting.released(beneficiaryAddress)).to.equal(allocation);
    });

    it("Should prevent release for non-beneficiary", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await expect(
        vesting.connect(owner).release(nonBeneficiary.address)
      ).to.be.revertedWith("Beneficiary has no allocation");
    });

    it("Should prevent double release", async function () {
      const { allocations, addresses } = await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      const beneficiaryAddress = addresses[0];
      const allocation = allocations[0];

      await vesting.connect(owner).release(beneficiaryAddress);

      await expect(
        vesting.connect(owner).release(beneficiaryAddress)
      ).to.be.revertedWith("No tokens to release");

      expect(await token.balanceOf(beneficiaryAddress)).to.equal(allocation);
    });

    it("Should handle multiple beneficiaries releasing", async function () {
      const { addresses, allocations } = await configureDefaultBeneficiaries();
      const totalAllocation = getDefaultTotalAllocation();
      await fundContract(totalAllocation);
      await increaseTime(CLIFF_DURATION + DAY);

      let totalReleased = 0n;

      for (let i = 0; i < addresses.length; i += 1) {
        const tx = await vesting.connect(owner).release(addresses[i]);
        await expect(tx)
          .to.emit(vesting, "TokensReleased")
          .withArgs(addresses[i], allocations[i]);

        const balance = await token.balanceOf(addresses[i]);
        expect(balance).to.equal(allocations[i]);
        totalReleased += allocations[i];
      }

      const contractBalance = await token.balanceOf(vesting.target);
      expect(contractBalance).to.equal(0n);
      expect(totalReleased).to.equal(totalAllocation);
    });

    it("Should prevent release when contract balance insufficient for totalAllocated", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(toTokens(5000));
      await increaseTime(CLIFF_DURATION + DAY);

      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.be.revertedWith(
        "Insufficient contract balance for total allocations"
      );
    });

    it("Should prevent release when specific amount unavailable", async function () {
      await configureDefaultBeneficiaries();
      const totalAllocation = getDefaultTotalAllocation();
      await fundContract(totalAllocation);
      await increaseTime(CLIFF_DURATION + DAY);

      const remainingAmount = toTokens(500);
      const drainAmount = totalAllocation - remainingAmount;

      await owner.sendTransaction({
        to: vesting.target,
        value: ethers.parseEther("1"),
      });

      await ethers.provider.send("hardhat_impersonateAccount", [
        vesting.target,
      ]);
      const vestingSigner = await ethers.getSigner(vesting.target);
      await token.connect(vestingSigner).transfer(owner.address, drainAmount);
      await ethers.provider.send("hardhat_stopImpersonatingAccount", [
        vesting.target,
      ]);

      const totalAllocatedSlot = await findTotalAllocatedSlot(totalAllocation);
      await setStorageValue(
        vesting.target,
        totalAllocatedSlot,
        remainingAmount
      );

      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.be.revertedWith(
        "Insufficient contract balance for total allocations"
      );
    });
  });

  describe("Pause Functionality", function () {
    it("Should allow owner to pause contract", async function () {
      const tx = await vesting.connect(owner).pause();
      await expect(tx).to.emit(vesting, "Paused");
      expect(await vesting.paused()).to.equal(true);
    });

    it("Should prevent non-owner from pausing", async function () {
      await expect(vesting.connect(beneficiary1).pause())
        .to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
        .withArgs(beneficiary1.address);
    });

    it("Should prevent releases when paused", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).pause();

      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.be.revertedWith("Contract is paused");
    });

    it("Should allow owner to unpause contract", async function () {
      await vesting.connect(owner).pause();
      const tx = await vesting.connect(owner).unpause();
      await expect(tx).to.emit(vesting, "Unpaused");
      expect(await vesting.paused()).to.equal(false);
    });

    it("Should allow releases after unpausing", async function () {
      const { addresses, allocations } = await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).pause();

      await expect(
        vesting.connect(owner).release(addresses[0])
      ).to.be.revertedWith("Contract is paused");

      await vesting.connect(owner).unpause();

      await expect(vesting.connect(owner).release(addresses[0]))
        .to.emit(vesting, "TokensReleased")
        .withArgs(addresses[0], allocations[0]);
    });

    it("Should return zero releasableAmount when paused", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).pause();

      expect(await vesting.releasableAmount(beneficiary1.address)).to.equal(0n);
    });
  });

  describe("Revoke Functionality", function () {
    it("Should allow owner to revoke beneficiary", async function () {
      await configureDefaultBeneficiaries();

      const tx = await vesting
        .connect(owner)
        .revokeBeneficiary(beneficiary1.address);
      await expect(tx)
        .to.emit(vesting, "BeneficiaryRevoked")
        .withArgs(beneficiary1.address);

      expect(await vesting.revoked(beneficiary1.address)).to.equal(true);
    });

    it("Should prevent non-owner from revoking", async function () {
      await configureDefaultBeneficiaries();

      await expect(
        vesting.connect(beneficiary2).revokeBeneficiary(beneficiary1.address)
      )
        .to.be.revertedWithCustomError(vesting, "OwnableUnauthorizedAccount")
        .withArgs(beneficiary2.address);
    });

    it("Should prevent revoking non-beneficiary", async function () {
      await configureDefaultBeneficiaries();

      await expect(
        vesting.connect(owner).revokeBeneficiary(nonBeneficiary.address)
      ).to.be.revertedWith("Not a beneficiary");
    });

    it("Should prevent double revocation", async function () {
      await configureDefaultBeneficiaries();

      await vesting.connect(owner).revokeBeneficiary(beneficiary1.address);

      await expect(
        vesting.connect(owner).revokeBeneficiary(beneficiary1.address)
      ).to.be.revertedWith("Already revoked");
    });

    it("Should prevent releases for revoked beneficiary", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).revokeBeneficiary(beneficiary1.address);

      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.be.revertedWith("Beneficiary is revoked");
    });

    it("Should allow other beneficiaries to release when one is revoked", async function () {
      const { addresses, allocations } = await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).revokeBeneficiary(addresses[0]);

      await expect(vesting.connect(owner).release(addresses[1]))
        .to.emit(vesting, "TokensReleased")
        .withArgs(addresses[1], allocations[1]);
    });

    it("Should allow owner to unrevoke beneficiary", async function () {
      await configureDefaultBeneficiaries();

      await vesting.connect(owner).revokeBeneficiary(beneficiary1.address);

      const tx = await vesting
        .connect(owner)
        .unrevokeBeneficiary(beneficiary1.address);
      await expect(tx)
        .to.emit(vesting, "BeneficiaryUnrevoked")
        .withArgs(beneficiary1.address);

      expect(await vesting.revoked(beneficiary1.address)).to.equal(false);
    });

    it("Should allow releases after unrevoking", async function () {
      const { allocations } = await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).revokeBeneficiary(beneficiary1.address);
      await vesting.connect(owner).unrevokeBeneficiary(beneficiary1.address);

      await expect(vesting.connect(owner).release(beneficiary1.address))
        .to.emit(vesting, "TokensReleased")
        .withArgs(beneficiary1.address, allocations[0]);
    });

    it("Should return zero releasableAmount for revoked beneficiary", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).revokeBeneficiary(beneficiary1.address);

      expect(await vesting.releasableAmount(beneficiary1.address)).to.equal(0n);
    });

    it("Should prevent unrevoking non-revoked beneficiary", async function () {
      await configureDefaultBeneficiaries();

      await expect(
        vesting.connect(owner).unrevokeBeneficiary(beneficiary1.address)
      ).to.be.revertedWith("Not revoked");
    });
  });

  describe("View Functions", function () {
    it("Should return correct releasableAmount before cliff", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());

      expect(await vesting.releasableAmount(beneficiary1.address)).to.equal(0n);
    });

    it("Should return correct releasableAmount after cliff", async function () {
      const { allocations } = await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      expect(await vesting.releasableAmount(beneficiary1.address)).to.equal(
        allocations[0]
      );
    });

    it("Should return zero releasableAmount after full release", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).release(beneficiary1.address);

      expect(await vesting.releasableAmount(beneficiary1.address)).to.equal(0n);
    });

    it("Should return correct vesting info", async function () {
      const { allocations } = await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      const info = await vesting.getVestingInfo(beneficiary1.address);
      const storedStartTime = await vesting.startTime();

      expect(info[0]).to.equal(allocations[0]);
      expect(info[1]).to.equal(0n);
      expect(info[2]).to.equal(allocations[0]);
      expect(info[3]).to.equal(storedStartTime + BigInt(CLIFF_DURATION));
      expect(info[4]).to.equal(false);
    });

    it("Should return correct vesting info after partial release", async function () {
      const { allocations } = await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).release(beneficiary1.address);

      const info = await vesting.getVestingInfo(beneficiary1.address);
      expect(info[1]).to.equal(allocations[0]);
      expect(info[2]).to.equal(0n);
    });

    it("Should return correct vesting info for revoked beneficiary", async function () {
      await configureDefaultBeneficiaries();
      await vesting.connect(owner).revokeBeneficiary(beneficiary1.address);

      const info = await vesting.getVestingInfo(beneficiary1.address);
      expect(info[4]).to.equal(true);
    });

    it("Should return correct contract status", async function () {
      await configureDefaultBeneficiaries();
      const totalAllocation = getDefaultTotalAllocation();
      await fundContract(totalAllocation);

      const status = await vesting.getContractStatus();
      expect(status[0]).to.equal(false);
      expect(status[1]).to.equal(true);
      expect(status[2]).to.equal(totalAllocation);
      expect(status[3]).to.equal(totalAllocation);
    });

    it("Should return correct cliff status", async function () {
      await configureDefaultBeneficiaries();

      expect(await vesting.isCliffPassed()).to.equal(false);

      await increaseTime(CLIFF_DURATION + DAY);

      expect(await vesting.isCliffPassed()).to.equal(true);
    });

    it("Should return correct beneficiaries array", async function () {
      const addresses = getDefaultBeneficiaries();
      await vesting
        .connect(owner)
        .setBeneficiaries(addresses, getDefaultAllocations());

      expect(await vesting.getBeneficiaries()).to.deep.equal(addresses);
    });
  });

  describe("Edge Cases and Integration", function () {
    it("Should handle cliff exactly at boundary", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION);

      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.emit(vesting, "TokensReleased");
    });

    it("Should handle very large allocations", async function () {
      const addresses = [beneficiary1.address, beneficiary2.address];
      const allocations = [toTokens(500000), toTokens(300000)];
      const total = allocations[0] + allocations[1];

      await vesting.connect(owner).setBeneficiaries(addresses, allocations);
      await fundContract(total);
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).release(addresses[0]);
      await vesting.connect(owner).release(addresses[1]);

      expect(await token.balanceOf(addresses[0])).to.equal(allocations[0]);
      expect(await token.balanceOf(addresses[1])).to.equal(allocations[1]);
    });

    it("Should handle very small allocations", async function () {
      const addresses = [beneficiary1.address, beneficiary2.address];
      const allocations = [1n, 1n];

      await vesting.connect(owner).setBeneficiaries(addresses, allocations);
      await fundContract(allocations[0] + allocations[1]);
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).release(addresses[0]);
      await vesting.connect(owner).release(addresses[1]);

      expect(await token.balanceOf(addresses[0])).to.equal(allocations[0]);
      expect(await token.balanceOf(addresses[1])).to.equal(allocations[1]);
    });

    it("Should maintain correct state with complex operations", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());

      await vesting.connect(owner).pause();
      await increaseTime(CLIFF_DURATION + DAY);
      await vesting.connect(owner).unpause();

      await vesting.connect(owner).revokeBeneficiary(beneficiary1.address);
      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.be.revertedWith("Beneficiary is revoked");

      await vesting.connect(owner).unrevokeBeneficiary(beneficiary1.address);
      await vesting.connect(owner).release(beneficiary2.address);

      expect(await vesting.revoked(beneficiary1.address)).to.equal(false);
      expect(await token.balanceOf(beneficiary2.address)).to.equal(
        toTokens(2000)
      );
    });

    it("Should handle scenario: set, fund, pause, revoke, unpause, release", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());

      await vesting.connect(owner).pause();
      await vesting.connect(owner).revokeBeneficiary(beneficiary3.address);
      await increaseTime(CLIFF_DURATION + DAY);
      await vesting.connect(owner).unpause();

      await expect(
        vesting.connect(owner).release(beneficiary3.address)
      ).to.be.revertedWith("Beneficiary is revoked");

      await vesting.connect(owner).unrevokeBeneficiary(beneficiary3.address);

      await expect(
        vesting.connect(owner).release(beneficiary3.address)
      ).to.emit(vesting, "TokensReleased");
    });

    it("Should prevent reentrancy in release function", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(owner).release(beneficiary1.address);

      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.be.revertedWith("No tokens to release");
    });

    it("Should handle multiple beneficiaries with same allocation", async function () {
      const extra = additionalSigners
        .slice(0, 2)
        .map((signer) => signer.address);
      const addresses = [
        beneficiary1.address,
        beneficiary2.address,
        beneficiary3.address,
        ...extra,
      ];
      const allocations = addresses.map(() => toTokens(1000));
      const total = allocations.reduce((acc, value) => acc + value, 0n);

      await vesting.connect(owner).setBeneficiaries(addresses, allocations);
      await fundContract(total);
      await increaseTime(CLIFF_DURATION + DAY);

      for (let i = 0; i < addresses.length; i += 1) {
        await vesting.connect(owner).release(addresses[i]);
        expect(await token.balanceOf(addresses[i])).to.equal(allocations[i]);
      }
    });

    it("Should handle beneficiary releasing for themselves vs others calling", async function () {
      const { addresses, allocations } = await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      await vesting.connect(beneficiary1).release(addresses[0]);
      await vesting.connect(owner).release(addresses[1]);
      await vesting.connect(beneficiary3).release(addresses[3]);

      expect(await token.balanceOf(addresses[0])).to.equal(allocations[0]);
      expect(await token.balanceOf(addresses[1])).to.equal(allocations[1]);
      expect(await token.balanceOf(addresses[3])).to.equal(allocations[3]);
    });

    it("Should correctly calculate cliff end time", async function () {
      const { addresses } = await configureDefaultBeneficiaries();
      const startBlock = await ethers.provider.getBlock("latest");
      const recordedStartTime = await vesting.startTime();
      expect(recordedStartTime).to.equal(BigInt(startBlock.timestamp));

      const info = await vesting.getVestingInfo(addresses[0]);
      expect(info[3]).to.equal(recordedStartTime + BigInt(CLIFF_DURATION));
    });

    it("Should handle zero balance scenario gracefully", async function () {
      await configureDefaultBeneficiaries();
      await increaseTime(CLIFF_DURATION + DAY);

      await expect(
        vesting.connect(owner).release(beneficiary1.address)
      ).to.be.revertedWith(
        "Insufficient contract balance for total allocations"
      );
    });
  });

  describe("Gas Optimization Verification", function () {
    it("Should use reasonable gas for setBeneficiaries with 5 beneficiaries", async function () {
      const addresses = getDefaultBeneficiaries();
      const allocations = getDefaultAllocations();
      const tx = await vesting
        .connect(owner)
        .setBeneficiaries(addresses, allocations);
      const gasUsed = await getGasUsed(tx);
      expect(gasUsed).to.be.lessThan(GAS_THRESHOLD_SET);
    });

    it("Should use reasonable gas for release", async function () {
      await configureDefaultBeneficiaries();
      await fundContract(getDefaultTotalAllocation());
      await increaseTime(CLIFF_DURATION + DAY);

      const tx = await vesting.connect(owner).release(beneficiary1.address);
      const gasUsed = await getGasUsed(tx);
      expect(gasUsed).to.be.lessThan(GAS_THRESHOLD_RELEASE);
    });

    it("Should benefit from calldata optimization in setBeneficiaries", async function () {
      const addresses = getDefaultBeneficiaries();
      const allocations = getDefaultAllocations();
      const estimate = await vesting
        .connect(owner)
        .setBeneficiaries.estimateGas(addresses, allocations);

      expect(estimate).to.be.lessThan(GAS_THRESHOLD_SET);
    });
  });
});
