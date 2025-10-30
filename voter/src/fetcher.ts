import axios from 'axios';
import { SNAPSHOT_HUB_URL, TALLY_API_URL, TALLY_API_KEY } from './config';
import { SnapshotProposal, TallyProposal } from './types';
import logger from './logger';

// Simple in-memory cache for Tally proposals to avoid rate limiting
const tallyCache = new Map<string, { data: TallyProposal[], timestamp: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Delay helper to add pauses between API calls
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetches active proposals from a given space (DAO)
 */
export async function fetchProposals(spaceId: string): Promise<SnapshotProposal[]> {
  try {
    // Current time in seconds
    const currentTimeSeconds = Math.floor(Date.now() / 1000);
    
    // Ensure we're using the /graphql endpoint
    const graphqlUrl = SNAPSHOT_HUB_URL.endsWith('/graphql') 
      ? SNAPSHOT_HUB_URL 
      : `${SNAPSHOT_HUB_URL}/graphql`;
    
    const query = `
      query {
        proposals(
          first: 100,
          skip: 0,
          where: {
            space_in: ["${spaceId}"],
            state: "active"
          },
          orderBy: "created",
          orderDirection: desc
        ) {
          id
          title
          body
          choices
          start
          end
          snapshot
          state
          author
          space {
            id
            name
          }
        }
      }
    `;

    logger.debug(`Fetching proposals for DAO: ${spaceId}`);
    logger.debug(`Using GraphQL endpoint: ${graphqlUrl}`);
    
    const response = await fetch(graphqlUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Body: ${errorText}`);
    }

    const data = await response.json();
    
    if (data.errors) {
      throw new Error(`GraphQL error: ${JSON.stringify(data.errors)}`);
    }
    
    if (!data.data || !data.data.proposals) {
      logger.warn(`Unexpected API response structure: ${JSON.stringify(data)}`);
      return [];
    }
    
    const proposals = data.data.proposals;
    
    // Debug log the entire response
    // logger.info(`API Response: ${JSON.stringify(data, null, 2)}`);
    
    // Log all proposals found before filtering
    logger.info(`Found ${proposals.length} proposals for ${spaceId} before filtering:`);
    proposals.forEach((p: SnapshotProposal) => {
      const endDate = new Date(p.end * 1000).toISOString();
      logger.info(`- ID: ${p.id}, Title: ${p.title}, End time: ${endDate}, Space: ${p.space.id}`);
    });
    
    return proposals;
  } catch (error) {
    logger.error(`Failed to fetch proposals for ${spaceId}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

/**
 * Fetches active proposals from a Tally Governor contract
 */
export async function fetchTallyProposals(governorAddress: string): Promise<TallyProposal[]> {
  try {
    if (!TALLY_API_URL) {
      logger.warn('TALLY_API_URL not configured, skipping Tally proposal fetch');
      return [];
    }

    // Check cache first to avoid any API calls
    const cacheKey = `tally_${governorAddress}`;
    const cached = tallyCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL) {
      logger.info(`Using cached proposals for ${governorAddress} (${cached.data.length} proposals, age: ${Math.round((Date.now() - cached.timestamp) / 1000)}s)`);
      return cached.data;
    }

    const query = `
      query {
        governor(input: {id: "eip155:42161:${governorAddress}"}) {
          id
          name
          organization {
            id
            name
          }
          proposalStats {
            total
            active
          }
        }
      }
    `;

    logger.info(`Fetching Tally proposals for Governor: ${governorAddress}`);
    logger.info(`Using Tally API endpoint: ${TALLY_API_URL}`);

    const response = await fetch(TALLY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TALLY_API_KEY ? { 'Api-Key': TALLY_API_KEY } : {}),
      },
      body: JSON.stringify({ query }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`HTTP error! Status: ${response.status}, Body: ${errorText}`);
    }

    const data = await response.json();

    if (data.errors) {
      throw new Error(`GraphQL error: ${JSON.stringify(data.errors)}`);
    }

    if (!data.data || !data.data.governor) {
      logger.warn(`No governor found for address: ${governorAddress}`);
      return [];
    }

    const governor = data.data.governor;
    if (!data.data || !data.data.governor) {
      logger.warn(`No governor found for address ${governorAddress}`);
      return [];
    }

    logger.info(`Found governor: ${data.data.governor.name}`);
    
    // Add delay to avoid rate limiting (wait 2 seconds between calls)
    await delay(2000);
    
    // Now fetch the actual proposals for this governor - using exact working query from frontend
    const proposalsQuery = `
      query Proposals($input: ProposalsInput!) {
        proposals(input: $input) {
          nodes {
            ... on Proposal {
              id
              metadata {
                title
                description
              }
              block {
                number
                timestamp
              }
              status
              start {
                __typename
                ... on Block {
                  number
                  timestamp
                }
                ... on BlocklessTimestamp {
                  timestamp
                }
              }
              end {
                __typename
                ... on Block {
                  number
                  timestamp
                }
                ... on BlocklessTimestamp {
                  timestamp
                }
              }
              voteStats {
                type
                votesCount
                votersCount
                percent
              }
            }
          }
          pageInfo {
            firstCursor
            lastCursor
            count
          }
        }
      }
    `;

    const proposalsResponse = await fetch(TALLY_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(TALLY_API_KEY ? { 'Api-Key': TALLY_API_KEY } : {}),
      },
      body: JSON.stringify({ 
        query: proposalsQuery,
        variables: {
          input: {
            filters: { governorId: governor.id },
            page: { limit: 100 },
            sort: {
              sortBy: 'id',
              isDescending: true,
            },
          },
        },
      }),
    });

    if (!proposalsResponse.ok) {
      const errorText = await proposalsResponse.text();
      throw new Error(`HTTP error fetching proposals! Status: ${proposalsResponse.status}, Body: ${errorText}`);
    }

    const proposalsData = await proposalsResponse.json();

    if (proposalsData.errors) {
      throw new Error(`GraphQL error fetching proposals: ${JSON.stringify(proposalsData.errors)}`);
    }

    const proposals = proposalsData.data?.proposals?.nodes || [];
    
    // Log proposal statuses for debugging
    if (proposals.length > 0) {
      logger.info(`Proposal statuses: ${proposals.slice(0, 5).map((p: any) => `${p.metadata?.title?.substring(0, 30)}: ${p.status}`).join(', ')}`);
    }
    
    // Filter active proposals - match frontend logic that treats multiple statuses as "active"
    // Note: Tally API returns status in lowercase, so we need case-insensitive comparison
    const activeStatuses = ['ACTIVE', 'QUEUED', 'PENDINGEXECUTION', 'CROSSCHAINQUEUED', 'CROSSCHAINPENDINGEXECUTION'];
    const activeProposals = proposals
      .filter((p: any) => activeStatuses.includes(p.status?.toUpperCase()))
      .map((p: any) => ({
        id: p.id,
        title: p.metadata?.title || 'Untitled',
        body: p.metadata?.description || '',
        state: 'active',
        // Convert timestamp strings to Unix timestamps (seconds)
        end: p.end?.timestamp ? Math.floor(new Date(p.end.timestamp).getTime() / 1000) : 0,
        endBlock: p.end?.timestamp ? Math.floor(new Date(p.end.timestamp).getTime() / 1000) : 0,
      }));

    logger.info(`Found ${activeProposals.length} active proposals out of ${proposals.length} total proposals`);
    
    // Only cache if we got actual data (don't cache empty results from rate limit errors)
    if (proposals.length > 0) {
      tallyCache.set(cacheKey, { data: activeProposals, timestamp: Date.now() });
      logger.info(`Cached ${activeProposals.length} active proposals for ${governorAddress}`);
    } else {
      logger.warn(`Not caching empty result for ${governorAddress} - likely no proposals exist`);
    }
    
    return activeProposals;
  } catch (error) {
    logger.error(`Failed to fetch Tally proposals for ${governorAddress}: ${error instanceof Error ? error.message : String(error)}`);
    // Clear any stale cache on error to allow retry
    const cacheKey = `tally_${governorAddress}`;
    tallyCache.delete(cacheKey);
    logger.info(`Cleared cache for ${governorAddress} due to error`);
    return [];
  }
}

/**
 * Filters proposals that will end within the next 24 hours from now
 */
// export function filterProposalsEndingWithin24Hours(
//   proposals: SnapshotProposal[]
// ): SnapshotProposal[] {
//   // Current time in seconds
//   const currentTimeSeconds = Math.floor(Date.now() / 1000);
  
//   // 24 hours from now in seconds (24 * 60 * 60 = 86400 seconds)
//   const twentyFourHoursLaterSeconds = currentTimeSeconds + 86400;
  
//   // Log filtering parameters
//   logger.info(`Filtering proposals ending within 24 hours: current time=${new Date(currentTimeSeconds * 1000).toISOString()}, 24h later=${new Date(twentyFourHoursLaterSeconds * 1000).toISOString()}`);
  
//   const filteredProposals = proposals.filter(proposal => 
//     proposal.end >= currentTimeSeconds && // Not yet ended
//     proposal.end <= twentyFourHoursLaterSeconds // Will end within 24 hours
//   );
  
//   // Log filtered proposals
//   logger.info(`After filtering, ${filteredProposals.length} proposals will end within the next 24 hours`);
//   filteredProposals.forEach((p: SnapshotProposal) => {
//     const endDate = new Date(p.end * 1000).toISOString();
//     const hoursUntilEnd = Math.round((p.end - currentTimeSeconds) / 3600 * 10) / 10;
//     logger.info(`- SELECTED: ID: ${p.id}, Title: ${p.title}, End time: ${endDate} (in ${hoursUntilEnd} hours), Space: ${p.space.id}`);
//   });
  
//   return filteredProposals;
// }