import * as StellarSdk from "@stellar/stellar-sdk";
import { contractCalls } from "./metrics.js";

const NETWORK = process.env.STELLAR_NETWORK ?? "testnet";
export const NETWORK_PASSPHRASE =
  NETWORK === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

export const RPC_URL =
  NETWORK === "mainnet"
    ? "https://soroban-rpc.stellar.org"
    : "https://soroban-testnet.stellar.org";

export class StellarService {
  readonly server: StellarSdk.SorobanRpc.Server;
  readonly contractId: string;
  private readonly networkPassphrase: string;
  private readonly adminKeypair: StellarSdk.Keypair;

  constructor(config: {
    rpcUrl: string;
    adminSecret: string;
    contractId: string;
    network: string;
  }) {
    this.server = new StellarSdk.SorobanRpc.Server(config.rpcUrl);
    // Load keypair once. The raw secret string is not referenced after this.
    this.adminKeypair = StellarSdk.Keypair.fromSecret(config.adminSecret);
    this.contractId = config.contractId;
    this.networkPassphrase = config.network;
  }

  /** Submit a signed contract invocation from the admin keypair. */
  async invoke(method: string, args: StellarSdk.xdr.ScVal[]): Promise<string> {
    const account = await this.server.getAccount(this.adminKeypair.publicKey());
    const contract = new StellarSdk.Contract(this.contractId);

    let tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (StellarSdk.SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(sim.error);
    }

    tx = StellarSdk.SorobanRpc.assembleTransaction(tx, sim).build();
    tx.sign(this.adminKeypair);

    const sendResult = await this.server.sendTransaction(tx);
    if (sendResult.status === "ERROR") {
      contractCalls.inc({ method, status: "error" });
      throw new Error(`Transaction submission failed: ${sendResult.errorResult}`);
    }

    const hash = sendResult.hash;
    const timeoutMs = Number(process.env.TX_TIMEOUT_MS ?? 30_000);
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 1_500));
      const status = await this.server.getTransaction(hash);
      if (status.status === StellarSdk.SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
        contractCalls.inc({ method, status: "success" });
        return hash;
      }
      if (status.status === StellarSdk.SorobanRpc.Api.GetTransactionStatus.FAILED) {
        contractCalls.inc({ method, status: "error" });
        throw new Error(`Transaction ${hash} failed on-chain`);
      }
    }

    contractCalls.inc({ method, status: "timeout" });
    throw new Error(`Transaction ${hash} not confirmed within ${timeoutMs}ms`);
  }

  /** Read-only simulation. */
  async query(
    method: string,
    args: StellarSdk.xdr.ScVal[]
  ): Promise<StellarSdk.xdr.ScVal> {
    const account = await this.server.getAccount(this.adminKeypair.publicKey());
    const contract = new StellarSdk.Contract(this.contractId);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: this.networkPassphrase,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (StellarSdk.SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(sim.error);
    }
    return (sim as any).result?.retval;
  }
}

// Singleton instance — created once at startup and injected into routes.
export const stellarService = new StellarService({
  rpcUrl: RPC_URL,
  adminSecret: process.env.ADMIN_SECRET_KEY!,
  contractId: process.env.CONTRACT_ID!,
  network: NETWORK_PASSPHRASE,
});

// Back-compat aliases so existing callers (bridge, payments) keep working.
export const CONTRACT_ID = stellarService.contractId;
export const server = stellarService.server;
export const adminInvoke = stellarService.invoke.bind(stellarService);
export const contractQuery = stellarService.query.bind(stellarService);
