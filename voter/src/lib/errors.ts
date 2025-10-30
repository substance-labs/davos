export class KmsDeployError extends Error {
  public readonly transactionHash: string;
  public readonly status: string;
  
  constructor(transactionHash: string, status: string) {
    super(`Failed to set KMS adapter: Transaction failed with status ${status}`);
    this.name = 'KmsDeployError';
    this.transactionHash = transactionHash;
    this.status = status;
    
    // Required for proper instanceof behavior with TypeScript
    Object.setPrototypeOf(this, KmsDeployError.prototype);
  }
}