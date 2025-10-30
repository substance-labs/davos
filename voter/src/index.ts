import cron from 'node-cron';
import dotenv from 'dotenv';
import { FETCH_SCHEDULE } from './config';
import { startScheduler } from './scheduler';
import { startVotePollingService } from './voter';
import { initializeDatabase } from './db/service';
import { startApiServer } from './api/server';
import { MONGODB_URI, API_PORT } from './config';
import logger from './logger';
import { watchSnapshotEvents, stopSnapshotEvents } from './snapshot_executor';
import { startEthosWatcher } from './ethosWatcher';

dotenv.config();

/**
 * Print startup banner with service information
 */
function printStartupBanner(): void {
  console.log('\n');
  console.log('========================================');
  console.log('    DAVOS VOTER SERVICE');
  console.log('========================================');
  console.log('');
  console.log('Autonomous DAO Voting System');
  console.log(`Version: ${process.env.npm_package_version || '1.0.0'}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('');
  console.log('========================================');
  console.log('\n');
}

/**
 * Initialize all services in the correct order
 */
async function initializeServices(): Promise<void> {
  logger.info('Step 1/5: Connecting to database...');
  await initializeDatabase(MONGODB_URI);
  logger.info('✓ Database connected successfully');
  
  logger.info('Step 2/5: Starting proposal scheduler...');
  startScheduler();
  logger.info(`✓ Scheduler started (cron: ${FETCH_SCHEDULE})`);
  
  logger.info('Step 3/5: Starting vote polling service...');
  startVotePollingService();
  logger.info('✓ Vote polling service started');
  
  logger.info('Step 4/5: Starting API server...');
  startApiServer(API_PORT);
  logger.info(`✓ API server listening on port ${API_PORT}`);
  
  logger.info('Step 5/5: Starting ethos event watcher...');
  startEthosWatcher();
  logger.info('✓ Ethos watcher monitoring on-chain events');
  
  // Note: Snapshot event executor is disabled - voting handled by scheduler
  // Note: Tally event executor is disabled - voting handled by scheduler
}

/**
 * Handle graceful shutdown
 */
function setupGracefulShutdown(): void {
  const shutdown = (signal: string) => {
    logger.info(`\nReceived ${signal}. Initiating graceful shutdown...`);
    
    try {
      logger.info('Stopping event watchers...');
      stopSnapshotEvents();
      logger.info('✓ Event watchers stopped');
      
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (error) {
      logger.error(`Error during shutdown: ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  };
  
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  
  process.on('uncaughtException', (error) => {
    logger.error(`Uncaught exception: ${error.message}`);
    logger.error(`Stack: ${error.stack}`);
    process.exit(1);
  });
  
  process.on('unhandledRejection', (reason, promise) => {
    logger.error(`Unhandled rejection at: ${promise}`);
    logger.error(`Reason: ${reason}`);
    process.exit(1);
  });
}

/**
 * Main application entry point
 */
async function main() {
  try {
    printStartupBanner();
    
    logger.info('Initializing Davos Voter Service...');
    logger.info('');
    
    await initializeServices();
    
    logger.info('');
    logger.info('========================================');
    logger.info('    SERVICE READY');
    logger.info('========================================');
    logger.info('');
    logger.info(`API: http://localhost:${API_PORT}`);
    logger.info('Health: http://localhost:' + API_PORT + '/health');
    logger.info('');
    
  } catch (error) {
    logger.error('');
    logger.error('========================================');
    logger.error('    STARTUP FAILED');
    logger.error('========================================');
    logger.error('');
    logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.stack) {
      logger.error(`Stack: ${error.stack}`);
    }
    logger.error('');
    process.exit(1);
  }
}

// Setup signal handlers
setupGracefulShutdown();

// Run the application
main();
