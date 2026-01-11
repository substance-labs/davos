import { SnapshotProposal, TallyProposal, TallyVoteParams, ProposalType } from './types';
import snapshot from '@snapshot-labs/snapshot.js';
import { RPC_URL, DELEGATE_CONTRACT_ADDRESS, VOTE_POLLER_INTERVAL, VOTE_MIN_BEFORE_END } from './config';
import { getAgentsForSpace, scheduleVoteInDb, getPendingVotes, markVoteCompleted, markVoteFailed, getVoteDetailsByAgentAddress } from './db/service';
import logger from './logger';
import { IAgent, IScheduledVote } from './db/models';
import { publicClient, walletClient, relayerAccount } from './lib/utils';
import { polygon } from 'viem/chains';
import DeleGateABI from './artifacts/DeleGate.json';
import { ethers } from 'ethers';
import GovernorABI from './artifacts/Governor.json';
import { inspect } from 'util';

const hub = 'https://hub.snapshot.org'; 
const client = new snapshot.Client712(hub);

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

/**
 * Convert string vote choice to numeric value for Snapshot
 * Snapshot uses 1-indexed choices based on the proposal's choices array
 * @param voteChoice The vote choice as string ("yes", "no", or "abstain")
 * @param proposalChoices The available choices from the proposal (e.g., ["YAE", "NAY", "Abstain"])
 * @returns The numeric vote value (1-indexed based on matching choice)
 */
export function convertVoteChoice(voteChoice: string, proposalChoices: string[]): number {
  const normalizedChoice = voteChoice.toLowerCase().trim();
  
  // Define patterns for matching yes/no/abstain to various choice labels
  const yesPatterns = ['yes', 'yae', 'yea', 'for', 'approve', 'support', 'aye'];
  const noPatterns = ['no', 'nay', 'against', 'reject', 'oppose', 'disapprove'];
  const abstainPatterns = ['abstain', 'neutral', 'pass'];
  
  // Determine which pattern category the vote choice falls into
  let targetPatterns: string[];
  if (yesPatterns.includes(normalizedChoice)) {
    targetPatterns = yesPatterns;
  } else if (noPatterns.includes(normalizedChoice)) {
    targetPatterns = noPatterns;
  } else if (abstainPatterns.includes(normalizedChoice)) {
    targetPatterns = abstainPatterns;
  } else {
    throw new Error(`Invalid vote choice: "${voteChoice}". Must be "yes", "no", or "abstain"`);
  }
  
  // Find the matching choice in the proposal's choices array
  for (let i = 0; i < proposalChoices.length; i++) {
    const choiceLabel = proposalChoices[i].toLowerCase().trim();
    if (targetPatterns.some(pattern => choiceLabel.includes(pattern) || pattern.includes(choiceLabel))) {
      // Snapshot uses 1-indexed choices
      console.debug(`Matched vote "${voteChoice}" to proposal choice "${proposalChoices[i]}" (index ${i + 1})`);
      return i + 1;
    }
  }
  
  // Fallback: if no match found, throw an error with available choices
  throw new Error(
    `Could not match vote choice "${voteChoice}" to any available proposal choices: [${proposalChoices.join(', ')}]`
  );
}

/**
 * Convert string vote choice to numeric value for Tally (on-chain) voting
 * Tally uses standard Governor contract convention: 0 = Against, 1 = For, 2 = Abstain
 * @param voteChoice The vote choice as string ("yes", "no", or "abstain")
 * @returns The numeric vote value (0 = Against, 1 = For, 2 = Abstain)
 */
export function convertTallyVoteChoice(voteChoice: string): number {
  const normalizedChoice = voteChoice.toLowerCase().trim();

  switch (normalizedChoice) {
    case 'yes':
      return 1; // For
    case 'no':
      return 0; // Against
    case 'abstain':
      return 2; // Abstain
    default:
      throw new Error(`Invalid vote choice: "${voteChoice}". Must be "yes", "no", or "abstain"`);
  }
}

/**
 * Processes proposals and schedules votes at the appropriate time
 */
export async function processProposalsForVoting(
  proposals: SnapshotProposal[],
  spaceId: string,
  source: 'snapshot' | 'tally' = 'snapshot',
  governorAddress?: string
): Promise<void> {
  logger.info(`Processing ${proposals.length} proposals for ${spaceId}`);
  
  // Get all agents for this space
  const agentsForSpace = await getAgentsForSpace(spaceId);
  
  if (agentsForSpace.length === 0) {
    logger.warn(`No agents found for space ${spaceId}, skipping proposals`);
    return;
  }
  
  logger.info(`Found ${agentsForSpace.length} agents for space ${spaceId}`);
  
  for (const proposal of proposals) {
    try {
      // Calculate when to vote (VOTE_MIN_BEFORE_END minutes before proposal ends)
      const proposalEndTimeMs = proposal.end * 1000; // Convert to milliseconds
      logger.info(`Minutes before end to vote: ${VOTE_MIN_BEFORE_END}`);
      const voteTimeMs = proposalEndTimeMs - (VOTE_MIN_BEFORE_END * 60 * 1000);
      const currentTimeMs = Date.now();
      
      // Format dates for logging
      const endTimeFormatted = new Date(proposalEndTimeMs).toISOString();
      const voteTimeFormatted = new Date(voteTimeMs).toISOString();
      
      logger.info(`Proposal: ${proposal.title} (${proposal.id})`);
      logger.info(`End time: ${endTimeFormatted}`);
      logger.info(`Target vote time: ${voteTimeFormatted}`);
      
      // For each agent, schedule a vote
      for (const { agent } of agentsForSpace) {
        if (voteTimeMs <= currentTimeMs) {
          // If vote time has already passed but proposal hasn't ended, vote now
          if (currentTimeMs < proposalEndTimeMs) {
            logger.info(`Vote time already passed, voting immediately for agent ${agent.name}`);
            
            // Route to correct voting function based on source
            if (source === 'tally') {
              if (!governorAddress) {
                throw new Error('Governor address required for Tally proposals');
              }
              await castTallyVote(proposal.id, governorAddress, agent.privateKey, agent.address);
            } else {
              // Snapshot voting
              // if (!agent.userAddress) {
              //   throw new Error(`User address not found for agent ${agent.name}`);
              // }
              await castSnapshotVote(proposal, agent.address, agent.privateKey,);
            }
          } else {
            logger.info(`Proposal has already ended, skipping for agent ${agent.name}`);
          }
        } else {
          // Schedule the vote in the database for the future
          const scheduledTime = new Date(voteTimeMs);
          const delayMinutes = Math.round((voteTimeMs - currentTimeMs) / (60 * 1000));
          
          logger.info(`  Scheduling vote in ${delayMinutes} minutes for agent ${agent.name}`);
          await scheduleVoteInDb(proposal, agent, scheduledTime, source, governorAddress);
        }
      }
    } catch (error) {
      logger.error(`Failed to process proposal ${proposal.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/**
 * Starts a polling service to check for and execute pending votes
 */
export function startVotePollingService(): void {
  logger.debug('Starting vote polling service');
  
  // Check for pending votes every minute (or configure as needed)
  setInterval(async () => {
    await executeScheduledVotes();
  }, VOTE_POLLER_INTERVAL);
  
  // Execute immediately on startup
  executeScheduledVotes().catch(err => {
    logger.error(`Error on initial vote execution: ${err}`);
  });
}

/**
 * Executes all pending scheduled votes
 */
async function executeScheduledVotes(): Promise<void> {
  const pendingVotes = await getPendingVotes();
  
  if (pendingVotes.length === 0) {
    return;
  }
  
  logger.info(`Found ${pendingVotes.length} pending votes to execute`);
  
  for (const vote of pendingVotes) {
    try {
      const agent = vote.agentId as unknown as IAgent;

      if (!agent.userAddress) {
        throw new Error(`Agent not found for vote ${vote._id}`);
      }
      
      logger.info(`Executing scheduled vote for proposal: ${vote.proposalTitle} (${vote.proposalId}) for agent ${agent.name}`);
      
      // Route to correct voting function based on source
      if (vote.source === 'tally') {
        // Tally on-chain voting
        if (!vote.governorAddress) {
          throw new Error('Governor address required for Tally proposals');
        }
        await castTallyVote(vote.proposalId, vote.governorAddress, agent.privateKey, agent.address);
      } else {
        // Snapshot voting (default for backwards compatibility)
        const proposal: SnapshotProposal = {
          id: vote.proposalId,
          title: vote.proposalTitle,
          space: {
            id: vote.spaceId,
            name: vote.spaceId,
          }
        } as SnapshotProposal;
        
        await castSnapshotVote(proposal, agent.address, agent.privateKey);
      }
      
      await markVoteCompleted((vote._id as any).toString());
      
      logger.info(`Vote for proposal ${vote.proposalId} successfully executed`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to execute vote: ${errorMessage}`);
      await markVoteFailed((vote._id as any).toString(), errorMessage);
    }
  }
}

/**
 * Casts a vote on a proposal using the DeleGate contract
 * FOR SNAPSHOT ONLY - unchanged to preserve existing functionality
 */
export async function castSnapshotVote(
  proposal: SnapshotProposal,
  agentAddress: string,
  agentPrivateKey: string,
): Promise<void> {
  try {
    // Use the proposal's actual type, fallback to 'single-choice' for backward compatibility
    const voteType: ProposalType = proposal.type || 'single-choice';
    const voteDetails = await getVoteDetailsByAgentAddress(agentAddress, proposal.id);

    if (!voteDetails) {
      throw new Error(`Vote details not found for agent ${agentAddress} and proposal ${proposal.id}`);
    }

    const wallet = new ethers.Wallet(agentPrivateKey, provider);

    console.debug(`wallet: ${wallet.address}`);
    console.debug(`agent: ${agentAddress}`);

    // Convert proposal ID to hex and pad to 64 characters (32 bytes) to ensure even-length
    const proposalHexRaw = BigInt(String(proposal.id).replace(/n$/, '')).toString(16);
    const proposalHex = "0x" + proposalHexRaw.padStart(64, '0');
    console.debug('proposalHex: ', proposalHex)
    console.debug('voteType: ', voteType)
    
    // Get proposal choices - prefer stored choices from voteDetails, fallback to proposal.choices
    const proposalChoices = voteDetails.proposalChoices || proposal.choices || ['For', 'Against', 'Abstain'];
    console.debug('proposal choices: ', proposalChoices)
    const choiceIndex = convertVoteChoice(voteDetails.aiVoteChoice, proposalChoices)
    console.debug('choiceIndex: ', choiceIndex)

    // Format the choice based on vote type
    // For weighted voting, the choice is an object with choice indices as keys and vote weights as values
    // For single-choice and basic, the choice is just the index number
    let choice: number | Record<string, number>;
    if (voteType === 'weighted' || voteType === 'quadratic') {
      // For weighted voting, put 100% on the chosen option
      choice = { [choiceIndex]: 1 };
      console.debug('weighted choice: ', choice)
    } else {
      choice = choiceIndex;
    }

    const receipt = await client.vote(wallet, agentAddress, {
      space: proposal.space.id,
      proposal: proposalHex,
      type: voteType,
      choice: choice,
    });
    logger.info(`Snapshot vote submitted: ${JSON.stringify(receipt, null, 2)}`);
  } catch (error) {
    if (error instanceof Error) {
      logger.error(`Error voting: ${error.message}`);
      // Log the stack trace for debugging
      logger.error(`Stack: ${error.stack}`);
    } else {
      // For non-Error objects, use JSON.stringify with null, 2 for pretty formatting
      logger.error(`Error voting: ${JSON.stringify(error, null, 2)}`);
    }

    // If you want to see all properties including non-enumerable ones
    logger.error('Error details:');
    logger.error(inspect(error, { depth: null, colors: false }));
  }
}

/**
 * Casts a Tally vote directly on the Governor contract (on-chain)
 * SEPARATE from Snapshot voting - does not affect DeleGate contract usage
 */
export async function castTallyVote(
  proposalId: string,
  governorAddress: string,
  privateKey: string,
  agentAddress: string
): Promise<void> {
  try {
    logger.info(`Casting Tally vote for proposal ${proposalId} on governor ${governorAddress}`);

    const voteDetails = await getVoteDetailsByAgentAddress(agentAddress, proposalId);

    if (!voteDetails) {
      throw new Error(`Vote details not found for agent ${agentAddress} and proposal ${proposalId}`);
    }

    // Setup Arbitrum provider and wallet
    const TALLY_RPC_URL = process.env.TALLY_RPC_URL || 'https://arb1.arbitrum.io/rpc';
    const provider = new ethers.providers.JsonRpcProvider(TALLY_RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);

    // Check agent balance before attempting to vote
    const balance = await provider.getBalance(agentAddress);
    const balanceInEth = ethers.utils.formatEther(balance);
    logger.info(`Agent ${agentAddress} balance: ${balanceInEth} ETH`);

    if (balance.lt(ethers.utils.parseEther('0.001'))) {
      throw new Error(`Agent ${agentAddress} has insufficient funds (${balanceInEth} ETH). Minimum required: 0.001 ETH for gas fees. Please fund the agent wallet on Arbitrum.`);
    }

    // Initialize Governor contract
    const governor = new ethers.Contract(governorAddress, GovernorABI, wallet);

    // Tally uses 0-indexed: 0 = Against, 1 = For, 2 = Abstain
    const support = convertTallyVoteChoice(voteDetails.aiVoteChoice);
    const proposalIdBN = ethers.BigNumber.from(proposalId);

    logger.info(`Submitting vote: proposalId=${proposalId}, support=${support} (For)`);

    // Call castVote on the Governor contract
    const tx = await governor.castVote(proposalIdBN, support);
    logger.info(`Tally vote transaction submitted: ${tx.hash}`);

    const receipt = await tx.wait();
    logger.info(`Tally vote transaction confirmed in block ${receipt.blockNumber}: ${tx.hash}`);
  } catch (error) {
    logger.error(`Tally vote failed for proposal ${proposalId}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Casts a vote on a proposal using the DeleGate contract
 * FOR SNAPSHOT ONLY - unchanged to preserve existing functionality
 */
export async function castVote(
  proposal: SnapshotProposal,
  agentAddress: string,
  userAddress: string,
): Promise<void> {
  try {
    logger.info(`Casting vote for proposal: ${proposal.title} (${proposal.id}) with agent ${agentAddress} for the user ${userAddress}`);

    console.info(`Agent address: ${agentAddress}`);
    console.info(`User address: ${userAddress}`);

    // Check relayer balance before attempting to vote
    const balance = await publicClient.getBalance({ address: relayerAccount.address });
    const balanceInEth = Number(balance) / 1e18; // Convert from wei to ETH
    logger.info(`Relayer ${relayerAccount.address} balance: ${balanceInEth} ETH`);

    if (balance < 1000000000000000n) { // 0.001 ETH in wei
      throw new Error(`Relayer ${relayerAccount.address} has insufficient funds (${balanceInEth} ETH). Minimum required: 0.001 ETH for gas fees. Please fund the relayer wallet.`);
    }

    const hash = await walletClient.writeContract({
      address: DELEGATE_CONTRACT_ADDRESS,
      abi: DeleGateABI.abi,
      functionName: 'castSpaceVoteFor',
      args: [
        userAddress,
        polygon.id,
        proposal.space.id,
        BigInt(proposal.id),
        proposal.body,
        agentAddress,
        "0x" // voteProof (empty for now) 
      ],
    });

    
    logger.info(`Vote transaction submitted: ${hash}`);
    const receipt = await publicClient.waitForTransactionReceipt({ hash: hash });
    logger.info(`Vote transaction confirmed in block ${receipt.blockNumber}: ${hash}`);
  } catch (error) {
    logger.error(`Vote failed for proposal ${proposal.id}: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}