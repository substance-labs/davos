import { getScheduledVotes, getUpcomingVotes, initializeDatabase } from '../db/service';
import { MONGODB_URI } from '../config';
import logger from '../logger';

async function main() {
  // Connect to database
  await initializeDatabase(MONGODB_URI);
  
  const command = process.argv[2] || 'upcoming';
  const param = process.argv[3];
  
  try {
    switch (command) {
      case 'upcoming':
        const hours = param ? parseInt(param, 10) : 24;
        const upcomingVotes = await getUpcomingVotes(hours);
        logger.info(`Upcoming votes in the next ${hours} hours:`);
        upcomingVotes.forEach(vote => {
          const agent = vote.agentId as any;
          logger.info(`- ${vote.proposalTitle} (${vote.proposalId})`);
          logger.info(`  Space: ${vote.spaceId}`);
          logger.info(`  Agent: ${agent.name}`);
          logger.info(`  Scheduled: ${vote.scheduledTime.toISOString()}`);
          logger.info('---');
        });
        break;
        
      case 'space':
        if (!param) {
          logger.error('Please provide a space ID');
          process.exit(1);
        }
        const spaceVotes = await getScheduledVotes({ spaceId: param });
        logger.info(`Votes for space ${param}:`);
        spaceVotes.forEach(vote => {
          logger.info(`- ${vote.proposalTitle} (${vote.status})`);
          logger.info(`  Scheduled: ${vote.scheduledTime.toISOString()}`);
          logger.info('---');
        });
        break;
        
      default:
        logger.info('Commands: upcoming [hours], space [spaceId]');
    }
  } catch (error) {
    logger.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
  
  process.exit(0);
}

main();