import snapshot from '@snapshot-labs/snapshot.js';
import { ethers } from 'ethers';
import { KEYRING_GATEWAY_POLYGON, RPC_URL } from './config';
import { publicClient } from './lib/utils';
import logger from './logger';

import KeyringGatewayABI from './artifacts/KeyringGateway.json';
import { getAgentByKmsAddress } from './db/service';
import { Address } from 'viem';
import { inspect } from 'util';

const hub = 'https://hub.snapshot.org'; 
const client = new snapshot.Client712(hub);

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

export const snapshotVote = async (signer: Address, snapshotVote: any) => {
  try {
    const agent = await getAgentByKmsAddress(signer);

    if (!agent) {
      logger.error(`Agent not found for signer: ${signer}`);
      return;
    }

    const wallet = new ethers.Wallet(agent.privateKey, provider);

    console.info(`wallet: ${wallet.address}`);
    console.info(`agent: ${agent.address}`);

    // Convert proposal ID to hex and pad to 64 characters (32 bytes) to ensure even-length
    const proposalHexRaw = BigInt(String(snapshotVote.proposal).replace(/n$/, '')).toString(16);
    const proposalHex = "0x" + proposalHexRaw.padStart(64, '0');
    console.info('proposalHex: ', proposalHex)
    console.info('snapshotVote: ', snapshotVote)
    // Ensure choice is a number for single-choice voting
    const choice = parseInt(String(snapshotVote.choice).replace(/n$/, ''), 10);
    console.info('choice: ', choice)

    const receipt = await client.vote(wallet, agent.address, {
      space: snapshotVote.space,
      proposal: proposalHex,
      type: snapshotVote.type,
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
};

let eventWatcher: any = null;

/**
 * Watch for snapshot vote events from the Keyring Gateway contract
 */
export async function watchSnapshotEvents(): Promise<void> {
  logger.debug(`Starting snapshot event watcher on ${RPC_URL}\nGateway address: ${KEYRING_GATEWAY_POLYGON}`);
  
  try {
    eventWatcher = publicClient.watchContractEvent({
      address: KEYRING_GATEWAY_POLYGON,
      abi: KeyringGatewayABI.abi,
      eventName: 'snapshotSignVote',
      onLogs: logs => {
        logs.forEach((log) => {
          try {
            const { args } = log as any;
            console.log(`Received log args:`, args);
            if (args) {
              // logger.info(`Snapshot vote event received: ${JSON.stringify(log, null, 2)}`);
              // logger.info(`Vote args: ${JSON.stringify(args.vote, null, 2)}`);
              logger.info(`Sender: ${(args.sender)}`);
              // logger.info(`Proposal ID: ${String(args.vote.proposal)}`);
              snapshotVote(args.sender, args.vote);
            }
          } catch (error) {
            logger.error(`Error handling snapshot vote event: ${error instanceof Error ? error.message : String(error)}`);
          }
        });
      },
    });
    
    logger.debug('Snapshot event watcher started successfully');
    return Promise.resolve();
  } catch (error) {
    logger.error(`Failed to start snapshot event watcher: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

/**
 * Unwatch snapshot events (for cleanup)
 */
export function stopSnapshotEvents(): void {
  if (eventWatcher) {
    logger.debug('Stopping snapshot event watcher');
    eventWatcher();
    eventWatcher = null;
  }
}

// Keeping the original main function for backward compatibility
// This allows running the file directly if needed
if (require.main === module) {
  const main = async () => {
    try {
      await watchSnapshotEvents();
      
      // Keep the process running
      process.stdin.resume();
      
      // Handle process termination
      const cleanup = () => {
        logger.info('Cleaning up snapshot executor...');
        stopSnapshotEvents();
        process.exit(0);
      };
      
      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);
      process.on('uncaughtException', (error) => {
        logger.error(`Uncaught exception in snapshot executor: ${error}`);
        cleanup();
      });
    } catch (error) {
      logger.error(`Fatal error in snapshot executor: ${error}`);
      process.exit(1);
    }
  };
  
  main();
}