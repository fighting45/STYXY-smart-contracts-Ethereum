# Styxy Smart Contracts

This repository contains Hardhat project having the smart contracts for the **Styxy Token** (STYXY). It includes the contract implementation for an ERC-20 token and the deployment script for deploying and verifying the contract on Ethereum-based networks such as Sepolia.

## Project Overview

- **Contract Name**: `MyToken`
- **Token Name**: Styxy
- **Token Symbol**: STYXY
- **Token Standard**: ERC-20
- **Initial Supply**: 1,000,000 STYXY tokens

This smart contract is based on the OpenZeppelin ERC-20 implementation, ensuring security, scalability, and adherence to best practices.

## Files

### 1. **MyToken.sol**: The ERC-20 token contract

````solidity

This contract inherits from OpenZeppelin’s `ERC20` contract. It mints an initial supply of tokens to the deployer's address.

### 2. **deploy.js**: Deployment Script

The deployment script uses Hardhat's built-in functionality to deploy the contract and verify it. The script deploys the `MyToken` contract with an initial supply of 1,000,000 STYXY tokens.

This script does the following:

- Deploys the contract with an initial supply of 1,000,000 STYXY tokens.
- Waits for the contract deployment to be mined.
- Outputs the contract address, token details (name, symbol, total supply), and the owner's balance.
- Provides the Hardhat verification command for verifying the contract on Etherscan.

## Setup

To get started, follow these steps:

### 1. Clone the repository

Clone this repository to your local machine:

```bash
git clone https://github.com/your-username/styxy-smart-contracts.git
cd styxy-smart-contracts
````

### 2. Install dependencies

Run the following command to install the required dependencies:

```bash
npm install
```

### 3. Configure `.env` file

Create a `.env` file in the root directory and add your sensitive information (Infura/Alchemy API key and wallet private key) for deploying to the Sepolia testnet:

```env
INFURA_PROJECT_ID=your_infura_project_id
PRIVATE_KEY=your_wallet_private_key
ETHERSCAN_API_KEY=your_etherscan_api_key
```

### 4. Deploy the contract

To deploy the contract to the Sepolia testnet, run the following command:

```bash
npx hardhat run scripts/deploy.js --network sepolia
```

Once the deployment is complete, you'll see the contract address, token details, and the verification command.

### 5. Verify the contract on Etherscan (optional)

After deployment, you can verify the contract on Etherscan using the following command:

```bash
npx hardhat verify --network sepolia CONTRACT_ADDRESS "1000000000000000000000000"
```

## Testing the Contract

To test the contract, you can interact with it using Hardhat's `ethers.js` or write custom test scripts under the `test` folder.
