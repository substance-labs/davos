````markdown
# Davos - Decentralized Autonomous Voting System

Davos is a next-generation AI-powered voting delegate designed for DAOs and cooperatives. It utilizes a hexagonal architecture to ensure modularity and extensibility, with a core logic implemented as smart contracts. The system integrates multiple adapters, including an LLM adapter (e.g., OpenAI or Acurast-Llama) and a KMS adapter (e.g., Keyring), enabling efficient and secure execution.

## Key Features

- **Automated DAO Voting:** Users set predefined principles (ethos) and preferences, and Davos ensures their votes align accordingly.
- **AI-Powered Proposal Analysis:** Leverages LLMs to analyze DAO proposals and make informed voting decisions.
- **Secure Signing & Submission:** Uses a KMS adapter to securely sign and submit votes across multiple chains (e.g., Snapshot, Tally).
- **User Ethos System:** Users define their governance values on-chain, which guides all voting decisions.
- **Override Mechanism:** Users have the ability to manually override the automated vote before the deadline.
- **Event-Driven Updates:** Automatically updates vote recommendations when users change their ethos on-chain.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     DAVOS SYSTEM                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌──────────────┐      ┌──────────────┐                   │
│  │   Frontend   │◄────►│  Voter API   │                   │
│  │     (UI)     │      │   Service    │                   │
│  └──────────────┘      └──────┬───────┘                   │
│                               │                            │
│                               ▼                            │
│              ┌────────────────────────────┐               │
│              │   MongoDB Database         │               │
│              │   - Agents                 │               │
│              │   - Vote Details           │               │
│              │   - Scheduled Votes        │               │
│              └────────────────────────────┘               │
│                               │                            │
│         ┌────────────────────┴────────────────────┐       │
│         ▼                     ▼                    ▼       │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐│
│  │  Scheduler   │    │ Vote Poller  │    │Ethos Watcher ││
│  │ (Proposals)  │    │  (Executor)  │    │  (Events)    ││
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘│
│         │                   │                    │        │
│         ▼                   ▼                    ▼        │
│  ┌─────────────────────────────────────────────────────┐ │
│  │           Smart Contracts (On-Chain)                │ │
│  │  ┌──────────────┐  ┌──────────────┐                │ │
│  │  │   DeleGate   │  │  LLMAdapter  │                │ │
│  │  │  (Core Logic)│  │  (AI Bridge) │                │ │
│  │  └──────────────┘  └──────────────┘                │ │
│  │  ┌──────────────┐  ┌──────────────┐                │ │
│  │  │  KMSAdapter  │  │   Keyring    │                │ │
│  │  │  (Signing)   │  │   Gateway    │                │ │
│  │  └──────────────┘  └──────────────┘                │ │
│  └─────────────────────────────────────────────────────┘ │
│                               │                            │
│                               ▼                            │
│                   ┌──────────────────────┐                │
│                   │  External Services   │                │
│                   │  - Snapshot.org      │                │
│                   │  - Tally             │                │
│                   │  - OpenAI            │                │
│                   └──────────────────────┘                │
└─────────────────────────────────────────────────────────────┘
```

## System Components

### Core Services

#### 1. **Voter Service** (`voter/`)
The main backend service that orchestrates all voting operations:
- **API Server**: RESTful API for agent management and vote queries
- **Scheduler**: Fetches proposals from DAOs and generates AI recommendations
- **Vote Poller**: Executes scheduled votes at the right time
- **Ethos Watcher**: Monitors on-chain ethos updates and refreshes vote details

**Key Features:**
- Automatic proposal fetching from Snapshot and Tally
- AI-powered vote generation using user ethos
- MongoDB storage for vote details and agent configuration
- Event-driven architecture for real-time updates

#### 2. **Smart Contracts** (`contracts/`)
Solidity contracts deployed on EVM-compatible chains:
- **DeleGate**: Core contract managing user ethos and subscriptions
- **LLMAdapter**: Bridge for AI-powered decision making - not used: the voter votes directly in the mvp
- **KMSAdapter**: Ready for Secure key management for vote signing

#### 4. **Proposal API** (`proposal-api/`)
Python service for proposal analysis:
- Analyzes proposal content using NLP
- Provides structured data for AI decision-making
- Flask-based API for easy integration

### Supporting Components
- **`test-env/`**: Emulation environment for testing without live DAOs


## Monorepo Structure

```
davos-mvp/
├── contracts/           # Smart contracts (Solidity + Foundry)
│   ├── src/            # Contract source files
│   ├── script/         # Deployment scripts
│   └── test/           # Contract tests
├── voter/              # Main voting service (TypeScript + Node.js)
│   ├── src/
│   │   ├── api/        # REST API endpoints
│   │   ├── db/         # MongoDB models and services
│   │   ├── lib/        # Utilities and blockchain clients
│   │   ├── scheduler.ts    # Proposal fetching
│   │   ├── voter.ts        # Vote execution
│   │   └── ethosWatcher.ts # Event monitoring
│   └── package.json
├── proposal-api/       # Proposal analysis API (Python + Flask)
├── test-env/           # Testing environment
└── docker-compose.yml  # Full stack deployment
```

## Getting Started

### Prerequisites
- Node.js v18+ (for voter & relayer)
- Docker & Docker Compose
- MongoDB (or use Docker)
- Foundry (for smart contracts)
- OpenAI API key or Acurast setup

### Quick Start with Docker

```sh
# Clone the repository
git clone https://github.com/substance-labs/davos-mvp.git
cd davos-mvp

# Configure environment variables
cp voter/.env.example voter/.env
# Edit voter/.env with your configuration

# Start all services
docker compose up -d

# View logs
docker compose logs -f voter
```

### Services will be available at:
- **Voter API**: http://localhost:3000
- **Proposal API**: http://localhost:6000
- **MongoDB**: mongodb://localhost:27017

### Development Setup

#### Voter Service
```sh
cd voter
npm install

# Configure environment
cp .env.example .env
# Edit .env with your values

# Start in development mode
npm run dev
```

#### Smart Contracts
```sh
cd contracts
forge install
forge build
forge test

# Deploy to network
# See contracts/script/deployAll.s.sol
```

#### Relayer
```sh
cd relayer
npm install
npm run dev
```

## Configuration

### Environment Variables

#### Voter Service (`voter/.env`)
```env
# Database
MONGODB_URI=mongodb://localhost:27017/davos-voter

# API
API_PORT=3000

# Blockchain
RPC_URL=https://polygon-rpc.com
CHAIN_ID=137
DELEGATE_CONTRACT_ADDRESS=0x...

# AI
OPENAI_API_KEY=sk-...
AI_DIRECTIVE="Suggest a vote..."

# Scheduling
FETCH_SCHEDULE="*/15 * * * *"  # Every 15 minutes
```

### Adding a DAO

Edit `voter/src/config.ts`:
```typescript
export const DAOS = [
  {
    id: 'your-dao.eth',
    name: 'Your DAO',
    source: 'snapshot',  // or 'tally'
    governorAddress: '0x...',  // for Tally
  },
];
```

## API Endpoints

### Agent Management
- `POST /api/agent/init` - Initialize new agent
- `GET /api/agents` - List all agents
- `GET /api/agents/:address` - Get agent details
- `POST /api/agent/subscribe/:spaceId` - Subscribe to DAO

### Vote Management
- `GET /api/vote-details/:userAddress/:proposalId` - Get vote recommendation
- `GET /api/user-votes/:userAddress` - Get all user votes
- `POST /api/vote-details/update` - Override AI recommendation
- `POST /api/cast-vote` - Manually cast vote

### Health & Status
- `GET /health` - Service health check
- `GET /api/vote-stats` - Vote statistics

## How It Works

### 1. **User Onboarding**
1. User connects wallet and defines their governance ethos
2. System deploys KMS adapter and creates agent
3. Agent subscribes to selected DAOs

### 2. **Proposal Processing**
1. Scheduler fetches new proposals every 15 minutes
2. For each proposal, system:
   - Fetches user's on-chain ethos
   - Sends proposal + ethos to AI
   - Stores recommendation in database

### 3. **Vote Execution**
1. Vote poller checks for proposals near deadline
2. Retrieves AI recommendation or user override
3. Signs and submits vote on-chain

### 4. **Ethos Updates**
1. User updates ethos on DeleGate contract
2. Ethos watcher detects `EthosDefined` event
3. System regenerates recommendations for pending votes

## Why Davos?

Participating in DAO governance is often time-consuming, yet many users vote in predictable ways based on proposal content. Davos automates this process, ensuring:

- **Always-on participation:** Users never miss an important vote.
- **Trustworthy execution:** The agent votes in alignment with user-defined values.
- **Seamless integration:** Works across multiple DAOs and chains.
- **Transparency:** All votes and reasoning are stored and auditable.

By leveraging **LLMs for analysis, KMS for security, and event-driven architecture**, Davos is a pioneering step towards **on-chain AI-driven governance**.

## Monitoring & Logs

The voter service provides detailed logging for visibility:

```
========================================
    DAVOS VOTER SERVICE
========================================

Autonomous DAO Voting System
Version: 1.0.0
Environment: production

========================================

Step 1/5: Connecting to database...
✓ Database connected successfully

Step 2/5: Starting proposal scheduler...
✓ Scheduler started (cron: */15 * * * *)

...
```

## Testing

```sh
# Voter service tests
cd voter
npm test

# Contract tests
cd contracts
forge test -vvv

# Integration tests
docker compose -f docker-compose.test.yml up
```

## Contributing

We welcome contributions! Please:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

See [CONTRIBUTING.md](CONTRIBUTING.md) for more details.

## License

This project is licensed under the MIT License - see [LICENSE](LICENSE) for details.

---

**Built with ❤️ by Substance Labs**
````
