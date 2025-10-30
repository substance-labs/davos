import { ethers } from 'ethers';
import { KEYRING_GATEWAY_POLYGON } from './config';
import { createPublicClient, http } from 'viem';
import { polygon } from 'viem/chains';
import logger from './logger';
import KeyringGatewayABI from './artifacts/KeyringGateway.json';
import GovernorABI from './artifacts/Governor.json';
import { getAgentByKmsAddress } from './db/service';
import { Address } from 'viem';
import { TallyVoteParams } from './types';
import { inspect } from 'util';


const TALLY_RPC_URL = process.env.TALLY_RPC_URL || '';
const provider = new ethers.providers.JsonRpcProvider(TALLY_RPC_URL);

// Separate public client for Tally events on Polygon
const tallyPublicClient = createPublicClient({
  chain: polygon,
  transport: http(TALLY_RPC_URL),
});

/**
 * Submit a Tally vote by calling Governor.castVote() on-chain
 * @param signer The wallet address of the voter
 * @param voteParams Tally vote parameters including governorAddress, proposalId, and support
 */
export const tallyVote = async (signer: Address, voteParams: TallyVoteParams) => {
  try {
    // Validate inputs
    if (!signer || signer === '0x0000000000000000000000000000000000000000') {
      throw new Error('Invalid signer address');
    }

    if (!voteParams.governorAddress || voteParams.governorAddress === '0x0000000000000000000000000000000000000000') {
      throw new Error('Invalid governor address');
    }

    if (!voteParams.proposalId) {
      throw new Error('Missing proposal ID');
    }

    if (voteParams.support > 2) {
      throw new Error('Invalid support value (must be 0, 1, or 2)');
    }

    const agent = await getAgentByKmsAddress(signer);

    if (!agent) {
      logger.error(`Agent not found for signer: ${signer}`);
      throw new Error('Agent not found. Please configure your voting agent.');
    }

    const wallet = new ethers.Wallet(agent.privateKey, provider);
    
    logger.info(`Wallet: ${wallet.address}`);
    logger.info(`Agent: ${agent.address}`);
    logger.info(`Governor: ${voteParams.governorAddress}`);
    logger.info(`Proposal ID: ${voteParams.proposalId}`);
    logger.info(`Support: ${voteParams.support} (0=Against, 1=For, 2=Abstain)`);

    // Initialize Governor contract
    const governor = new ethers.Contract(
      voteParams.governorAddress,
      GovernorABI as any,
      wallet
    );

    // Convert proposalId to BigNumber if needed
    const proposalIdBN = ethers.BigNumber.from(voteParams.proposalId);
    const support = ethers.BigNumber.from(voteParams.support);

    // Check proposal state first
    let proposalState;
    try {
      proposalState = await governor.state(proposalIdBN);
      logger.info(`Proposal state: ${proposalState} (1=Active)`);
      
      // State 1 = Active
      if (proposalState !== 1) {
        throw new Error(`Proposal is not in active voting state (current state: ${proposalState})`);
      }
    } catch (error) {
      if ((error as any).message?.includes('not in active voting')) {
        throw error;
      }
      logger.warn(`Could not verify proposal state: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Check if already voted
    try {
      const hasVoted = await governor.hasVoted(proposalIdBN, wallet.address);
      if (hasVoted) {
        throw new Error('You have already voted on this proposal');
      }
      logger.info('✓ Voter eligibility confirmed');
    } catch (error) {
      if ((error as any).message?.includes('already voted')) {
        throw error;
      }
      logger.warn(`Could not verify voting status: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Get voting power
    try {
      const snapshot = await governor.proposalSnapshot(proposalIdBN);
      const votingPower = await governor.getVotes(wallet.address, snapshot);
      
      if (votingPower.isZero()) {
        throw new Error('Insufficient voting power to vote on this proposal');
      }
      logger.info(`Voting power: ${votingPower.toString()}`);
    } catch (error) {
      if ((error as any).message?.includes('Insufficient')) {
        throw error;
      }
      logger.warn(`Could not verify voting power: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Estimate gas before sending
    let gasEstimate;
    try {
      if (voteParams.reason) {
        gasEstimate = await governor.estimateGas.castVoteWithReason(
          proposalIdBN,
          support,
          voteParams.reason
        );
        logger.info(`Gas estimate for castVoteWithReason: ${gasEstimate.toString()}`);
      } else {
        gasEstimate = await governor.estimateGas.castVote(
          proposalIdBN,
          support
        );
        logger.info(`Gas estimate for castVote: ${gasEstimate.toString()}`);
      }
    } catch (error) {
      logger.warn(`Gas estimation failed: ${error instanceof Error ? error.message : String(error)}`);
      // Continue anyway with default gas
    }

    // Submit vote on-chain
    let tx;
    if (voteParams.reason) {
      logger.info(`Submitting vote with reason: "${voteParams.reason}"`);
      tx = await governor.castVoteWithReason(
        proposalIdBN,
        support,
        voteParams.reason,
        { gasLimit: gasEstimate ? gasEstimate.mul(120).div(100) : undefined } // 20% buffer
      );
    } else {
      logger.info(`Submitting vote without reason`);
      tx = await governor.castVote(
        proposalIdBN,
        support,
        { gasLimit: gasEstimate ? gasEstimate.mul(120).div(100) : undefined } // 20% buffer
      );
    }

    logger.info(`Vote transaction submitted: ${tx.hash}`);

    // Wait for transaction confirmation
    const receipt = await tx.wait(1);
    
    if (receipt.status === 0) {
      throw new Error('Transaction failed on-chain');
    }

    logger.info(`Vote transaction confirmed in block ${receipt.blockNumber}`);
    logger.info(`Transaction receipt: ${JSON.stringify({
      transactionHash: receipt.transactionHash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      status: receipt.status === 1 ? 'success' : 'failed'
    }, null, 2)}`);

    return receipt;
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`Error voting on Tally: ${error.message}`);
      logger.error(`Stack: ${error.stack}`);
    } else {
      logger.error(`Error voting on Tally: ${JSON.stringify(error, null, 2)}`);
    }
    
    logger.error('Error details:');
    logger.error(inspect(error, { depth: null, colors: false }));
    
    throw error;
  }
};

let eventWatcher: any = null;

/**
 * Watch for Tally vote events from the Keyring Gateway contract
 */
export async function watchTallyEvents(): Promise<void> {
  logger.info(`Starting Tally event watcher on ${TALLY_RPC_URL}\nGateway address: ${KEYRING_GATEWAY_POLYGON}`);
  
  try {
    eventWatcher = tallyPublicClient.watchContractEvent({
      address: KEYRING_GATEWAY_POLYGON,
      abi: KeyringGatewayABI.abi,
      eventName: 'tallySignVote',
      onLogs: (logs: any) => {
        logs.forEach((log: any) => {
          try {
            const { args } = log as any;
            logger.info(`Received Tally vote event with args:`, args);
            if (args) {
              logger.info(`Sender: ${args.sender}`);
              logger.info(`Vote params: ${JSON.stringify(args.vote, null, 2)}`);
              tallyVote(args.sender, args.vote);
            }
          } catch (error) {
            logger.error(`Error handling Tally vote event: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      },
    });
    
    logger.info('Tally event watcher started successfully');
    return Promise.resolve();
  } catch (error) {
    logger.error(`Failed to start Tally event watcher: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Unwatch Tally events (for cleanup)
 */
export function stopTallyEvents(): void {
  if (eventWatcher) {
    logger.info('Stopping Tally event watcher');
    eventWatcher();
    eventWatcher = null;
  }
}

// Keeping the original main function for backward compatibility
// This allows running the file directly if needed
if (require.main === module) {
  const main = async () => {
    try {
      await watchTallyEvents();
      
      // Keep the process running
      process.stdin.resume();
    } catch (error) {
      logger.error(`Failed to start Tally voter: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  };

  main();
}
