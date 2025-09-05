import React, { useMemo } from 'react';
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
  TorusWalletAdapter,
} from '@solana/wallet-adapter-wallets';

import { useCluster } from './ClusterContext';

// Import wallet adapter CSS
require('@solana/wallet-adapter-react-ui/styles.css');

interface WalletContextProviderProps {
  children: React.ReactNode;
}

const WalletContextProvider: React.FC<WalletContextProviderProps> = ({ children }) => {
  // Get cluster endpoint from ClusterContext
  const { endpoint } = useCluster();

  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new TorusWalletAdapter(),
    ],
    []
  );

  console.log('🌐 WalletContext using endpoint:', endpoint);

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
};

export default WalletContextProvider;
