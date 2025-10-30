import dotenv from 'dotenv';
import path from 'path';
import { DAOConfig } from './types';
import { Address } from 'viem';

dotenv.config();

// Load root .env if exists
dotenv.config({ path: '/app/root.env' });

// Validate required environment variables
if (!process.env.SNAPSHOT_HUB_URL || !process.env.RPC_URL || !process.env.DELEGATE_CONTRACT_ADDRESS || !process.env.KEYRING_GATEWAY_POLYGON) {
  throw new Error('Missing required environment variables. Check your .env file.');
}

// Override SNAPSHOT_HUB_URL if TEST_ENV is true
let snapshotHubUrl = process.env.SNAPSHOT_HUB_URL;
if (process.env.TEST_ENV === 'true') {
  snapshotHubUrl = 'http://test-env:5001/graphql';
}

export const SNAPSHOT_HUB_URL = snapshotHubUrl;
export const RPC_URL = process.env.RPC_URL;
export const PRIVATE_KEY = process.env.PRIVATE_KEY;
export const REL_CHAIN = process.env.REL_CHAIN;
export const DELEGATE_CONTRACT_ADDRESS = process.env.DELEGATE_CONTRACT_ADDRESS as Address; 
export const KEYRING_GATEWAY_POLYGON = process.env.KEYRING_GATEWAY_POLYGON as Address;

// Legacy aliases for backwards compatibility
export const KEYRING_GATEWAY_CONTRACT_ADDRESS = KEYRING_GATEWAY_POLYGON;
export const TALLY_KEYRING_GATEWAY_CONTRACT_ADDRESS = KEYRING_GATEWAY_POLYGON;
export const TALLY_API_URL = process.env.TALLY_API_URL || 'https://api.tally.xyz/query';
export const TALLY_API_KEY = process.env.TALLY_API_KEY || '';

console.log('SNAPSHOT_HUB_URL:', SNAPSHOT_HUB_URL);
console.log('TEST_ENV:', process.env.TEST_ENV);
console.log('TEST_FETCH_SCHEDULE:', process.env.TEST_FETCH_SCHEDULE);
console.log('TEST_START_PROPOSAL:', process.env.TEST_START_PROPOSAL);
console.log('TEST_END_PROPOSAL:', process.env.TEST_END_PROPOSAL);

console.log('Delegate contract address:', DELEGATE_CONTRACT_ADDRESS);

// Cron schedule for fetching proposals (default: every day at 8am)
//export const FETCH_SCHEDULE = process.env.FETCH_SCHEDULE || '0 8 * * *';
let fetchSchedule = process.env.FETCH_SCHEDULE || '0 8 * * *';
if (process.env.TEST_ENV === 'true') {
  fetchSchedule = process.env.TEST_FETCH_SCHEDULE || '* * * * *';
}

export const FETCH_SCHEDULE = fetchSchedule;

// How many minutes before a proposal ends should we cast our vote
export const VOTE_MIN_BEFORE_END = parseInt(process.env.VOTE_MIN_BEFORE_END || '689', 10);

// How often to check for pending votes (in milliseconds)
export const VOTE_POLLER_INTERVAL = parseInt(process.env.VOTE_POLLER_INTERVAL || '60000', 10);

// MongoDB connection URI
export const MONGODB_URI = process.env.MONGODB_URI || '';

// API server port
export const API_PORT = parseInt(process.env.API_PORT || '3000', 10);

// List of DAOs to monitor
export const DAOS: DAOConfig[] = process.env.TEST_ENV === 'true'
  ? [
      {
        id: 'DAO_test',
        name: 'DAO Test',
        defaultVote: 0,
        source: 'snapshot',
      }
    ]
  : [
      {
        id: 'balancer.eth',
        name: 'Balancer',
        defaultVote: 0,
        source: 'snapshot',
      },
      {
        id: 'aavedao.eth',
        name: 'Aave',
        defaultVote: 0,
        source: 'snapshot',
      },
      {
        id: 'arbitrumfoundation.eth',
        name: 'Arbitrum',
        defaultVote: 0,
        source: 'snapshot'
      },
      {
        id: 'gnosis.eth',
        name: 'Gnosis',
        defaultVote: 0,
        source: 'snapshot'
      },
      {
        id: 'lido-snapshot.eth',
        name: 'Lido',
        defaultVote: 0,
        source: 'snapshot'
      },
      {
        id: 'eip155:42161:0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9',
        name: 'Arbitrum DAO',
        defaultVote: 0,
        governorAddress: '0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9',
        source: 'tally',
        subDaos: [
          {
            name: 'Arbitrum Core',
            id: 'eip155:42161:0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9',
            governorAddress: '0xf07DeD9dC292157749B6Fd268E37DF6EA38395B9',
            source: 'tally'
          },
          {
            name: 'Arbitrum Treasury',
            id: 'eip155:42161:0x789fC99093B09aD01C34DC7251D0C89ce743e5a4',
            governorAddress: '0x789fC99093B09aD01C34DC7251D0C89ce743e5a4',
            source: 'tally'
          }
        ]
      },
      {
        id: 'uniswapgovernance.eth',
        name: 'Uniswap',
        defaultVote: 0, // Vote for first option by default
        source: 'snapshot'
      },
      {
        id: 'eip155:1:0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        name: 'Uniswap DAO',
        defaultVote: 0,
        governorAddress: '0x408ED6354d4973f66138C91495F2f2FCbd8724C3',
        source: 'tally',
      },
      {
        id: 'polygonvalidators.eth',
        name: 'Polygon Validators',
        defaultVote: 0,
        source: 'snapshot'
      },
      {
        id: 'qidao.eth',
        name: 'Qi Dao',
        defaultVote: 0,
        source: 'snapshot'
      },
      {
        id: 'quickvote.eth',
        name: 'QuickVote',
        defaultVote: 0,
        source: 'snapshot'
      },
    ];