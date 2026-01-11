import mongoose from 'mongoose';
import { Agent, AgentSpace, IAgent, IAgentSpace, ScheduledVote, IScheduledVote, VoteDetails, IVoteDetails } from './models';
import logger from '../logger';
import { SnapshotProposal } from '../types';
import { createHash } from 'crypto';
import { publicClient } from '../lib/utils';
import DeleGateABI from '../artifacts/DeleGate.json';
import { DELEGATE_CONTRACT_ADDRESS } from '../config';
import { fetchOpenAIResponse } from '../ai-parser';

/**
 * Initialize the database connection
 */
export async function initializeDatabase(connectionString: string): Promise<void> {
  try {
    await mongoose.connect(connectionString);
    logger.debug('Database connection established');
  } catch (error) {
    logger.error(`Database connection failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get all active agents for a specific space
 */
export async function getAgentsForSpace(spaceId: string): Promise<Array<{agent: IAgent, defaultVote: number}>> {
  try {
    const agentSpaces = await AgentSpace.find({ 
      spaceId, 
      active: true 
    }).populate('agentId');
    
    return agentSpaces.map(as => ({
      agent: as.agentId as unknown as IAgent,
      defaultVote: as.defaultVote
    }));
  } catch (error) {
    logger.error(`Failed to get agents for space ${spaceId}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get all spaces (DAOs) with active agents
 */
export async function getAllActiveSpaces(): Promise<string[]> {
  try {
    const result = await AgentSpace.distinct('spaceId', { active: true });
    return result;
  } catch (error) {
    logger.error(`Failed to get active spaces: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Add an agent to a space
 */
export async function addAgentToSpace(
  agentId: string, 
  spaceId: string, 
  defaultVote: number = 1
): Promise<boolean> {
  try {
    const agent = await Agent.findById(agentId);
    if (!agent) {
      logger.error(`Agent ${agentId} not found`);
      return false;
    }

    await AgentSpace.findOneAndUpdate(
      { agentId, spaceId },
      { agentId, spaceId, defaultVote, active: true },
      { upsert: true, new: true }
    );
    
    logger.info(`Agent ${agent.name} (${agent.address}) added to space ${spaceId}`);
    return true;
  } catch (error) {
    logger.error(`Failed to add agent to space: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Remove an agent from a space
 */
export async function removeAgentFromSpace(agentId: string, spaceId: string): Promise<boolean> {
  try {
    const result = await AgentSpace.findOneAndUpdate(
      { agentId, spaceId },
      { active: false }
    );
    
    if (!result) {
      logger.warn(`Agent ${agentId} was not assigned to space ${spaceId}`);
      return false;
    }
    
    logger.info(`Agent ${agentId} removed from space ${spaceId}`);
    return true;
  } catch (error) {
    logger.error(`Failed to remove agent from space: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Add a new agent
 */
export async function addAgent(
  address: string,
  privateKey: string,
  name: string,
  kmsAdapterAddress?: string,
  userAddress?: string
): Promise<IAgent | null> {
  try {
    const agent = new Agent({ 
      address, 
      privateKey, 
      name,
      kmsAdapterAddress,
      userAddress,
      active: true 
    });
    await agent.save();
    logger.info(`New agent added: ${name} (${address}) with KMS adapter: ${kmsAdapterAddress || 'not provided'} for user: ${userAddress || 'not provided'}`);
    return agent;
  } catch (error) {
    logger.error(`Failed to add agent: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get all active agents
 */
export async function getAllAgents(): Promise<IAgent[]> {
  try {
    return await Agent.find({ active: true });
  } catch (error) {
    logger.error(`Failed to get agents: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get agent address from agent ID
 * @param agentId The MongoDB ID of the agent
 * @returns The agent document or null if not found
 */
export async function getAgentById(agentId: string): Promise<IAgent | null> {
  try {
    const agent = await Agent.findById(agentId);
    if (!agent) {
      logger.warn(`Agent with ID ${agentId} not found`);
      return null;
    }
    return agent;
  } catch (error) {
    logger.error(`Failed to get agent address by ID: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get agent by its Ethereum address
 * @param address The Ethereum address of the agent
 * @returns The agent document or null if not found
 */
export async function getAgentByAddress(address: string): Promise<IAgent | null> {
    try {
        const agent = await Agent.findOne({ address, active: true });
        if (!agent) {
            logger.warn(`Agent with address ${address} not found or not active`);
            return null;
        }
        return agent;
    } catch (error) {
        logger.error(`Failed to get agent by address: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Get agents by user address
 * @param userAddress The Ethereum address of the user who owns the agent
 * @returns Array of agent documents or empty array if none found
 */
export async function getAgentsByUserAddress(userAddress: string): Promise<IAgent[]> {
  try {
    const agents = await Agent.find({ userAddress, active: true });
    if (agents.length === 0) {
      logger.info(`No active agents found for user address ${userAddress}`);
      return [];
    }
    logger.info(`Found ${agents.length} active agent(s) for user address ${userAddress}`);
    return agents;
  } catch (error) {
    logger.error(`Failed to get agents by user address: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get agent by its KMS adapter address
 * @param kmsAdapterAddress The Ethereum address of the KMS adapter
 * @returns The agent document or null if not found
 */
export async function getAgentByKmsAddress(kmsAdapterAddress: string): Promise<IAgent | null> {
  try {
    const agent = await Agent.findOne({ kmsAdapterAddress, active: true });
    if (!agent) {
      logger.warn(`Agent with KMS adapter address ${kmsAdapterAddress} not found or not active`);
      return null;
    }
    return agent;
  } catch (error) {
    logger.error(`Failed to get agent by KMS address: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Check if an agent is associated with a specific space
 * @param agentId The ID of the agent
 * @param spaceId The ID of the space
 * @returns True if the agent is associated with the space, false otherwise
 */
export async function isAgentInSpace(agentId: string, spaceId: string): Promise<boolean> {
  try {
    const agentSpace = await AgentSpace.findOne({ 
      agentId, 
      spaceId, 
      active: true 
    });
    
    return !!agentSpace;
  } catch (error) {
    logger.error(`Failed to check if agent is in space: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Safely extract the string ID from a MongoDB document
 */
export function getDocumentId(doc: any): string {
  if (!doc) return '';
  if (typeof doc._id === 'string') return doc._id;
  if (doc._id && typeof doc._id.toString === 'function') return doc._id.toString();
  return '';
}

/**
 * Schedule a vote in the database
 */
export async function scheduleVoteInDb(
  proposal: any,
  agent: IAgent,
  scheduledTime: Date,
  source: 'snapshot' | 'tally' = 'snapshot',
  governorAddress?: string
): Promise<void> {
  try {
    await ScheduledVote.create({
      proposalId: proposal.id,
      proposalTitle: proposal.title,
      spaceId: proposal.space?.id || 'unknown',
      agentId: agent._id,
      scheduledTime,
      status: 'scheduled',
      source,
      governorAddress
    });
    
    logger.info(`Vote for proposal ${proposal.id} by agent ${agent.name} scheduled in database for ${scheduledTime.toISOString()}`);
  } catch (error) {
    logger.error(`Failed to schedule vote in database: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Get all votes that need to be executed now
 */
export async function getPendingVotes(): Promise<IScheduledVote[]> {
  try {
    const now = new Date();
    const pendingVotes = await ScheduledVote.find({
      status: 'scheduled',
      scheduledTime: { $lte: now }
    }).populate('agentId');
    
    return pendingVotes;
  } catch (error) {
    logger.error(`Failed to retrieve pending votes: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Mark a vote as completed
 */
export async function markVoteCompleted(voteId: string): Promise<boolean> {
  try {
    await ScheduledVote.findByIdAndUpdate(voteId, {
      status: 'completed',
      executedAt: new Date()
    });
    return true;
  } catch (error) {
    logger.error(`Failed to mark vote as completed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Mark a vote as failed
 */
export async function markVoteFailed(voteId: string, error: string): Promise<boolean> {
  try {
    await ScheduledVote.findByIdAndUpdate(voteId, {
      status: 'failed',
      executedAt: new Date(),
      error
    });
    return true;
  } catch (error) {
    logger.error(`Failed to mark vote as failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Get all scheduled votes
 * @param options Optional filtering options
 * @returns Array of scheduled votes
 */
export async function getScheduledVotes({
  status,
  spaceId,
  agentId,
  limit = 100,
  skip = 0,
  sortBy = 'scheduledTime',
  sortDirection = 'asc'
}: {
  status?: 'scheduled' | 'completed' | 'failed';
  spaceId?: string;
  agentId?: string;
  limit?: number;
  skip?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
} = {}): Promise<IScheduledVote[]> {
  try {
    const query: any = {};
    
    // Apply filters if provided
    if (status) {
      query.status = status;
    }
    
    if (spaceId) {
      query.spaceId = spaceId;
    }
    
    if (agentId) {
      query.agentId = agentId;
    }
    
    // Create sort object
    const sort: any = {};
    sort[sortBy] = sortDirection === 'asc' ? 1 : -1;
    
    const votes = await ScheduledVote.find(query)
      .populate('agentId')
      .sort(sort)
      .skip(skip)
      .limit(limit);
      
    logger.info(`Retrieved ${votes.length} scheduled votes`);
    return votes;
  } catch (error) {
    logger.error(`Failed to retrieve scheduled votes: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get scheduled vote by ID
 * @param voteId The ID of the scheduled vote
 * @returns The scheduled vote or null if not found
 */
export async function getScheduledVoteById(voteId: string): Promise<IScheduledVote | null> {
  try {
    const vote = await ScheduledVote.findById(voteId).populate('agentId');
    return vote;
  } catch (error) {
    logger.error(`Failed to retrieve scheduled vote ${voteId}: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Count scheduled votes with optional filters
 */
export async function countScheduledVotes({
  status,
  spaceId,
  agentId
}: {
  status?: 'scheduled' | 'completed' | 'failed';
  spaceId?: string;
  agentId?: string;
} = {}): Promise<number> {
  try {
    const query: any = {};
    
    if (status) {
      query.status = status;
    }
    
    if (spaceId) {
      query.spaceId = spaceId;
    }
    
    if (agentId) {
      query.agentId = agentId;
    }
    
    const count = await ScheduledVote.countDocuments(query);
    return count;
  } catch (error) {
    logger.error(`Failed to count scheduled votes: ${error instanceof Error ? error.message : String(error)}`);
    return 0;
  }
}

/**
 * Get upcoming votes scheduled in the next X hours
 * @param hours Number of hours to look ahead (default: 24)
 */
export async function getUpcomingVotes(hours: number = 24): Promise<IScheduledVote[]> {
  try {
    const now = new Date();
    const future = new Date(now.getTime() + hours * 60 * 60 * 1000);
    
    const votes = await ScheduledVote.find({
      status: 'scheduled',
      scheduledTime: {
        $gte: now,
        $lte: future
      }
    }).populate('agentId').sort({ scheduledTime: 1 });
    
    return votes;
  } catch (error) {
    logger.error(`Failed to retrieve upcoming votes: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get statistics about scheduled votes
 */
export async function getVoteStatistics(): Promise<{
  total: number;
  scheduled: number;
  completed: number;
  failed: number;
  upcomingIn24h: number;
}> {
  try {
    // Get counts by status
    const total = await ScheduledVote.countDocuments();
    const scheduled = await ScheduledVote.countDocuments({ status: 'scheduled' });
    const completed = await ScheduledVote.countDocuments({ status: 'completed' });
    const failed = await ScheduledVote.countDocuments({ status: 'failed' });
    
    // Get upcoming votes count
    const now = new Date();
    const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const upcomingIn24h = await ScheduledVote.countDocuments({
      status: 'scheduled',
      scheduledTime: {
        $gte: now,
        $lte: in24h
      }
    });
    
    return {
      total,
      scheduled,
      completed,
      failed,
      upcomingIn24h
    };
  } catch (error) {
    logger.error(`Failed to get vote statistics: ${error instanceof Error ? error.message : String(error)}`);
    return {
      total: 0,
      scheduled: 0,
      completed: 0,
      failed: 0,
      upcomingIn24h: 0
    };
  }
}

// ============================================================================
// VOTE DETAILS MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Create or update vote details for an agent and proposal
 */
export async function upsertVoteDetails(
  agentAddress: string,
  proposalId: string,
  spaceId: string,
  proposalTitle: string,
  proposalText: string,
  proposalChoices: string[],
  lastUpdated: number,
  aiResponse: string,
  aiVoteChoice: 'yes' | 'no',
  userEthos: string,
  userAddress?: string
): Promise<IVoteDetails | null> {
  try {
    const proposalTextHash = createHash('sha256').update(proposalText).digest('hex');
    
    const voteDetails = await VoteDetails.findOneAndUpdate(
      { agentAddress, proposalId },
      {
        agentAddress,
        userAddress: userAddress || '',
        spaceId,
        proposalTitle,
        proposalText,
        proposalChoices,
        proposalTextHash,
        lastUpdated,
        aiResponse,
        aiVoteChoice,
        userEthos,
        status: 'pending',
        lastChecked: new Date()
      },
      { 
        upsert: true, 
        new: true,
        setDefaultsOnInsert: true
      }
    );

    logger.info(`Upserted vote details for agent ${agentAddress}, proposal ${proposalId}`);
    return voteDetails;
  } catch (error) {
    logger.error(`Failed to upsert vote details: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get vote details for a specific agent and proposal
 */
export async function getVoteDetailsByAgentAddress(
  agentAddress: string,
  proposalId: string
): Promise<IVoteDetails | null> {
  try {
    return await VoteDetails.findOne({ agentAddress, proposalId });
  } catch (error) {
    logger.error(`Failed to get vote details: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Save vote receipt after a successful vote submission
 */
export interface VoteReceipt {
  id: string;
  ipfs: string;
  relayer?: {
    address: string;
    receipt: string;
  };
}

export async function saveVoteReceipt(
  agentAddress: string,
  proposalId: string,
  receipt: VoteReceipt
): Promise<boolean> {
  try {
    await VoteDetails.findOneAndUpdate(
      { agentAddress, proposalId },
      {
        status: 'voted',
        voteReceiptId: receipt.id,
        voteReceiptIpfs: receipt.ipfs,
        voteRelayerAddress: receipt.relayer?.address,
        voteRelayerReceipt: receipt.relayer?.receipt,
        votedAt: new Date()
      }
    );
    logger.info(`Saved vote receipt for proposal ${proposalId}: ${receipt.id}`);
    return true;
  } catch (error) {
    logger.error(`Failed to save vote receipt: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Get vote details for a user's agent and proposal
 * This finds the first active agent for the user and returns their vote details
 */
export async function getVoteDetailsByUserAddress(
  userAddress: string,
  proposalId: string
): Promise<IVoteDetails | null> {
  try {
    const agents = await getAgentsByUserAddress(userAddress);
    
    if (agents.length === 0) {
      logger.warn(`No agents found for user ${userAddress}`);
      return null;
    }
    
    // Use the first agent if multiple exist
    const agentAddress = agents[0].address;
    return await VoteDetails.findOne({ agentAddress, proposalId });
  } catch (error) {
    logger.error(`Failed to get vote details by user address: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get all vote details for a user's agents
 */
export async function getUserVoteDetails(userAddress: string): Promise<IVoteDetails[]> {
  try {
    const agents = await getAgentsByUserAddress(userAddress);
    
    if (agents.length === 0) {
      logger.info(`No agents found for user ${userAddress}`);
      return [];
    }
    
    const agentAddresses = agents.map(agent => agent.address);
    return await VoteDetails.find({ 
      agentAddress: { $in: agentAddresses } 
    }).sort({ createdAt: -1 });
  } catch (error) {
    logger.error(`Failed to get user vote details: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Update agent vote choice
 */
export async function updateUserVote(
  agentAddress: string,
  proposalId: string,
  userVoteChoice: 'yes' | 'no'
): Promise<boolean> {
  try {
    const result = await VoteDetails.updateOne(
      { agentAddress, proposalId },
      { 
        userVoteChoice,
        status: 'voted',
        updatedAt: new Date()
      }
    );
    
    if (result.modifiedCount > 0) {
      logger.info(`Updated agent vote for ${agentAddress}, proposal ${proposalId} to ${userVoteChoice}`);
      return true;
    }
    return false;
  } catch (error) {
    logger.error(`Failed to update agent vote: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Check if proposal has changed since last check
 */
export async function hasProposalChanged(
  agentAddress: string,
  userEthos: string,
  proposalId: string,
  currentText: string,
  currentTimestamp: number
): Promise<boolean> {
  try {
    const existingVote = await VoteDetails.findOne({ agentAddress, proposalId });
    if (!existingVote) {
      return true; // No existing vote, so it's "changed"
    }
    
    const currentTextHash = createHash('sha256').update(currentText).digest('hex');
    
    // Check if text hash or timestamp changed
    const ethosChanged = existingVote.userEthos !== userEthos;
    const textChanged = existingVote.proposalTextHash !== currentTextHash;
    const timestampChanged = existingVote.lastUpdated !== currentTimestamp;

    if (textChanged || timestampChanged || ethosChanged) {
      logger.info(`Proposal ${proposalId} vote changed for agent ${agentAddress}: text=${textChanged}, timestamp=${timestampChanged}, ethos=${ethosChanged}`);
      return true;
    }
    
    return false;
  } catch (error) {
    logger.error(`Failed to check proposal change: ${error instanceof Error ? error.message : String(error)}`);
    return true; // Assume changed on error
  }
}

/**
 * Update proposal check timestamp
 */
export async function updateProposalCheck(
  agentAddress: string,
  proposalId: string
): Promise<boolean> {
  try {
    const result = await VoteDetails.updateOne(
      { agentAddress, proposalId },
      { lastChecked: new Date() }
    );
    return result.modifiedCount > 0;
  } catch (error) {
    logger.error(`Failed to update proposal check: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Mark vote as expired for an agent
 */
export async function markVoteExpired(
  agentAddress: string,
  proposalId: string
): Promise<boolean> {
  try {
    const result = await VoteDetails.updateOne(
      { agentAddress, proposalId },
      { status: 'expired', updatedAt: new Date() }
    );
    return result.modifiedCount > 0;
  } catch (error) {
    logger.error(`Failed to mark vote expired: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}

/**
 * Get all pending vote details for an agent to regenerate AI recommendations
 * @param agentAddress The agent address
 * @returns Array of pending vote details
 */
export async function getPendingVoteDetailsForAgent(agentAddress: string): Promise<IVoteDetails[]> {
  try {
    return await VoteDetails.find({ 
      agentAddress, 
      status: 'pending' 
    }).sort({ createdAt: -1 });
  } catch (error) {
    logger.error(`Failed to get pending vote details for agent: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Refresh vote details for all agents belonging to a user.
 * This will use the provided ethos or fetch the latest on-chain ethos for the user and regenerate AI responses
 * for any pending vote details where the stored ethos differs from the provided/on-chain ethos
 * or where the aiResponse is missing.
 *
 * @param userAddress The Ethereum address of the user
 * @param providedEthos Optional ethos string from event watcher (avoids contract read)
 * @returns summary containing number updated and details
 */
export async function refreshVoteDetailsForUser(userAddress: string, providedEthos?: string): Promise<{
  updatedCount: number;
  details: Array<{ agentAddress: string; proposalId: string; updated: boolean }>;
}> {
  const summary: { updatedCount: number; details: Array<{ agentAddress: string; proposalId: string; updated: boolean }> } = {
    updatedCount: 0,
    details: []
  };

  try {
    // Get agents for the user
    const agents = await getAgentsByUserAddress(userAddress);
    if (!agents || agents.length === 0) {
      logger.info(`No agents found for user ${userAddress} while refreshing vote details`);
      return summary;
    }

    // Use provided ethos or fetch on-chain ethos for the user
    let userEthos = providedEthos || "";
    if (!userEthos) {
      try {
        const result = await publicClient.readContract({
          address: DELEGATE_CONTRACT_ADDRESS,
          abi: DeleGateABI.abi,
          functionName: 'getUserEthos',
          args: [userAddress as `0x${string}`]
        }) as { ethos: string };

        userEthos = (result && result.ethos) ? result.ethos : '';
      } catch (err) {
        logger.error(`Failed to read on-chain ethos for user ${userAddress}: ${err instanceof Error ? err.message : String(err)}`);
        // fallthrough with empty ethos
      }
    }

    // Use default ethos if none found
    if (!userEthos || userEthos.trim().length === 0) {
      userEthos = "I am a responsible DAO member who values decentralization, transparency, and community governance.";
    }

    // Process each agent's pending votes
    for (const agent of agents) {
      const agentAddress = agent.address;
      const pendingVotes = await getPendingVoteDetailsForAgent(agentAddress);

      for (const vote of pendingVotes) {
        try {
          const needsUpdate = !vote.userEthos || vote.userEthos !== userEthos || !vote.aiResponse || vote.aiResponse.trim().length === 0;
          if (!needsUpdate) {
            summary.details.push({ agentAddress, proposalId: vote.proposalId, updated: false });
            continue;
          }

          // Get proposal choices from the stored vote details, default to standard choices
          const proposalChoices = vote.proposalChoices || ['For', 'Against', 'Abstain'];
          const choicesInfo = `The available voting choices for this proposal are: [${proposalChoices.join(', ')}].`;
          
          // Build AI directive and regenerate response
          const directive = process.env.AI_DIRECTIVE || "Suggest a vote for the passed proposal based on the ethos of the user. The result must be only a JSON with two elements: 'vote', which can be yes or no, and 'reason', which is the explanation of the reasons considered for the voting decision. The JSON must be formatted as follows: {\"vote\": \"yes\", \"reason\": \"...\"}.";

          const aiResponse = await fetchOpenAIResponse(
            `This is the user ethos: ${userEthos}. ${choicesInfo} ${directive}`,
            vote.proposalText
          );

          // Parse AI response
          let aiVoteChoice: 'yes' | 'no' = 'no';
          let reasoning = aiResponse;

          try {
            const parsed = JSON.parse(aiResponse);
            aiVoteChoice = parsed.vote === 'yes' ? 'yes' : 'no';
            reasoning = parsed.reason || aiResponse;
          } catch (parseError) {
            logger.warn(`Failed to parse AI response as JSON for proposal ${vote.proposalId}: ${parseError}`);
          }

          // Upsert with new AI response and ethos
          await upsertVoteDetails(
            agentAddress,
            vote.proposalId,
            vote.spaceId,
            vote.proposalTitle,
            vote.proposalText,
            proposalChoices,
            vote.lastUpdated || Date.now(),
            reasoning,
            aiVoteChoice,
            userEthos,
            userAddress
          );

          summary.updatedCount += 1;
          summary.details.push({ agentAddress, proposalId: vote.proposalId, updated: true });
        } catch (err) {
          logger.error(`Failed to refresh vote ${vote.proposalId} for agent ${agent.address}: ${err instanceof Error ? err.message : String(err)}`);
          summary.details.push({ agentAddress, proposalId: vote.proposalId, updated: false });
        }
      }
    }

    logger.info(`Refreshed vote details for user ${userAddress}: updated ${summary.updatedCount} vote(s)`);
    return summary;
  } catch (error) {
    logger.error(`Failed to refresh vote details for user ${userAddress}: ${error instanceof Error ? error.message : String(error)}`);
    return summary;
  }
}