import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { 
  addAgent, 
  addAgentToSpace, 
  removeAgentFromSpace, 
  getAllAgents, 
  getAgentsForSpace, 
  getAllActiveSpaces,
  isAgentInSpace,
  getAgentById,
  getAgentByAddress,
  getScheduledVotes,
  getScheduledVoteById,
  countScheduledVotes,
  getUpcomingVotes,
  getVoteStatistics,
  markVoteCompleted,
  upsertVoteDetails,
  getVoteDetailsByUserAddress,
  getUserVoteDetails,
  updateUserVote,
  hasProposalChanged,
  updateProposalCheck,
  markVoteExpired,
} from '../db/service';
import logger from '../logger';
import { deployKmsAdapter, getAgentAccountFromAddress, getAgentsByUserAddress, getKmsAddress, publicClient, walletClient } from '../lib/utils';
import { Address, getCreateAddress } from 'viem';
import DeleGateABI from '../artifacts/DeleGate.json';
import { DELEGATE_CONTRACT_ADDRESS, KEYRING_GATEWAY_CONTRACT_ADDRESS } from '../config';
import { IAgent } from '../db/models';
import { KmsDeployError } from '../lib/errors';
import { runFetchAndSchedule } from '../scheduler';
import {
  castVote 
} from '../voter';
import { SnapshotProposal } from '../types';
import { fetchOpenAIResponse } from '../ai-parser';

const app = express();

// Middleware
app.use(helmet());
app.use(cors());

// Increase JSON payload size limit (adjust the limit as needed)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Log all requests
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// Routes
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Init Agent registration
app.post('/init-agent', async (req, res) => {
  try {
    const { userAddress, spaceId, source = 'snapshot' } = req.body;
    
    // Validate that address is provided
    if (!userAddress) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: userAddress'
      });
    }

    if (!spaceId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter: spaceId'
      });
    }

    // Only check DeleGate subscriptions for Snapshot DAOs
    // Tally DAOs handle delegation directly on the Governor contract via frontend
    // NOTE: For now, we skip the DeleGate check since we're just predicting addresses
    // The DeleGate contract address is on POLYGON, but we're configured for POLYGON anyway
    // This check can be re-enabled if we need to fetch existing subscriptions
    // if (source !== 'tally') {
    //   ... subscription check code ...
    // }

    // Check if the user already has an agent
    const existingAgent = await getAgentsByUserAddress(userAddress);

    if (existingAgent && existingAgent.length > 0) {
      // Filter agents to only those in the requested space
      const agentsInSpace = await Promise.all(
        existingAgent.map(async (agent) => {
          // Use proper type assertion to help TypeScript understand the document structure
          const agentDoc = agent as IAgent & { _id: { toString(): string } };
          const inSpace = await isAgentInSpace(agentDoc._id.toString(), spaceId);
          return inSpace ? agentDoc : null;
        })
      );

      // Get the first agent that's in the space
      const matchingAgent = agentsInSpace.filter(Boolean)[0];
      
      if (matchingAgent) {
        return res.status(200).json({
          success: true,
          predictedAgentAddress: matchingAgent.address,
          isMatchingSpace: true,
          isActive: false
        });
      }
      
      // If no agent matches the space, return the first agent with a flag
      return res.status(200).json({
        success: true,
        predictedAgentAddress: existingAgent[0].address,
        isMatchingSpace: false,
        isActive: false
      });
    }
    
    // Validate address format using Viem's Address type
    try {
      // For Tally DAOs, use a fixed nonce (0) since we don't query on-chain subscriptions
      // For Snapshot DAOs, we query the chain to get the actual nonce
      let predictedKMSAddress: Address;
      
      if (source === 'tally') {
        // Use fixed nonce for Tally - no on-chain subscription check needed
        predictedKMSAddress = getCreateAddress({
          from: userAddress as Address,
          nonce: BigInt(0)
        });
      } else {
        // For Snapshot DAOs, just use fixed nonce 0 as well
        // (We don't need to query the actual nonce for address prediction)
        predictedKMSAddress = getCreateAddress({
          from: userAddress as Address,
          nonce: BigInt(0)
        });
      }
      
      console.info('Predicted KMS Address:', predictedKMSAddress);

      const { address: predictedAgentAddress } = getAgentAccountFromAddress(predictedKMSAddress);
      console.info('Predicted Agent Address:', predictedAgentAddress);
      
      return res.status(200).json({
        success: true,
        predictedAgentAddress,
        isMatchingSpace: false,
        isActive: false
      });
    } catch (error) {
      logger.error(`Caught error in init-agent: ${error instanceof Error ? error.message : String(error)}`);
      return res.status(400).json({
        success: false,
        error: 'Invalid Ethereum address format'
      });
    }
  } catch (error: any) {
    logger.error(`API error predicting KMS address: ${error.message}`);
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get or deploy KMS adapter
app.post('/get-kms', async (req, res) => {
  try {
    // Extract parameters from request body
    const { userAddress, source = 'snapshot' } = req.body as { userAddress?: Address; source?: string };
    
    // Validate input
    if (!userAddress) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameter: userAddress' 
      });
    }

    // Check if KMS adapter already exists
    let kmsAddress: Address | undefined;
    try {
      kmsAddress = await publicClient.readContract({
        address: DELEGATE_CONTRACT_ADDRESS,
        abi: DeleGateABI.abi,
        functionName: 'getUserKmsAdapter',
        args: [userAddress],
      }) as Address;
    } catch (readError) {
      logger.info(`No existing KMS adapter found for user ${userAddress}, will deploy new one`);
      kmsAddress = undefined;
    }

    console.info('KMS Address:', kmsAddress);

    const result: {
      success: boolean;
      kmsAddress: string;
      deploymentNeeded: boolean;
      deployTx?: string;
    } = {
      success: true,
      kmsAddress: kmsAddress || '0x0000000000000000000000000000000000000000',
      deploymentNeeded: false
    };

    // Deploy new KMS adapter if needed
    if (!kmsAddress || kmsAddress === '0x0000000000000000000000000000000000000000') {
      kmsAddress = await deployKmsAdapter(
        KEYRING_GATEWAY_CONTRACT_ADDRESS, 
        DELEGATE_CONTRACT_ADDRESS
      );

      logger.info(`Successfully deployed KMS Adapter: ${kmsAddress}`);

      const setKmsHash = await walletClient.writeContract({
        address: DELEGATE_CONTRACT_ADDRESS,
        abi: DeleGateABI.abi,
        functionName: 'setKmsAdapter',
        args: [kmsAddress, userAddress],
      });

      const setKmsReceipt = await publicClient.waitForTransactionReceipt({ hash: setKmsHash });
      
      if (setKmsReceipt.status !== 'success') {
        throw new KmsDeployError(setKmsHash, setKmsReceipt.status);
      }

      logger.info(`Successfully set KMS Adapter: ${setKmsReceipt.transactionHash} for voter ${userAddress}`);
      
      // Update result with deployment information
      result.kmsAddress = kmsAddress;
      result.deploymentNeeded = true;
      result.deployTx = setKmsHash;
    }

    return res.status(200).json(result);
  } catch (error: unknown) {
    if (error instanceof KmsDeployError) {
      logger.error(`KMS deployment failed: ${error.message}, Hash: ${error.transactionHash}, Status: ${error.status}`);
      return res.status(500).json({
        success: false,
        error: error.message,
        transactionHash: error.transactionHash,
        status: error.status
      });
    }
    
    // Handle other errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error getting/deploying KMS adapter: ${errorMessage}`);
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Confirm Agent
app.post('/finalize-agent', async (req, res) => {
  try {
    // Extract parameters from request body
    const { userAddress, spaceId, kmsAddress, source = 'snapshot' } = req.body as { 
      userAddress?: Address, 
      spaceId?: string,
      kmsAddress?: Address,
      source?: string
    };
    
    // Validate input
    if (!userAddress) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameter: userAddress' 
      });
    }

    if (!spaceId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameter: spaceId' 
      });
    }

    // For Tally DAOs, kmsAddress may be zero address (no KMS needed)
    // For Snapshot DAOs, kmsAddress is required
    if (!kmsAddress && source !== 'tally') {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameter: kmsAddress' 
      });
    }

    // Check for existing subscriptions (only for Snapshot DAOs)
    // Tally DAOs don't use the DeleGate contract for subscriptions
    if (source !== 'tally') {
      const subscriptions = await publicClient.readContract({
        address: DELEGATE_CONTRACT_ADDRESS,
        abi: DeleGateABI.abi,
        functionName: 'getUserSubscriptions',
        args: [userAddress]
      }) as Array<{space: string, module: string}>;

      const matchingSubscription = subscriptions.length > 0 ? subscriptions.find(sub => sub.space === spaceId) : null;   

      if (matchingSubscription) {
        logger.info(`Found matching subscription for Space ${spaceId}: module=${matchingSubscription.module}`);
        const agent = await getAgentByAddress(matchingSubscription.module);
        if (agent) {
          return res.status(200).json({
            id: agent._id,
            address: agent.address,
            name: agent.name,
            kmsAdapterAddress: agent.kmsAdapterAddress,
            userAddress: agent.userAddress,
            existingAgent: true
          });
        }
        logger.warn(`Agent already exists for user ${userAddress} in space ${spaceId}, but not in DB`);
      }
    }

    //FIXME filter by spaceId
    const existingAgent = await getAgentsByUserAddress(userAddress);
    if (existingAgent && existingAgent.length > 0) {
      return res.status(200).json({
        id: existingAgent[0]._id,
        address: existingAgent[0].address,
        name: existingAgent[0].name,
        kmsAdapterAddress: existingAgent[0].kmsAdapterAddress,
        userAddress: existingAgent[0].userAddress,
        existingAgent: true
      });
    }

    // For Tally DAOs, generate agent from user address directly
    let agentAccount;
    let agentPrivateKey;
    if (source === 'tally' && (!kmsAddress || kmsAddress === '0x0000000000000000000000000000000000000000')) {
      logger.info(`[Tally] Generating agent from user address: ${userAddress}`);
      // Generate agent from user address, not KMS
      agentAccount = getAgentAccountFromAddress(userAddress);
      const hdKey = agentAccount.getHdKey();
      const privateKeyBytes = hdKey.privateKey;
      if (!privateKeyBytes) {
        throw new Error('Failed to retrieve private key bytes');
      }
      agentPrivateKey = `0x${Buffer.from(privateKeyBytes).toString('hex')}`;
    } else {
      // For Snapshot DAOs, use KMS address
      logger.info(`[Snapshot] Generating agent from KMS address: ${kmsAddress}`);
      if (!kmsAddress) {
        throw new Error('KMS address is required for Snapshot DAOs');
      }
      agentAccount = getAgentAccountFromAddress(kmsAddress);
      const hdKey = agentAccount.getHdKey();
      const privateKeyBytes = hdKey.privateKey;
      if (!privateKeyBytes) {
        throw new Error('Failed to retrieve private key bytes');
      }
      agentPrivateKey = `0x${Buffer.from(privateKeyBytes).toString('hex')}`;
    }

    // Create the agent in the database
    const agent = await addAgent(
      agentAccount.address,
      agentPrivateKey,
      agentAccount.address, // name = address for now
      kmsAddress || '0x0000000000000000000000000000000000000000', // For Tally, kmsAddress is zero
      userAddress
    );

    if (!agent) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to create agent' 
      });
    }

    // Trigger proposal fetching and scheduling for the new agent
    console.log('Fetching and scheduling proposals for the new agent');
    runFetchAndSchedule().catch(err => {
      logger.error(`Failed to run scheduler after adding agent: ${err.message}`);
    });

    return res.status(201).json({
      id: agent._id,
      address: agent.address,
      name: agent.name,
      kmsAdapterAddress: agent.kmsAdapterAddress,
      userAddress: agent.userAddress,
      existingAgent: false
    });
  } catch (error: unknown) {
    // Handle errors
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error finalizing agent: ${errorMessage}`);
    return res.status(500).json({
      success: false,
      error: errorMessage
    });
  }
});

// Add an agent to a space
app.post('/spaces/:spaceId/agents', async (req, res) => {
  try {
    const spaceId = req.params.spaceId;
    const { agentId, existing, defaultVote } = req.body;
    
    if (!agentId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const agent = await getAgentById(agentId);
    if (!agent) {
      return res.status(404).json({ error: 'Agent not found' });
    }
    
    let inSpace = false;

    if (process.env.TEST_ENV === 'true') {
      inSpace = true;
      logger.info('Skipping delegation verify for test env');
    } else {
      try {
        // Call isSubscribed function on the delegate contract to check subscription status
        inSpace = await publicClient.readContract({
          address: DELEGATE_CONTRACT_ADDRESS,
          abi: DeleGateABI.abi,
          functionName: 'isSubscribed',
          args: [spaceId, agent.userAddress || agent.address, agent.address]
        }) as boolean;
        
        logger.info(`Agent ${agent.address} subscription status for Space ${spaceId}: ${inSpace ? 'Subscribed' : 'Not subscribed'}`);
      } catch (error) {
        logger.warn(`Failed to check if agent is subscribed: ${error instanceof Error ? error.message : String(error)}`);
        // If there's an error checking subscription, assume it's not subscribed
        inSpace = false;
      }
    }

    let hash;

    console.log('inSpace', inSpace)
    let subscribeTx;
    if (!inSpace) {
      // return res.status(400).json({ error: 'Agent is not existing or active' });
      try {
        // Call subscribe function on the delegate contract to ensure the agent is subscribed as a module
        subscribeTx = await walletClient.writeContract({
          address: DELEGATE_CONTRACT_ADDRESS,
          abi: DeleGateABI.abi,
          functionName: 'subscribe',
          args: [spaceId, agent.userAddress, agent.address],
        });
        
        logger.info(`Subscribed agent ${agent.address} to Space ${spaceId}, tx: ${subscribeTx}`);
        
        // Wait for transaction to be mined
        await publicClient.waitForTransactionReceipt({ hash: subscribeTx });
      } catch (error) {
        logger.error(`Failed to subscribe agent: ${error instanceof Error ? error.message : String(error)}`);
        // Return the agent info anyway, even if subscription failed
        return res.status(500).json({
          id: agentId,
          address: agent.address,
          subscriptionError: error instanceof Error ? error.message : String(error)
        });
      }
    }
    const success = await addAgentToSpace(agentId, spaceId, defaultVote);
    
    if (success) {
      // Trigger proposal fetching and scheduling for the new agent
      console.log('Fetching and scheduling proposals for the new agent');
      runFetchAndSchedule().catch(err => {
        logger.error(`Failed to run scheduler after adding agent: ${err.message}`);
      });

      return res.status(200).json({ message: 'Agent added to space successfully', subscribeTx: subscribeTx});
    }
    
    return res.status(400).json({ error: 'Failed to add agent to space' });
  } catch (error) {
    logger.error(`API error: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Remove an agent from a space
app.delete('/spaces/:spaceId/users/:userAddress', async (req, res) => {
  try {
    const { spaceId, userAddress } = req.params;
    const { source = 'snapshot' } = req.body; // Get source from body, default to snapshot

    let userSubscriptions;
    let matchingAgent = null;
    let agentAddress;
    let unsubscribeTx;

    try {
      // Only check DeleGate subscriptions for Snapshot DAOs
      // Tally DAOs don't use the DeleGate contract
      if (source !== 'tally') {
        // Call getUserSubscriptions function to get all user subscriptions
        const subscriptions = await publicClient.readContract({
          address: DELEGATE_CONTRACT_ADDRESS,
          abi: DeleGateABI.abi,
          functionName: 'getUserSubscriptions',
          args: [userAddress]
        }) as Array<{space: string, module: string}>;
        
        // Check if any subscription matches the current space
        const matchingSubscription = subscriptions.find(sub => sub.space === spaceId);
        
        if (matchingSubscription) {
          logger.info(`Found matching subscription for Space ${spaceId}: module=${matchingSubscription.module}`);
          
          
          // Call unsubscribe function on the contract
          const unsubscribeTx = await walletClient.writeContract({
            address: DELEGATE_CONTRACT_ADDRESS,
            abi: DeleGateABI.abi,
            functionName: 'unsubscribe',
            args: [spaceId, userAddress, matchingSubscription.module],
          });
          
          logger.info(`Unsubscribed agent from Space ${spaceId}, tx: ${unsubscribeTx}`);
          
          // Wait for transaction to be mined
          await publicClient.waitForTransactionReceipt({ hash: unsubscribeTx });
          const agent = await getAgentByAddress(matchingSubscription.module)
          const success = agent ? await removeAgentFromSpace((agent._id as any).toString(), spaceId) : null;
        } else {
          logger.info(`No subscription found for user ${userAddress} in space ${spaceId}`);
        }
      } else {
        logger.info(`[Tally] Skipping DeleGate unsubscribe for Tally DAO`);
      }
    } catch (error) {
      logger.warn(`Failed to check or unsubscribe agent: ${error instanceof Error ? error.message : String(error)}`);
    }
    
    res.status(200).json({ message: 'Agent removed from space successfully', unsubscribeTx: unsubscribeTx });
  } catch (error) {
    logger.error(`API error: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all agents
app.get('/agents', async (req, res) => {
  try {
    const agents = await getAllAgents();
    res.status(200).json(agents.map(agent => ({
      id: agent._id,
      address: agent.address,
      userAddress: agent.userAddress,
      active: agent.active,
    })));
  } catch (error) {
    logger.error(`API error: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all spaces with active agents
app.get('/spaces', async (req, res) => {
  try {
    const spaces = await getAllActiveSpaces();
    res.status(200).json(spaces);
  } catch (error) {
    logger.error(`API error: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get agents for a specific space
app.get('/spaces/:spaceId/agents', async (req, res) => {
  try {
    const spaceId = req.params.spaceId;
    const agentsForSpace = await getAgentsForSpace(spaceId);
    
    res.status(200).json(agentsForSpace.map(item => ({
      id: item.agent._id,
      address: item.agent.address,
      name: item.agent.name,
      defaultVote: item.defaultVote
    })));
  } catch (error) {
    logger.error(`API error: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get all scheduled votes with filtering options
app.get('/api/votes', async (req, res) => {
  try {
    const {
      status,
      spaceId,
      agentId,
      limit = 100,
      skip = 0,
      sortBy = 'scheduledTime',
      sortDirection = 'asc'
    } = req.query;
    
    const votes = await getScheduledVotes({
      status: status as any,
      spaceId: spaceId as string,
      agentId: agentId as string,
      limit: parseInt(limit as string || '100', 10),
      skip: parseInt(skip as string || '0', 10),
      sortBy: sortBy as string,
      sortDirection: (sortDirection as 'asc' | 'desc') || 'asc'
    });
    
    res.json(votes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve scheduled votes' });
  }
});

app.get('/api/votes-simple', async (req, res) => {
  try {
    const {
      status,
      spaceId,
      agentId,
      limit = 100,
      skip = 0,
      sortBy = 'scheduledTime',
      sortDirection = 'asc'
    } = req.query;
    
    const votes = await getScheduledVotes({
      status: status as any,
      spaceId: spaceId as string,
      agentId: agentId as string,
      limit: parseInt(limit as string || '100', 10),
      skip: parseInt(skip as string || '0', 10),
      sortBy: sortBy as string,
      sortDirection: (sortDirection as 'asc' | 'desc') || 'asc'
    });
    
    // Return simplified vote objects with just the requested fields
    const simplifiedVotes = votes.map(vote => {
      // Get the agent info properly typed
      const agent = vote.agentId as unknown as IAgent;
      
      return {
        voteId: vote._id,
        proposalId: vote.proposalId,
        agentAddress: agent.address,
        userAddress: agent.userAddress || null, // Add the userAddress
        scheduledTime: vote.scheduledTime
      };
    });
    
    res.json(simplifiedVotes);
  } catch (error) {
    logger.error(`API error retrieving simplified votes: ${error instanceof Error ? error.message : String(error)}`);
    res.status(500).json({ error: 'Failed to retrieve simplified votes' });
  }
});

// Get vote by ID
app.get('/api/votes/:id', async (req, res) => {
  try {
    const vote = await getScheduledVoteById(req.params.id);
    
    if (!vote) {
      return res.status(404).json({ error: 'Vote not found' });
    }
    
    res.json(vote);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve scheduled vote' });
  }
});

// Execute a specific vote now (override schedule)
app.post('/api/votes/:id/execute', async (req, res) => {
  try {
    const voteId = req.params.id;
    
    // Get the scheduled vote
    const vote = await getScheduledVoteById(voteId);
    
    if (!vote) {
      return res.status(404).json({ error: 'Vote not found' });
    }
    
    // Check if vote is already completed or failed
    if (vote.status !== 'scheduled') {
      return res.status(400).json({ 
        error: 'Vote cannot be executed', 
        status: vote.status,
        message: `This vote has already been ${vote.status}`
      });
    }
    
    // Get agent information
    const agent = vote.agentId as unknown as IAgent;
    
    logger.info(`Manually executing vote for proposal: ${vote.proposalTitle} (${vote.proposalId}) for agent ${agent.name}`);
    
    // Create a simplified proposal object with the necessary information
    const proposal = {
      id: vote.proposalId,
      title: vote.proposalTitle,
      space: {
        id: vote.spaceId,
        name: vote.spaceId
      }
    } as SnapshotProposal;

    if (!agent.userAddress) {
      throw new Error(`Agent not found for vote ${vote._id}`);
    }
    
    // Execute the vote
    await castVote(proposal, agent.address, agent.userAddress);
    await markVoteCompleted((vote._id as any).toString());
    
    logger.info(`Manually triggered vote for proposal ${vote.proposalId} successfully executed`);
    
    res.status(200).json({ 
      success: true, 
      message: `Vote for proposal ${vote.proposalId} executed successfully` 
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to execute vote: ${errorMessage}`);
    res.status(500).json({ error: 'Failed to execute vote', message: errorMessage });
  }
});

// Get vote statistics
app.get('/api/votes/statistics', async (req, res) => {
  try {
    const stats = await getVoteStatistics();
    res.json(stats);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve vote statistics' });
  }
});

// Get upcoming votes
app.get('/api/votes/upcoming', async (req, res) => {
  try {
    const hours = parseInt(req.query.hours as string || '24', 10);
    const votes = await getUpcomingVotes(hours);
    res.json(votes);
  } catch (error) {
    res.status(500).json({ error: 'Failed to retrieve upcoming votes' });
  }
});

// OpenAI processing endpoint
app.post('/api/ai-request', async (req, res) => {
  try {
    const { directive, proposal } = req.body;
    
    // Validate required parameters
    if (!directive || !proposal) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameters',
        details: 'Both directive and proposal are required'
      });
    }
    
    logger.info(`Processing AI analysis request for proposal`);
    
    // Call the OpenAI function
    const response = await fetchOpenAIResponse(directive, proposal);
    
    return res.status(200).json({
      success: true,
      response
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Error processing AI analysis: ${errorMessage}`);
    return res.status(500).json({
      success: false,
      error: 'Failed to process request',
      details: errorMessage
    });
  }
});

// ============================================
// VOTING POWER ENDPOINTS
// ============================================

import { 
  getVotingPowerForAgent, 
  getVotingPowerForProposal, 
  getVotingPowerForSpace,
  updateVotingPowerForProposal,
  checkAndUpdateAllVotingPower,
  fetchVotingPower
} from '../votingPowerService';

/**
 * GET /api/voting-power/:agentAddress - Get all active voting power for an agent
 */
app.get('/api/voting-power/:agentAddress', async (req, res) => {
  try {
    const { agentAddress } = req.params;
    
    if (!agentAddress) {
      return res.status(400).json({ 
        success: false, 
        error: 'Agent address is required' 
      });
    }

    const votingPowers = await getVotingPowerForAgent(agentAddress);
    
    return res.status(200).json({
      success: true,
      data: votingPowers.map(vp => ({
        proposalId: vp.proposalId,
        spaceId: vp.spaceId,
        vp: vp.vp,
        vpByStrategy: vp.vpByStrategy,
        vpState: vp.vpState,
        proposalStart: vp.proposalStart,
        proposalEnd: vp.proposalEnd,
        canVote: vp.canVote,
        scheduledVoteTime: vp.scheduledVoteTime,
        lastChecked: vp.lastChecked
      }))
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get voting power: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to get voting power',
      message: errorMessage 
    });
  }
});

/**
 * GET /api/voting-power/:agentAddress/:proposalId - Get voting power for a specific proposal
 */
app.get('/api/voting-power/:agentAddress/:proposalId', async (req, res) => {
  try {
    const { agentAddress, proposalId } = req.params;
    
    if (!agentAddress || !proposalId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Agent address and proposal ID are required' 
      });
    }

    const votingPower = await getVotingPowerForProposal(agentAddress, proposalId);
    
    if (!votingPower) {
      return res.status(404).json({ 
        success: false, 
        error: 'Voting power not found for this proposal' 
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        proposalId: votingPower.proposalId,
        spaceId: votingPower.spaceId,
        vp: votingPower.vp,
        vpByStrategy: votingPower.vpByStrategy,
        vpState: votingPower.vpState,
        proposalStart: votingPower.proposalStart,
        proposalEnd: votingPower.proposalEnd,
        canVote: votingPower.canVote,
        scheduledVoteTime: votingPower.scheduledVoteTime,
        lastChecked: votingPower.lastChecked
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get voting power: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to get voting power',
      message: errorMessage 
    });
  }
});

/**
 * GET /api/voting-power/space/:spaceId - Get all voting power for a space/DAO
 */
app.get('/api/voting-power/space/:spaceId', async (req, res) => {
  try {
    const { spaceId } = req.params;
    
    if (!spaceId) {
      return res.status(400).json({ 
        success: false, 
        error: 'Space ID is required' 
      });
    }

    const votingPowers = await getVotingPowerForSpace(spaceId);
    
    return res.status(200).json({
      success: true,
      data: votingPowers.map(vp => ({
        agentAddress: vp.agentAddress,
        proposalId: vp.proposalId,
        spaceId: vp.spaceId,
        vp: vp.vp,
        vpByStrategy: vp.vpByStrategy,
        vpState: vp.vpState,
        proposalStart: vp.proposalStart,
        proposalEnd: vp.proposalEnd,
        canVote: vp.canVote,
        scheduledVoteTime: vp.scheduledVoteTime,
        lastChecked: vp.lastChecked
      }))
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get voting power for space: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to get voting power for space',
      message: errorMessage 
    });
  }
});

/**
 * POST /api/voting-power/check - Manually trigger voting power check for an agent/proposal
 */
app.post('/api/voting-power/check', async (req, res) => {
  try {
    const { agentAddress, proposalId, spaceId, proposalStart, proposalEnd } = req.body;
    
    if (!agentAddress || !proposalId || !spaceId || proposalStart === undefined || proposalEnd === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required fields: agentAddress, proposalId, spaceId, proposalStart, proposalEnd' 
      });
    }

    const votingPower = await updateVotingPowerForProposal(
      agentAddress,
      proposalId,
      spaceId,
      proposalStart,
      proposalEnd
    );
    
    if (!votingPower) {
      return res.status(500).json({ 
        success: false, 
        error: 'Failed to update voting power' 
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        proposalId: votingPower.proposalId,
        spaceId: votingPower.spaceId,
        vp: votingPower.vp,
        vpByStrategy: votingPower.vpByStrategy,
        vpState: votingPower.vpState,
        proposalStart: votingPower.proposalStart,
        proposalEnd: votingPower.proposalEnd,
        canVote: votingPower.canVote,
        scheduledVoteTime: votingPower.scheduledVoteTime,
        lastChecked: votingPower.lastChecked
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to check voting power: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to check voting power',
      message: errorMessage 
    });
  }
});

/**
 * POST /api/voting-power/refresh-all - Manually trigger voting power refresh for all active agents
 */
app.post('/api/voting-power/refresh-all', async (req, res) => {
  try {
    // Start the refresh asynchronously
    checkAndUpdateAllVotingPower().catch(err => {
      logger.error(`Background voting power refresh failed: ${err instanceof Error ? err.message : String(err)}`);
    });
    
    return res.status(200).json({
      success: true,
      message: 'Voting power refresh started'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to start voting power refresh: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to start voting power refresh',
      message: errorMessage 
    });
  }
});

/**
 * GET /api/voting-power/live/:voter/:space/:proposal - Fetch live voting power from Snapshot
 * This bypasses the cache and fetches directly from Snapshot API
 */
app.get('/api/voting-power/live/:voter/:space/:proposal', async (req, res) => {
  try {
    const { voter, space, proposal } = req.params;
    
    if (!voter || !space || !proposal) {
      return res.status(400).json({ 
        success: false, 
        error: 'Voter, space and proposal are required' 
      });
    }

    const vpResult = await fetchVotingPower(voter, space, proposal);
    
    if (!vpResult) {
      return res.status(404).json({ 
        success: false, 
        error: 'Could not fetch voting power' 
      });
    }

    return res.status(200).json({
      success: true,
      data: {
        vp: vpResult.vp,
        vpByStrategy: vpResult.vp_by_strategy,
        vpState: vpResult.vp_state,
        canVote: vpResult.vp > 0 && vpResult.vp_state === 'valid'
      }
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to fetch live voting power: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to fetch live voting power',
      message: errorMessage 
    });
  }
});

// Start the server
export function startApiServer(port: number = 3000): void {
  app.listen(port, () => {
    logger.info(`API server listening on port ${port}`);
  });
}

// Manual snapshot vote submission
app.post('/api/snapshot-vote', async (req, res) => {
  try {
    const { kmsAdapterAddress, space, proposal, type = 'single-choice', choice } = req.body;
    
    if (!kmsAdapterAddress || !space || !proposal || choice === undefined) {
      return res.status(400).json({ 
        success: false, 
        error: 'Missing required parameters. Required: agentId, space, proposal, choice' 
      });
    }
    
    // Import the snapshotVote function
    const { snapshotVote } = await import('../snapshot_executor');
    
    // Format the vote data
    const voteData = {
      space,
      proposal,
      type,
      choice
    };
    
    logger.info(`Manually triggering snapshot vote: ${JSON.stringify(voteData)}`);
    
    // Call the snapshot vote function
    await snapshotVote(kmsAdapterAddress as Address, voteData);
    
    return res.status(200).json({
      success: true,
      message: 'Vote submission initiated',
      vote: voteData
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to submit snapshot vote: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to submit vote', 
      message: errorMessage 
    });
  }
});

// ============================================================================
// VOTE DETAILS API ENDPOINTS
// ============================================================================

/**
 * GET /api/vote-details/:userAddress - Get all vote details for a user
 */
app.get('/api/vote-details/:userAddress', async (req, res) => {
  try {
    const { userAddress } = req.params;
    
    if (!userAddress) {
      return res.status(400).json({ error: 'User address is required' });
    }
    
    const voteDetails = await getUserVoteDetails(userAddress);
    
    return res.status(200).json({
      success: true,
      data: voteDetails
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get vote details: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to get vote details',
      message: errorMessage 
    });
  }
});

/**
 * GET /api/vote-details/:userAddress/:proposalId - Get specific vote details
 */
app.get('/api/vote-details/:userAddress/:proposalId', async (req, res) => {
  try {
    const { userAddress, proposalId } = req.params;

    if (!userAddress || !proposalId) {
      return res.status(400).json({ error: 'User address and proposal ID are required' });
    }
    
    const voteDetails = await getVoteDetailsByUserAddress(userAddress, proposalId);
    
    if (!voteDetails) {
      return res.status(404).json({ error: 'Vote details not found' });
    }
    
    return res.status(200).json({
      success: true,
      data: voteDetails
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to get vote details: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to get vote details',
      message: errorMessage 
    });
  }
});

/**
 * POST /api/vote-details - Create or update vote details
 */
app.post('/api/vote-details', async (req, res) => {
  try {
    const {
      agentAddress,
      proposalId,
      spaceId,
      proposalTitle,
      proposalText,
      lastUpdated,
      aiResponse,
      aiVoteChoice,
      userEthos,
      userAddress
    } = req.body;
    
    if (!agentAddress || !proposalId || !spaceId || !proposalTitle || !proposalText || 
        lastUpdated === undefined || !aiResponse || !aiVoteChoice || !userEthos) {
      return res.status(400).json({ 
        error: 'Missing required fields: agentAddress, proposalId, spaceId, proposalTitle, proposalText, lastUpdated, aiResponse, aiVoteChoice, userEthos' 
      });
    }
    
    const voteDetails = await upsertVoteDetails(
      agentAddress,
      proposalId,
      spaceId,
      proposalTitle,
      proposalText,
      lastUpdated,
      aiResponse,
      aiVoteChoice,
      userEthos,
      userAddress
    );
    
    if (!voteDetails) {
      return res.status(500).json({ error: 'Failed to save vote details' });
    }
    
    return res.status(201).json({
      success: true,
      data: voteDetails
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to save vote details: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to save vote details',
      message: errorMessage 
    });
  }
});

/**
 * PUT /api/vote-details/:agentAddress/:proposalId/vote - Update agent vote choice
 */
app.put('/api/vote-details/:agentAddress/:proposalId/vote', async (req, res) => {
  try {
    const { agentAddress, proposalId } = req.params;
    const { agentVoteChoice } = req.body;
    
    if (!agentAddress || !proposalId) {
      return res.status(400).json({ error: 'Agent address and proposal ID are required' });
    }
    
    if (!agentVoteChoice || !['yes', 'no'].includes(agentVoteChoice)) {
      return res.status(400).json({ error: 'Valid agentVoteChoice (yes/no) is required' });
    }
    
    const success = await updateUserVote(agentAddress, proposalId, agentVoteChoice);
    
    if (!success) {
      return res.status(404).json({ error: 'Vote details not found or update failed' });
    }
    
    return res.status(200).json({
      success: true,
      message: 'User vote updated successfully'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to update user vote: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to update user vote',
      message: errorMessage 
    });
  }
});

/**
 * POST /api/vote-details/check-proposal - Check if proposal has changed
 */
app.post('/api/vote-details/check-proposal', async (req, res) => {
  try {
    const { userAddress, userEthos, proposalId, currentText, currentTimestamp } = req.body;
    
    if (!userAddress || !userEthos || !proposalId || !currentText || currentTimestamp === undefined) {
      return res.status(400).json({ 
        error: 'Missing required fields: userAddress, userEthos, proposalId, currentText, currentTimestamp' 
      });
    }
    
    const hasChanged = await hasProposalChanged(userAddress, userEthos, proposalId, currentText, currentTimestamp);
    
    return res.status(200).json({
      success: true,
      hasChanged,
      message: hasChanged ? 'Proposal has changed' : 'Proposal unchanged'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to check proposal: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to check proposal',
      message: errorMessage 
    });
  }
});

/**
 * POST /api/vote-details/:userAddress/:proposalId/check - Update last checked timestamp
 */
app.post('/api/vote-details/:userAddress/:proposalId/check', async (req, res) => {
  try {
    const { userAddress, proposalId } = req.params;
    
    if (!userAddress || !proposalId) {
      return res.status(400).json({ error: 'User address and proposal ID are required' });
    }
    
    const success = await updateProposalCheck(userAddress, proposalId);
    
    if (!success) {
      return res.status(404).json({ error: 'Vote details not found' });
    }
    
    return res.status(200).json({
      success: true,
      message: 'Proposal check timestamp updated'
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to update proposal check: ${errorMessage}`);
    return res.status(500).json({ 
      success: false, 
      error: 'Failed to update proposal check',
      message: errorMessage 
    });
  }
});