import { createPublicClient, http, Address, getCreateAddress, createWalletClient, toHex, hexToBytes, keccak256 } from 'viem';
import { arbitrum, foundry, mainnet, polygon } from 'viem/chains';
import KMSAdapterABI from '../artifacts/KMSAdapter.json';
import { hdKeyToAccount, privateKeyToAccount, HDKey} from 'viem/accounts';
import { Agent, IAgent } from '../db/models';
import logger from '../logger';
import { PRIVATE_KEY, REL_CHAIN, RPC_URL } from '../config';
import { KmsDeployError } from './errors';

export const relayerAccount = privateKeyToAccount(PRIVATE_KEY as `0x${string}`);

const chains = {
  polygon,
  mainnet,
  arbitrum,
  foundry,
};

// Validate configuration
const chain = chains[REL_CHAIN as keyof typeof chains];
if (!chain) {
  throw new Error(`Invalid chain: ${REL_CHAIN}`);
}

export const publicClient = createPublicClient({
  chain: chain,
  transport: http(RPC_URL)
});

// Create a mainnet client for reading DeleGate contract (which is on Ethereum mainnet)
// export const mainnetPublicClient = createPublicClient({
//   chain: mainnet,
//   transport: http('https://eth.llamarpc.com') // Use a public RPC for mainnet
// });

export const walletClient = createWalletClient({
  chain: chain,
  transport: http(RPC_URL),
  account: relayerAccount,
});

export async function getKmsAddress(address: Address): Promise<Address> {
  // Get the current nonce of the deployer
  const nonce = await publicClient.getTransactionCount({
    address
  });
  
  // Use Viem's utility for standard CREATE opcode address prediction
  const predictedAddress = getCreateAddress({
    from: address,
    nonce: BigInt(nonce)
  });
  
  return predictedAddress;
}

/**
 * Deploy a KMS Adapter using Viem
 * @param keyringGateway - Address of the KeyringGateway contract
 * @param delegateContract - Address of the DeleGate contract
 * @returns Address of the deployed KMS Adapter
 */
export async function deployKmsAdapter(keyringGateway: Address, delegateContract: Address): Promise<Address> {
  try {
    console.log(`Deploying KMS adapter for KeyringGateway: ${keyringGateway} and DeleGate: ${delegateContract}`);
    
    // Get the KMSAdapter bytecode from your artifacts
    const bytecode = KMSAdapterABI.bytecode.object as `0x${string}`;
    
    // Deploy the contract using Viem
    const hash = await walletClient.deployContract({
      abi: KMSAdapterABI.abi,
      bytecode,
      args: [keyringGateway, delegateContract]
    });
    
    console.log(`Contract deployment transaction sent: ${hash}`);
    
    // Wait for transaction confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    
    // Get the deployed contract address
    const contractAddress = receipt.contractAddress;
    
    if (!contractAddress) {
      throw new Error('Failed to deploy KMS adapter - no contract address in receipt');
    }
    
    console.log(`KMS Adapter successfully deployed at: ${contractAddress}`);
    return contractAddress;
    
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error deploying KMS Adapter:', error.message);
      throw new KmsDeployError(error.name, error.message);
    } else {
      console.error('Unknown error deploying KMS Adapter:', error);
      throw error;
    }
  }
}

/**
 * Derives a deterministic HD account from an address using a consistent seed
 * @param {Address} address - The address to derive the account from
 * @returns {import('viem').HDAccount} The derived HD account
 */
export const getAgentAccountFromAddress = (address: Address, salt: string = "YOUR_SECURE_SALT"): ReturnType<typeof hdKeyToAccount> => {
  const addressBytes = hexToBytes(address);
  const saltBytes = new TextEncoder().encode(salt);
  
  // Combine and hash for better security
  const combinedBytes = new Uint8Array([...saltBytes, ...addressBytes]);
  const seed = keccak256(combinedBytes);
  
  const hdKey = HDKey.fromMasterSeed(hexToBytes(seed));
  
  // Use a more standardized derivation path
  return hdKeyToAccount(hdKey, {
    accountIndex: 1,
    addressIndex: 0
  });
};

/**
 * Get all agents associated with a specific user address
 */
export async function getAgentsByUserAddress(userAddress: string): Promise<IAgent[]> {
  try {
    const agents = await Agent.find({ 
      userAddress, 
      active: true 
    });
    
    return agents;
  } catch (error) {
    logger.error(`Failed to get agents by user address: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}