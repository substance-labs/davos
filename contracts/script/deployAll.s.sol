// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {KeyringGateway} from "../src/KeyringGateway.sol";
import {KMSAdapter} from "../src/adapters/KMSAdapter.sol";
import {KeyringDeleGateModule} from "../src/KeyringDeleGateModule.sol";
import {DeleGate} from "../src/DeleGate.sol";
import {LLMAdapter} from "../src/adapters/LLMAdapter.sol";

/**
 * @title DeployAll
 * @notice Comprehensive deployment script for the Davos MVP contract suite
 * @dev Deploys and initializes all core contracts in the correct order
 * 
 * Required Environment Variables:
 * - PRIVATE_KEY: Deployer's private key
 * - OWNER: Address that will own the contracts
 * - SIGNER: Expected signer address for KeyringDeleGateModule
 * - CHAIN_ID: Target chain ID for deployment
 */
contract DeployAll is Script {
    // ============================================================================
    // State Variables
    // ============================================================================
    
    struct DeploymentConfig {
        uint256 deployerPrivateKey;
        address owner;
        address expectedSigner;
        uint256 chainId;
    }
    
    struct DeployedContracts {
        address keyringGateway;
        address delegateContract;
        address llmAdapter;
        address kmsAdapter;
        address keyringDeleGateModule;
    }
    
    // ============================================================================
    // Main Deployment Function
    // ============================================================================
    
    function run() public {
        DeploymentConfig memory config = _loadConfiguration();
        _logDeploymentStart(config);
        
        vm.startBroadcast(config.deployerPrivateKey);
        
        DeployedContracts memory contracts = _deployContracts(config);
        
        vm.stopBroadcast();
        
        _logDeploymentSummary(contracts);
    }
    
    // ============================================================================
    // Internal Helper Functions
    // ============================================================================
    
    /**
     * @notice Load deployment configuration from environment variables
     * @return config Struct containing all required configuration parameters
     */
    function _loadConfiguration() internal view returns (DeploymentConfig memory config) {
        console.log("\n=== Loading Deployment Configuration ===");
        
        config.deployerPrivateKey = vm.envUint("PRIVATE_KEY");
        config.owner = vm.envAddress("OWNER");
        config.expectedSigner = vm.envAddress("SIGNER");
        config.chainId = vm.envUint("CHAIN_ID");
        
        console.log("Owner Address:", config.owner);
        console.log("Expected Signer:", config.expectedSigner);
        console.log("Chain ID:", config.chainId);
    }
    
    /**
     * @notice Deploy all contracts in the correct dependency order
     * @param config Deployment configuration
     * @return contracts Struct containing all deployed contract addresses
     */
    function _deployContracts(DeploymentConfig memory config) 
        internal 
        returns (DeployedContracts memory contracts) 
    {
        // Step 1: Deploy and initialize KeyringGateway
        contracts.keyringGateway = _deployKeyringGateway(config.owner);
        
        // Step 2: Deploy and initialize DeleGate contract
        contracts.delegateContract = _deployDeleGate(config.owner);
        
        // Step 3: Deploy LLMAdapter and configure it with DeleGate
        contracts.llmAdapter = _deployLLMAdapter(contracts.delegateContract);
        
        // Note: KMSAdapter and KeyringDeleGateModule deployment is currently disabled
        // Uncomment the following lines when ready to deploy:
        
        // contracts.kmsAdapter = _deployKMSAdapter(
        //     contracts.keyringGateway,
        //     contracts.delegateContract
        // );
        
        // contracts.keyringDeleGateModule = _deployKeyringDeleGateModule(
        //     config.owner,
        //     contracts.keyringGateway,
        //     config.expectedSigner,
        //     contracts.kmsAdapter,
        //     config.chainId
        // );
    }
    
    /**
     * @notice Deploy and initialize KeyringGateway contract
     * @param owner Address that will own the KeyringGateway
     * @return gatewayAddress Address of the deployed KeyringGateway
     */
    function _deployKeyringGateway(address owner) internal returns (address gatewayAddress) {
        console.log("\n=== Deploying KeyringGateway ===");
        
        KeyringGateway gateway = new KeyringGateway();
        gateway.initialize(owner);
        
        gatewayAddress = address(gateway);
        console.log("KeyringGateway deployed at:", gatewayAddress);
        console.log("KeyringGateway initialized with owner:", owner);
    }
    
    /**
     * @notice Deploy and initialize DeleGate contract
     * @param owner Address that will own the DeleGate contract
     * @return delegateAddress Address of the deployed DeleGate contract
     */
    function _deployDeleGate(address owner) internal returns (address delegateAddress) {
        console.log("\n=== Deploying DeleGate Contract ===");
        
        DeleGate delegate = new DeleGate();
        delegate.initialize(owner);
        
        delegateAddress = address(delegate);
        console.log("DeleGate deployed at:", delegateAddress);
        console.log("DeleGate initialized with owner:", owner);
    }
    
    /**
     * @notice Deploy LLMAdapter and configure it with DeleGate contract
     * @param delegateAddress Address of the DeleGate contract
     * @return adapterAddress Address of the deployed LLMAdapter
     */
    function _deployLLMAdapter(address delegateAddress) internal returns (address adapterAddress) {
        console.log("\n=== Deploying LLMAdapter ===");
        
        LLMAdapter adapter = new LLMAdapter(delegateAddress);
        adapterAddress = address(adapter);
        
        console.log("LLMAdapter deployed at:", adapterAddress);
        
        // Configure DeleGate to use this LLMAdapter
        DeleGate(delegateAddress).setLlmAdapter(adapterAddress);
        console.log("LLMAdapter configured in DeleGate contract");
    }
    
    /**
     * @notice Deploy KMSAdapter (currently disabled)
     * @param gatewayAddress Address of the KeyringGateway
     * @param delegateAddress Address of the DeleGate contract
     * @return adapterAddress Address of the deployed KMSAdapter
     */
    function _deployKMSAdapter(address gatewayAddress, address delegateAddress) 
        internal 
        returns (address adapterAddress) 
    {
        console.log("\n=== Deploying KMSAdapter ===");
        
        KMSAdapter adapter = new KMSAdapter(gatewayAddress, delegateAddress);
        adapterAddress = address(adapter);
        
        console.log("KMSAdapter deployed at:", adapterAddress);
    }
    
    /**
     * @notice Deploy KeyringDeleGateModule (currently disabled)
     * @param owner Address that will own the module
     * @param gatewayAddress Address of the KeyringGateway
     * @param expectedSigner Expected signer address
     * @param kmsAdapterAddress Address of the KMSAdapter
     * @param chainId Expected source chain ID
     * @return moduleAddress Address of the deployed KeyringDeleGateModule
     */
    function _deployKeyringDeleGateModule(
        address owner,
        address gatewayAddress,
        address expectedSigner,
        address kmsAdapterAddress,
        uint256 chainId
    ) internal returns (address moduleAddress) {
        console.log("\n=== Deploying KeyringDeleGateModule ===");
        
        KeyringDeleGateModule module = new KeyringDeleGateModule(
            owner,
            gatewayAddress,
            expectedSigner,
            kmsAdapterAddress,
            chainId
        );
        
        moduleAddress = address(module);
        console.log("KeyringDeleGateModule deployed at:", moduleAddress);
    }
    
    /**
     * @notice Log deployment start information
     */
    function _logDeploymentStart(DeploymentConfig memory /* config */) internal pure {
        console.log("\n");
        console.log("========================================");
        console.log("    DAVOS MVP DEPLOYMENT SCRIPT");
        console.log("========================================");
        console.log("");
    }
    
    /**
     * @notice Log final deployment summary with all contract addresses
     * @param contracts Struct containing all deployed contract addresses
     */
    function _logDeploymentSummary(DeployedContracts memory contracts) internal pure {
        console.log("\n");
        console.log("========================================");
        console.log("    DEPLOYMENT SUMMARY");
        console.log("========================================");
        console.log("");
        console.log("Core Contracts:");
        console.log("  KeyringGateway:", contracts.keyringGateway);
        console.log("  DeleGate:", contracts.delegateContract);
        console.log("  LLMAdapter:", contracts.llmAdapter);
        console.log("");
        
        if (contracts.kmsAdapter != address(0)) {
            console.log("Additional Contracts:");
            console.log("  KMSAdapter:", contracts.kmsAdapter);
        }
        
        if (contracts.keyringDeleGateModule != address(0)) {
            console.log("  KeyringDeleGateModule:", contracts.keyringDeleGateModule);
        }
        
        console.log("");
        console.log("========================================");
        console.log("    DEPLOYMENT COMPLETE");
        console.log("========================================");
        console.log("");
    }
}