"use client";

import { create } from "zustand";
import { StellarWalletsKit, WalletNetwork, FREIGHTER_ID } from "@creit.tech/stellar-wallets-kit";

interface WalletState {
  address: string | null;
  kit: StellarWalletsKit | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  signTransaction: (xdr: string) => Promise<string>;
}

function buildKit(): StellarWalletsKit {
  return new StellarWalletsKit({
    network:
      import.meta.env.VITE_NETWORK_PASSPHRASE?.includes("Test")
        ? WalletNetwork.TESTNET
        : WalletNetwork.PUBLIC,
    selectedWalletId: FREIGHTER_ID,
  });
}

export const useWalletStore = create<WalletState>((set, get) => ({
  address: null,
  kit: null,

  connect: async () => {
    const kit = buildKit();
    await kit.openModal({
      onWalletSelected: async (option) => {
        kit.setWallet(option.id);
        const { address } = await kit.getAddress();
        set({ address, kit });
      },
    });
  },

  disconnect: () => set({ address: null, kit: null }),

  signTransaction: async (xdr: string) => {
    const { kit, address } = get();
    if (!kit || !address) throw new Error("Wallet not connected");
    const { signedTxXdr } = await kit.signTransaction(xdr, {
      address,
      networkPassphrase: import.meta.env.VITE_NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015',
    });
    return signedTxXdr;
  },
}));
