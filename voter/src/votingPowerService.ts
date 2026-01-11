import axios from 'axios';
import { SNAPSHOT_HUB_URL } from './config';
import { VotingPowerResult } from './types';
import { VotingPower, IVotingPower, Agent, AgentSpace } from './db/models';
import logger from './logger';
import { fetchProposals } from './fetcher';
import { DAOS } from './config';

// Retry configuration
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 2000; // 2 seconds

/**
 * Delay helper for retry backoff
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch voting power from Snapshot GraphQL API with retry logic
 */
export async function fetchVotingPower(
  voter: string,
  space: string,
  proposal: string,
  retries: number = MAX_RETRIES
): Promise<VotingPowerResult | null> {
  const graphqlUrl = SNAPSHOT_HUB_URL.endsWith('/graphql') 
    ? SNAPSHOT_HUB_URL 
    : `${SNAPSHOT_HUB_URL}/graphql`;

  const query = `
    query {
      vp (
        voter: "${voter}"
        space: "${space}"
        proposal: "${proposal}"
      ) {
        vp
        vp_by_strategy
        vp_state
      } 
    }
  `;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      logger.debug(`Fetching voting power for voter ${voter} on proposal ${proposal} (attempt ${attempt}/${retries})`);

      const response = await axios.post(graphqlUrl, { query }, {
        headers: { 'Content-Type': 'application/json' },
        timeout: 30000 // 30 second timeout
      });

      // Check for GraphQL errors
      if (response.data.errors) {
        const errorMessages = response.data.errors.map((e: { message?: string }) => e.message || 'Unknown error').join(', ');
        
        // Check if it's a transient error (504, timeout, etc.)
        const isTransientError = errorMessages.includes('504') || 
                                  errorMessages.includes('timeout') || 
                                  errorMessages.includes('Gateway') ||
                                  errorMessages.includes('score API');
        
        if (isTransientError && attempt < retries) {
          const delayMs = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
          logger.warn(`Transient error fetching voting power (attempt ${attempt}/${retries}), retrying in ${delayMs}ms: ${errorMessages}`);
          await delay(delayMs);
          continue;
        }
        
        logger.error(`GraphQL error fetching voting power: ${errorMessages}`);
        return null;
      }

      const vpData = response.data.data?.vp;
      if (!vpData) {
        logger.warn(`No voting power data returned for voter ${voter} on proposal ${proposal}`);
        return null;
      }

      return {
        vp: vpData.vp || 0,
        vp_by_strategy: vpData.vp_by_strategy || [],
        vp_state: vpData.vp_state || 'invalid'
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // Check if it's a transient network error
      const isTransientError = errorMessage.includes('ETIMEDOUT') || 
                                errorMessage.includes('ECONNRESET') ||
                                errorMessage.includes('timeout') ||
                                errorMessage.includes('504') ||
                                errorMessage.includes('503') ||
                                errorMessage.includes('502');
      
      if (isTransientError && attempt < retries) {
        const delayMs = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
        logger.warn(`Network error fetching voting power (attempt ${attempt}/${retries}), retrying in ${delayMs}ms: ${errorMessage}`);
        await delay(delayMs);
        continue;
      }
      
      logger.error(`Failed to fetch voting power after ${attempt} attempts: ${errorMessage}`);
      return null;
    }
  }
  
  return null;
}

/**
 * Update voting power for an agent on a specific proposal
 */
export async function updateVotingPowerForProposal(
  agentAddress: string,
  proposalId: string,
  spaceId: string,
  proposalStart: number,
  proposalEnd: number,
  scheduledVoteTime?: Date
): Promise<IVotingPower | null> {
  try {
    const vpResult = await fetchVotingPower(agentAddress, spaceId, proposalId);

    if (!vpResult) {
      logger.warn(`Could not fetch voting power for agent ${agentAddress} on proposal ${proposalId}`);
      return null;
    }

    const canVote = vpResult.vp > 0 && vpResult.vp_state === 'valid';

    const votingPower = await VotingPower.findOneAndUpdate(
      { agentAddress, proposalId },
      {
        agentAddress,
        proposalId,
        spaceId,
        vp: vpResult.vp,
        vpByStrategy: vpResult.vp_by_strategy,
        vpState: vpResult.vp_state,
        proposalEnd,
        proposalStart,
        canVote,
        scheduledVoteTime,
        lastChecked: new Date()
      },
      { upsert: true, new: true }
    );

    logger.debug(`Updated voting power for agent ${agentAddress} on proposal ${proposalId}: VP=${vpResult.vp}, canVote=${canVote}`);
    return votingPower;
  } catch (error) {
    logger.error(`Failed to update voting power: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get voting power status for a specific proposal
 */
export async function getVotingPowerForProposal(
  agentAddress: string,
  proposalId: string
): Promise<IVotingPower | null> {
  try {
    return await VotingPower.findOne({ agentAddress, proposalId });
  } catch (error) {
    logger.error(`Failed to get voting power: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/**
 * Get all voting power records for an agent
 */
export async function getVotingPowerForAgent(agentAddress: string): Promise<IVotingPower[]> {
  try {
    const currentTime = Math.floor(Date.now() / 1000);
    // Only return active proposals (end time in the future)
    return await VotingPower.find({ 
      agentAddress,
      proposalEnd: { $gt: currentTime }
    }).sort({ proposalEnd: 1 });
  } catch (error) {
    logger.error(`Failed to get voting power for agent: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get all voting power records for a space (DAO)
 */
export async function getVotingPowerForSpace(spaceId: string): Promise<IVotingPower[]> {
  try {
    const currentTime = Math.floor(Date.now() / 1000);
    // Only return active proposals (end time in the future)
    return await VotingPower.find({ 
      spaceId,
      proposalEnd: { $gt: currentTime }
    }).sort({ proposalEnd: 1 });
  } catch (error) {
    logger.error(`Failed to get voting power for space: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Get voting power status for all active proposals for an agent
 */
export async function getActiveProposalsVotingPower(agentAddress: string): Promise<IVotingPower[]> {
  try {
    const currentTime = Math.floor(Date.now() / 1000);
    return await VotingPower.find({
      agentAddress,
      proposalEnd: { $gt: currentTime }
    }).sort({ proposalEnd: 1 });
  } catch (error) {
    logger.error(`Failed to get active proposals voting power: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Check and update voting power for all active agents and their active proposals
 * This should be run periodically by the scheduler
 */
export async function checkAndUpdateAllVotingPower(): Promise<void> {
  logger.info('Starting voting power check for all active agents...');
  
  try {
    // Get all active agents
    const agents = await Agent.find({ active: true });
    logger.info(`Found ${agents.length} active agents`);

    for (const agent of agents) {
      // Get all spaces (DAOs) this agent is active in
      const agentSpaces = await AgentSpace.find({ 
        agentId: agent._id, 
        active: true 
      });

      for (const agentSpace of agentSpaces) {
        const spaceId = agentSpace.spaceId;
        
        // Find the DAO config to check if it's a Snapshot DAO
        const daoConfig = DAOS.find(d => d.id === spaceId);
        if (!daoConfig || daoConfig.source !== 'snapshot') {
          // Skip non-Snapshot DAOs (Tally uses different voting power mechanism)
          continue;
        }

        // Fetch active proposals for this space
        const proposals = await fetchProposals(spaceId);
        
        for (const proposal of proposals) {
          // Only check active proposals
          if (proposal.state !== 'active') continue;

          // Calculate scheduled vote time (similar to voter.ts logic)
          const proposalEndMs = proposal.end * 1000;
          const voteTimeMs = proposalEndMs - (30 * 60 * 1000); // 30 minutes before end
          const scheduledVoteTime = new Date(voteTimeMs);

          await updateVotingPowerForProposal(
            agent.address,
            proposal.id,
            spaceId,
            proposal.start,
            proposal.end,
            scheduledVoteTime
          );

          // Delay between API calls to avoid rate limiting (1 second)
          await delay(1000);
        }
        
        // Additional delay between spaces to be gentle on the API
        await delay(500);
      }
    }

    logger.info('Voting power check completed');
  } catch (error) {
    logger.error(`Failed to check voting power: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/**
 * Clean up old voting power records for expired proposals
 */
export async function cleanupExpiredVotingPower(): Promise<void> {
  try {
    const currentTime = Math.floor(Date.now() / 1000);
    // Delete records for proposals that ended more than 7 days ago
    const sevenDaysAgo = currentTime - (7 * 24 * 60 * 60);
    
    const result = await VotingPower.deleteMany({
      proposalEnd: { $lt: sevenDaysAgo }
    });
    
    if (result.deletedCount > 0) {
      logger.info(`Cleaned up ${result.deletedCount} expired voting power records`);
    }
  } catch (error) {
    logger.error(`Failed to cleanup expired voting power: ${error instanceof Error ? error.message : String(error)}`);
  }
}
