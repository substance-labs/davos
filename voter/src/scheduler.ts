import cron from 'node-cron';
import { FETCH_SCHEDULE, DAOS, DELEGATE_CONTRACT_ADDRESS } from './config';
import { fetchProposals, fetchTallyProposals } from './fetcher';
import { processProposalsForVoting } from './voter';
import { getAllActiveSpaces, upsertVoteDetails, hasProposalChanged, getAgentsForSpace } from './db/service';
import { fetchOpenAIResponse } from './ai-parser';
import logger from './logger';
import { publicClient } from './lib/utils';
import DeleGateABI from './artifacts/DeleGate.json';

/**
 * Fetch user ethos from the DeleGate contract
 */
async function getUserEthos(userAddress: string): Promise<string> {
  try {
    const result = await publicClient.readContract({
      address: DELEGATE_CONTRACT_ADDRESS,
      abi: DeleGateABI.abi,
      functionName: 'getUserEthos',
      args: [userAddress as `0x${string}`]
    }) as { ethos: string };
    
    if (result && result.ethos && result.ethos.trim().length > 0) {
      const preview = result.ethos.length > 50 
        ? `${result.ethos.substring(0, 50)}...` 
        : result.ethos;
      logger.debug(`Retrieved ethos for ${userAddress}: ${preview}`);
      return result.ethos;
    }
    
    logger.warn(`No ethos found for user ${userAddress}, using default`);
    return "I am a responsible DAO member who values decentralization, transparency, and community governance.";
  } catch (error) {
    logger.error(`Failed to fetch ethos for user ${userAddress}: ${error instanceof Error ? error.message : String(error)}`);
    return "I am a responsible DAO member who values decentralization, transparency, and community governance.";
  }
}

/**
 * Delay helper to add pauses between API calls
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Starts the scheduler for fetching proposals and scheduling votes
 */
export function startScheduler(): void {
  // Run immediately on startup
  logger.info('Running initial proposal fetch...');
  runFetchAndSchedule();
  
  // Schedule regular runs according to cron pattern
  cron.schedule(FETCH_SCHEDULE, () => {
    logger.info('Scheduled run triggered');
    runFetchAndSchedule();
  });
  
  logger.debug(`Scheduler configured with cron: ${FETCH_SCHEDULE}`);
}

/**
 * Main process to fetch proposals and schedule votes
 */
export async function runFetchAndSchedule(): Promise<void> {
  const startTime = Date.now();
  logger.info('');
  logger.info('========================================');
  logger.info('  PROPOSAL FETCH & SCHEDULE CYCLE');
  logger.info('========================================');
  logger.info('');
  
  let totalProposals = 0;
  let totalVoteDetails = 0;
  let totalErrors = 0;
  
  try {
    logger.info(`Processing ${DAOS.length} configured DAO(s)...`);
    logger.info('');
    
    // Process all configured DAOs (both snapshot and tally)
    for (let i = 0; i < DAOS.length; i++) {
      const dao = DAOS[i];
      
      try {
        logger.info(`[${i + 1}/${DAOS.length}] ${dao.name}`);
        logger.info(`  Source: ${dao.source || 'snapshot'}`);
        logger.info(`  ID: ${dao.id}`);
        if (dao.governorAddress) {
          logger.info(`  Governor: ${dao.governorAddress}`);
        }
        logger.info('');
        
        let proposals: any[] = [];
        
        // Fetch proposals based on source type
        if (dao.source === 'tally' && dao.governorAddress) {
          // Check if this DAO has subDaos
          if (dao.subDaos && dao.subDaos.length > 0) {
            logger.info(`  Fetching from ${dao.subDaos.length} sub-DAO(s)...`);
            // Fetch from all subDaos and aggregate
            for (const subDao of dao.subDaos) {
              logger.info(`    - ${subDao.name} (${subDao.governorAddress})`);
              const subProposals = await fetchTallyProposals(subDao.governorAddress);
              proposals.push(...subProposals);
              logger.info(`      Found ${subProposals.length} proposal(s)`);
              await delay(2000); // Delay between each subDAO fetch
            }
          } else {
            logger.info('  Fetching Tally proposals...');
            proposals = await fetchTallyProposals(dao.governorAddress);
            await delay(2000);
          }
        } else {
          // Default to snapshot or explicit snapshot source
          logger.info('  Fetching Snapshot proposals...');
          proposals = await fetchProposals(dao.id);
        }
        
        if (proposals.length === 0) {
          logger.info(`  ✓ No active proposals`);
          logger.info('');
          continue;
        }
        
        logger.info(`  ✓ Found ${proposals.length} active proposal(s)`);
        totalProposals += proposals.length;
        
        // Get all agents for this space to save vote details for each user
        logger.info('  Fetching agents for this space...');
        const agentsForSpace = await getAgentsForSpace(dao.id);
        const agentAddresses = [...new Set(agentsForSpace.map(a => a.agent.address).filter(Boolean))];
        
        logger.info(`  ✓ Found ${agentAddresses.length} unique agent(s)`);
        
        // Process vote details for each agent
        let updatedCount = 0;
        let skippedCount = 0;
        
        for (const agentData of agentsForSpace) {
          const agentAddress = agentData.agent.address;
          const userAddress = agentData.agent.userAddress;

          if (!agentAddress || !userAddress) {
            logger.warn(`    ⚠️  Agent ${agentAddress} missing userAddress, skipping`);
            continue;
          }

          // Fetch user ethos from DeleGate contract if userAddress is available
          const userEthos = await getUserEthos(userAddress);

          if (userEthos.length < 2) {
            logger.warn(`    ⚠️  No ethos for user ${userAddress}, skipping`);
            continue;
          }
          
          for (const proposal of proposals) {
            // Normalize proposal data between Snapshot and Tally formats
            const normalizedProposal = dao.source === 'tally' ? {
              id: proposal.id,
              title: proposal.title,
              body: proposal.body,
              end: proposal.endBlock, // Tally uses endBlock instead of end
            } : proposal; // Snapshot proposal is already in correct format
            
            try {
              // Check if proposal has changed
              const hasChanged = await hasProposalChanged(
                agentAddress,
                userEthos,
                normalizedProposal.id,
                normalizedProposal.body,
                normalizedProposal.end
              );
              
              if (hasChanged) {
                // Generate AI response for this proposal
                const directive = process.env.AI_DIRECTIVE || "Suggest a vote for the passed proposal based on the ethos of the user. The result must be only a JSON with two elements: 'vote', which can be yes or no, and 'reason', which is the explanation of the reasons considered for the voting decision. The JSON must be formatted as follows: {\"vote\": \"yes\", \"reason\": \"...\"}.";
                
                const aiResponse = await fetchOpenAIResponse(
                  `This is the user ethos: ${userEthos}. ${directive}`,
                  normalizedProposal.body
                );
                
                // Parse AI response
                let aiVoteChoice: 'yes' | 'no' = 'no'; // default
                let reasoning = aiResponse;
                
                try {
                  const parsed = JSON.parse(aiResponse);
                  aiVoteChoice = parsed.vote === 'yes' ? 'yes' : 'no';
                  reasoning = parsed.reason || aiResponse;
                } catch (parseError) {
                  logger.warn(`    ⚠️  Failed to parse AI response for ${normalizedProposal.id}`);
                }
                
                // Save vote details
                await upsertVoteDetails(
                  agentAddress,
                  normalizedProposal.id,
                  dao.id,
                  normalizedProposal.title,
                  normalizedProposal.body,
                  normalizedProposal.end,
                  reasoning,
                  aiVoteChoice,
                  userEthos,
                  userAddress
                );
                
                updatedCount++;
                totalVoteDetails++;
              } else {
                skippedCount++;
              }
            } catch (error) {
              totalErrors++;
              logger.error(`    ✗ Error processing ${normalizedProposal.id}: ${error instanceof Error ? error.message : String(error)}`);
            }
          }
        }
        
        logger.info(`  Processing summary:`);
        logger.info(`    - Updated: ${updatedCount} vote detail(s)`);
        logger.info(`    - Skipped: ${skippedCount} (unchanged)`);
        
        // Process proposals for voting at the right time
        logger.info('  Scheduling votes...');
        await processProposalsForVoting(
          proposals, 
          dao.id, 
          dao.source || 'snapshot',
          dao.governorAddress
        );
        logger.info(`  ✓ Vote scheduling complete`);
        logger.info('');
        
      } catch (error) {
        totalErrors++;
        logger.error(`  ✗ Error processing ${dao.name}: ${error instanceof Error ? error.message : String(error)}`);
        logger.error('');
      }
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    logger.info('========================================');
    logger.info('  CYCLE COMPLETE');
    logger.info('========================================');
    logger.info(`Duration: ${duration}s`);
    logger.info(`Proposals: ${totalProposals}`);
    logger.info(`Vote Details: ${totalVoteDetails}`);
    logger.info(`Errors: ${totalErrors}`);
    logger.info('========================================');
    logger.info('');
    
  } catch (error) {
    logger.error('');
    logger.error('========================================');
    logger.error('  CYCLE FAILED');
    logger.error('========================================');
    logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logger.error(`Stack: ${error.stack}`);
    }
    logger.error('========================================');
    logger.error('');
  }
}
