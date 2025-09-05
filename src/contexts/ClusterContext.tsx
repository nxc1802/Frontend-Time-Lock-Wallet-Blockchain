import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { clusterApiUrl } from '@solana/web3.js';

export type Cluster = 'localnet' | 'devnet';

interface ClusterContextType {
  cluster: Cluster;
  endpoint: string;
  switchCluster: (cluster: Cluster) => void;
  isLocalnet: boolean;
  isDevnet: boolean;
}

const ClusterContext = createContext<ClusterContextType | null>(null);

export const useCluster = () => {
  const context = useContext(ClusterContext);
  if (!context) {
    throw new Error('useCluster must be used within ClusterProvider');
  }
  return context;
};

interface ClusterProviderProps {
  children: React.ReactNode;
}

const CLUSTER_ENDPOINTS = {
  localnet: 'http://127.0.0.1:8899',
  devnet: clusterApiUrl('devnet'),
} as const;

const STORAGE_KEY = 'time-locked-wallet-cluster';

export const ClusterProvider: React.FC<ClusterProviderProps> = ({ children }) => {
  // Load cluster preference from localStorage, default to devnet
  const [cluster, setCluster] = useState<Cluster>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return (saved === 'localnet' || saved === 'devnet') ? saved : 'devnet';
    } catch {
      return 'devnet';
    }
  });

  const endpoint = CLUSTER_ENDPOINTS[cluster];

  // Save cluster preference to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, cluster);
    } catch (error) {
      console.warn('Failed to save cluster preference:', error);
    }
  }, [cluster]);

  const switchCluster = useCallback((newCluster: Cluster) => {
    console.log(`🔄 Switching cluster from ${cluster} to ${newCluster}`);
    setCluster(newCluster);
  }, [cluster]);

  const value: ClusterContextType = {
    cluster,
    endpoint,
    switchCluster,
    isLocalnet: cluster === 'localnet',
    isDevnet: cluster === 'devnet',
  };

  return (
    <ClusterContext.Provider value={value}>
      {children}
    </ClusterContext.Provider>
  );
};

export default ClusterProvider;

