import React from 'react';
import { useCluster, Cluster } from '../contexts/ClusterContext';
import { GlobeAltIcon } from '@heroicons/react/24/outline';

const ClusterSwitch: React.FC = () => {
  const { cluster, switchCluster, isLocalnet, isDevnet } = useCluster();

  const handleClusterChange = (newCluster: Cluster) => {
    if (newCluster !== cluster) {
      switchCluster(newCluster);
      // Reload page to reinitialize all connections
      window.location.reload();
    }
  };

  return (
    <div className="flex items-center space-x-2">
      <GlobeAltIcon className="h-5 w-5 text-gray-400" />
      <select
        value={cluster}
        onChange={(e) => handleClusterChange(e.target.value as Cluster)}
        className="
          bg-transparent text-sm font-medium
          text-gray-700 dark:text-gray-300
          border border-gray-300 dark:border-gray-600
          rounded-md px-2 py-1
          focus:outline-none focus:ring-2 focus:ring-indigo-500
          hover:bg-gray-100 dark:hover:bg-gray-700
          transition-colors duration-200
        "
      >
        <option value="devnet" className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
          Devnet
        </option>
        <option value="localnet" className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
          Localnet
        </option>
      </select>
      
      {/* Cluster status indicator - inline */}
      {isLocalnet && (
        <span className="inline-flex items-center text-xs text-gray-500 dark:text-gray-400">
          <span className="h-2 w-2 bg-yellow-400 rounded-full mr-1"></span>
          Local
        </span>
      )}
      {isDevnet && (
        <span className="inline-flex items-center text-xs text-gray-500 dark:text-gray-400">
          <span className="h-2 w-2 bg-green-400 rounded-full mr-1"></span>
          Devnet
        </span>
      )}
    </div>
  );
};

export default ClusterSwitch;

