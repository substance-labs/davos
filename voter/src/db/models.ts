import mongoose, { Schema, Document } from 'mongoose';

export interface IAgent extends Document {
  address: string;
  privateKey: string;
  name: string;
  active: boolean;
  kmsAdapterAddress?: string;
  userAddress?: string;  // Add user/voter address
  createdAt: Date;
  updatedAt: Date;
}

export interface IAgentSpace extends Document {
  agentId: mongoose.Types.ObjectId;
  spaceId: string; // The space/DAO ID (e.g., "uniswap.eth")
  defaultVote: number;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface IScheduledVote extends Document {
  proposalId: string;
  proposalTitle: string;
  spaceId: string;
  agentId: mongoose.Types.ObjectId;
  scheduledTime: Date;
  status: 'scheduled' | 'completed' | 'failed';
  source?: 'snapshot' | 'tally'; // Track proposal source for correct voting method
  governorAddress?: string; // For Tally proposals
  executedAt?: Date;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface IVoteDetails extends Document {
  userAddress: string;        // Wallet address of the user
  agentAddress: string;       // Agent address that will cast the vote
  proposalId: string;         // Snapshot proposal ID
  spaceId: string;            // DAO space ID
  proposalTitle: string;      // Proposal title
  proposalText: string;       // Full proposal text
  proposalChoices: string[];  // Available voting choices (e.g., ["YAE", "NAY", "Abstain"])
  proposalTextHash: string;   // Hash of proposal text for change detection
  lastUpdated: number;        // Timestamp when proposal was last updated
  aiResponse: string;         // AI reasoning text
  aiVoteChoice: 'yes' | 'no'; // AI suggested vote
  userVoteChoice?: 'yes' | 'no'; // Actual user vote (if different from AI)
  userEthos: string;          // User's ethos used for AI decision
  status: 'pending' | 'voted' | 'expired';
  // Vote receipt fields (populated after successful vote)
  voteReceiptId?: string;     // Vote transaction ID from Snapshot
  voteReceiptIpfs?: string;   // IPFS hash of the vote
  voteRelayerAddress?: string; // Relayer address that processed the vote
  voteRelayerReceipt?: string; // Relayer receipt/signature
  votedAt?: Date;             // Timestamp when the vote was cast
  createdAt: Date;
  updatedAt: Date;
  lastChecked: Date;          // When we last verified proposal text
}

export interface IVotingPower extends Document {
  agentAddress: string;       // Agent address (voter)
  proposalId: string;         // Snapshot proposal ID
  spaceId: string;            // DAO space ID
  vp: number;                 // Total voting power
  vpByStrategy: number[];     // Voting power by each strategy
  vpState: string;            // 'valid', 'invalid', or 'loading'
  proposalEnd: number;        // Proposal end timestamp
  proposalStart: number;      // Proposal start timestamp
  canVote: boolean;           // Whether agent can vote (vp > 0 and valid state)
  scheduledVoteTime?: Date;   // When the vote is scheduled (if applicable)
  lastChecked: Date;          // When we last checked the voting power
  createdAt: Date;
  updatedAt: Date;
}

const AgentSchema = new Schema<IAgent>(
  {
    address: { type: String, required: true, unique: true },
    privateKey: { type: String, required: true },
    name: { type: String, required: true },
    active: { type: Boolean, default: true },
    kmsAdapterAddress: { type: String },
    userAddress: { type: String }  // Add user/voter address
  },
  { timestamps: true }
);

const AgentSpaceSchema = new Schema<IAgentSpace>(
  {
    agentId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Agent',
      required: true 
    },
    spaceId: { type: String, required: true },
    defaultVote: { type: Number, default: 1 },
    active: { type: Boolean, default: true }
  },
  { timestamps: true }
);

// Create a compound index to ensure uniqueness of agent-space combinations
AgentSpaceSchema.index({ agentId: 1, spaceId: 1 }, { unique: true });

const ScheduledVoteSchema = new Schema<IScheduledVote>(
  {
    proposalId: { type: String, required: true },
    proposalTitle: { type: String, required: true },
    spaceId: { type: String, required: true },
    agentId: { 
      type: Schema.Types.ObjectId, 
      ref: 'Agent',
      required: true 
    },
    scheduledTime: { type: Date, required: true, index: true },
    status: { 
      type: String, 
      required: true, 
      enum: ['scheduled', 'completed', 'failed'],
      default: 'scheduled'
    },
    source: { type: String, enum: ['snapshot', 'tally'], default: 'snapshot' }, // Default to snapshot for backwards compatibility
    governorAddress: { type: String }, // For Tally proposals
    executedAt: { type: Date },
    error: { type: String }
  },
  { timestamps: true }
);

// Create a compound index for faster querying
ScheduledVoteSchema.index({ status: 1, scheduledTime: 1 });

const VoteDetailsSchema = new Schema<IVoteDetails>(
  {
    userAddress: { type: String, required: true, index: true },
    agentAddress: { type: String, required: true, index: true },
    proposalId: { type: String, required: true, index: true },
    spaceId: { type: String, required: true, index: true },
    proposalTitle: { type: String, required: true },
    proposalText: { type: String, required: true },
    proposalChoices: { type: [String], default: ['For', 'Against', 'Abstain'] },
    proposalTextHash: { type: String, required: true },
    lastUpdated: { type: Number, required: true },
    aiResponse: { type: String, required: true },
    aiVoteChoice: { type: String, required: true, enum: ['yes', 'no'] },
    userVoteChoice: { type: String, enum: ['yes', 'no'] },
    userEthos: { type: String, required: true },
    status: { type: String, required: true, enum: ['pending', 'voted', 'expired'], default: 'pending' },
    lastChecked: { type: Date, default: Date.now },
    // Vote receipt fields
    voteReceiptId: { type: String },
    voteReceiptIpfs: { type: String },
    voteRelayerAddress: { type: String },
    voteRelayerReceipt: { type: String },
    votedAt: { type: Date }
  },
  { timestamps: true }
);

// Create compound indexes for efficient queries
VoteDetailsSchema.index({ userAddress: 1, proposalId: 1 }, { unique: true });
VoteDetailsSchema.index({ userAddress: 1, status: 1 });
VoteDetailsSchema.index({ spaceId: 1, status: 1 });

const VotingPowerSchema = new Schema<IVotingPower>(
  {
    agentAddress: { type: String, required: true, index: true },
    proposalId: { type: String, required: true, index: true },
    spaceId: { type: String, required: true, index: true },
    vp: { type: Number, required: true, default: 0 },
    vpByStrategy: { type: [Number], default: [] },
    vpState: { type: String, required: true, default: 'loading' },
    proposalEnd: { type: Number, required: true },
    proposalStart: { type: Number, required: true },
    canVote: { type: Boolean, required: true, default: false },
    scheduledVoteTime: { type: Date },
    lastChecked: { type: Date, default: Date.now }
  },
  { timestamps: true }
);

// Create compound indexes for efficient queries
VotingPowerSchema.index({ agentAddress: 1, proposalId: 1 }, { unique: true });
VotingPowerSchema.index({ spaceId: 1, proposalEnd: 1 });

export const Agent = mongoose.model<IAgent>('Agent', AgentSchema);
export const AgentSpace = mongoose.model<IAgentSpace>('AgentSpace', AgentSpaceSchema);
export const ScheduledVote = mongoose.model<IScheduledVote>('ScheduledVote', ScheduledVoteSchema);
export const VoteDetails = mongoose.model<IVoteDetails>('VoteDetails', VoteDetailsSchema);
export const VotingPower = mongoose.model<IVotingPower>('VotingPower', VotingPowerSchema);