import * as StellarSdk from "@stellar/stellar-sdk";

const NETWORK = process.env.STELLAR_NETWORK ?? "testnet";

export const NETWORK_PASSPHRASE =
  NETWORK === "mainnet"
    ? StellarSdk.Networks.PUBLIC
    : StellarSdk.Networks.TESTNET;

export const RPC_URL =
  NETWORK === "mainnet"
    ? "https://soroban-rpc.stellar.org"
    : "https://soroban-testnet.stellar.org";

// ── StellarService singleton ────────────────────────────────────────────────

class StellarService {
  public readonly contractId: string;
  public readonly server: StellarSdk.SorobanRpc.Server;

  constructor() {
    this.contractId = process.env.CONTRACT_ID!;
    this.server = new StellarSdk.SorobanRpc.Server(RPC_URL);
  }

  /** Submit a signed contract invocation from the admin keypair. */
  async invoke(method: string, args: StellarSdk.xdr.ScVal[]): Promise<string> {
    const adminKeypair = StellarSdk.Keypair.fromSecret(
      process.env.ADMIN_SECRET_KEY!
    );
    const account = await this.server.getAccount(adminKeypair.publicKey());
    const contract = new StellarSdk.Contract(this.contractId);

    let tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(contract.call(method, ...args))
      .setTimeout(30)
      .build();

    const sim = await this.server.simulateTransaction(tx);
    if (StellarSdk.SorobanRpc.Api.isSimulationError(sim)) {
      throw new Error(sim.error);
    }

    tx = StellarSdk.SorobanRpc.assembleTransaction(tx, sim).build();
    tx.sign(adminKeypair);

    const result = await this.server.sendTransaction(tx);
    if (result.status === "ERROR") {
      throw new Error(`Transaction failed: ${result.errorResult}`);
    }
    return result.hash;
  }

  /** Read-only simulation. */
  async query(
    method: string,
    args: StellarSdk.xdr.ScVal[]
  ): Promise<StellarSdk.xdr.ScVal> {
    const adminKeypair = StellarSdk.Keypair.fromSecret(
      process.env.ADMIN_SECRET_KEY!
    );
    const account = await this.server.getAccount(adminKeypair.publicKey());
    const contract = new StellarSdk.Contract(this.contractId);

    const tx = new StellarSdk.TransactionBuilder(account, {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
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

const stellarService = new StellarService();

// ── Back-compat singleton aliases (no duplicates) ──────────────────────────

export const CONTRACT_ID = stellarService.contractId;
export const server = stellarService.server;
export const adminInvoke = stellarService.invoke.bind(stellarService);
export const contractQuery = stellarService.query.bind(stellarService);
