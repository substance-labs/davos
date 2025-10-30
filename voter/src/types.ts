export interface SnapshotProposal {
    id: string;
    title: string;
    body: string;
    choices: string[];
    start: number;
    end: number;
    snapshot: string;
    state: string;
    author: string;
    space: {
      id: string;
      name: string;
    };
  }
  
  export interface VoteParams {
    space: string;
    proposal: string;
    type: string;
    choice: number;
  }
  
  export interface TallyProposal {
    id: string;
    governorAddress: string;
    proposalId: string; // On-chain proposal ID
    title: string;
    body: string;
    state: number; // ProposalState enum: 0=Pending, 1=Active, 2=Canceled, 3=Defeated, 4=Succeeded, 5=Queued, 6=Expired, 7=Executed
    startBlock: number;
    endBlock: number;
    forVotes: string; // BigNumber as string
    againstVotes: string;
    abstainVotes: string;
    proposer: string;
  }
  
  export interface TallyVoteParams {
    governorAddress: string;
    proposalId: string;
    support: 0 | 1 | 2; // 0 = Against, 1 = For, 2 = Abstain
    reason?: string;
  }
  
  export interface DAOConfig {
    id: string;
    name: string;
    defaultVote: number; // Default voting choice (1-based index)
    strategy?: string; // Optional voting strategy
    governorAddress?: string; // Tally-specific: Governor contract address
    source: 'snapshot' | 'tally'; // Data source for proposals (defaults to 'snapshot')
    subDaos?: Array<{
      name: string;
      id: string;
      governorAddress: string;
      source: 'snapshot' | 'tally';
    }>; // Optional sub-DAOs to aggregate proposals from
  }