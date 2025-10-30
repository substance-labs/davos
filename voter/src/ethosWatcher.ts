import { publicClient } from './lib/utils';
import { DELEGATE_CONTRACT_ADDRESS } from './config';
import DeleGateABI from './artifacts/DeleGate.json';
import logger from './logger';
import { refreshVoteDetailsForUser } from './db/service';

/**
 * Start watching for EthosDefined events from the DeleGate contract
 * When a user updates their ethos, automatically refresh their vote details
 */
export function startEthosWatcher(): void {
  logger.info('=== Initializing Ethos Event Watcher ===');
  logger.info(`Contract: ${DELEGATE_CONTRACT_ADDRESS}`);
  logger.info('Event: EthosDefined');
  logger.info('');
  
  const unwatch = publicClient.watchContractEvent({
    address: DELEGATE_CONTRACT_ADDRESS,
    abi: DeleGateABI.abi,
    eventName: 'EthosDefined',
    onLogs: async (logs) => {
      logger.info(`Received ${logs.length} EthosDefined event(s)`);
      
      for (const log of logs) {
        try {
          // Extract event data
          const user = (log as any).args?.user as string;
          const ethosData = (log as any).args?.ethos as { ethos: string };
          
          if (!user || !ethosData) {
            logger.warn('⚠️  Event missing required data, skipping...');
            continue;
          }
          
          const ethosPreview = ethosData.ethos.length > 100 
            ? `${ethosData.ethos.substring(0, 100)}...` 
            : ethosData.ethos;
          
          logger.info('');
          logger.info('--- Ethos Update Detected ---');
          logger.info(`User: ${user}`);
          logger.info(`New Ethos: ${ethosPreview}`);
          logger.info(`Block: ${log.blockNumber}`);
          logger.info(`Transaction: ${log.transactionHash}`);
          logger.info('');
          
          logger.info('Refreshing vote details for user...');
          const result = await refreshVoteDetailsForUser(user, ethosData.ethos);
          
          if (result.updatedCount > 0) {
            logger.info(`✓ Successfully refreshed ${result.updatedCount} vote detail(s)`);
            logger.info(`  Updated proposals:`);
            result.details
              .filter(d => d.updated)
              .forEach(d => {
                logger.info(`    - ${d.proposalId} (agent: ${d.agentAddress.substring(0, 10)}...)`);
              });
          } else {
            logger.info('No vote details required updating');
          }
          logger.info('--- Update Complete ---');
          logger.info('');
          
        } catch (error) {
          logger.error('');
          logger.error('--- Event Processing Error ---');
          logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
          if (error instanceof Error && error.stack) {
            logger.error(`Stack: ${error.stack}`);
          }
          logger.error('--- Error End ---');
          logger.error('');
        }
      }
    },
    onError: (error) => {
      logger.error('');
      logger.error('--- Watcher Error ---');
      logger.error(`Error: ${error.message}`);
      if (error.stack) {
        logger.error(`Stack: ${error.stack}`);
      }
      logger.error('--- Error End ---');
      logger.error('');
    }
  });
  
  logger.info('✓ Ethos watcher active and monitoring blockchain');
  logger.info('');
  
  // Handle graceful shutdown
  const stopWatcher = () => {
    logger.info('Stopping EthosDefined watcher...');
    unwatch();
  };
  
  process.on('SIGINT', stopWatcher);
  process.on('SIGTERM', stopWatcher);
}
