import { useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import toast from 'react-hot-toast';

import { useProgramContext } from '../contexts/ProgramContext';
import { AssetType, TimeLockData } from '../types';
import { ValidationUtils } from '../utils/validation';
import { SUCCESS_MESSAGES } from '../utils/constants';

// Custom hook for time lock operations
export const useTimeLock = () => {
  const { connected, publicKey } = useWallet();
  const { 
    initialize, 
    depositSol, 
    depositToken, 
    withdrawSol,
    withdrawAndCloseSol,
    closeEmptyAccount,
    getUserTimeLocks 
  } = useProgramContext();

  const [isLoading, setIsLoading] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState<string | null>(null);

  // Create time lock
  const createTimeLock = useCallback(async (
    amount: string,
    unlockDateTime: string,
    selectedToken: any,
    recipientAddress?: string
  ) => {
    // Validate inputs
    const walletValidation = ValidationUtils.validateWalletConnection(connected, publicKey);
    if (!walletValidation.isValid) {
      toast.error(walletValidation.error!);
      return { success: false, error: walletValidation.error };
    }

    const amountValidation = ValidationUtils.validateAmount(amount, selectedToken.decimals);
    if (!amountValidation.isValid) {
      toast.error(amountValidation.error!);
      return { success: false, error: amountValidation.error };
    }

    const dateValidation = ValidationUtils.validateUnlockDate(unlockDateTime);
    if (!dateValidation.isValid) {
      toast.error(dateValidation.error!);
      return { success: false, error: dateValidation.error };
    }

    setIsLoading(true);
    
    try {
      // Parse the date string as local time (Vietnam time)
      const [datePart, timePart] = unlockDateTime.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hour, minute] = timePart.split(':').map(Number);
      
      // Create date object in local timezone
      const unlockDate = new Date(year, month - 1, day, hour, minute);
      const unlockTimestamp = Math.floor(unlockDate.getTime() / 1000);
      const assetType = selectedToken.symbol === 'SOL' ? AssetType.Sol : AssetType.Token;
      
      // Step 1: Initialize time lock account
      toast.loading('Initializing time-lock wallet...', { id: 'create-lock' });
      
      const { publicKey: timeLockAccount, signature: initSignature } = await initialize({
        unlockTimestamp,
        assetType,
      });

      toast.loading('Sending funds to time-lock wallet...', { id: 'create-lock' });

      // Step 2: Deposit funds
      if (selectedToken.symbol === 'SOL') {
        const amountInLamports = Math.floor(parseFloat(amount) * LAMPORTS_PER_SOL);
        
        await depositSol({
          amount: amountInLamports,
          timeLockAccount,
        });
      } else {
        // Handle token deposits
        if (!selectedToken.mint) {
          throw new Error('Invalid token mint address');
        }

        await depositToken({
          amount: Math.floor(parseFloat(amount) * Math.pow(10, selectedToken.decimals)),
          timeLockAccount,
          tokenMint: new PublicKey(selectedToken.mint),
        });
      }

      const recipientText = recipientAddress ? `\nRecipient: ${recipientAddress.slice(0, 8)}...${recipientAddress.slice(-8)}` : '';
      
      toast.success(
        `${SUCCESS_MESSAGES.WALLET_CREATED}\n` +
        `Amount: ${amount} ${selectedToken.symbol}${recipientText}\n` +
        `Unlock: ${unlockDateTime.replace('T', ' ')} (Vietnam Time)`,
        { 
          id: 'create-lock',
          duration: 5000 
        }
      );

      return { 
        success: true, 
        timeLockAccount, 
        initSignature 
      };
      
    } catch (error: any) {
      const errorMessage = ValidationUtils.formatError(error);
      toast.error(`Error: ${errorMessage}`, { id: 'create-lock' });
      return { success: false, error: errorMessage };
    } finally {
      setIsLoading(false);
    }
  }, [connected, publicKey, initialize, depositSol, depositToken]);

  // Withdraw from time lock
  const withdrawFromTimeLock = useCallback(async (timeLock: TimeLockData) => {
    const walletValidation = ValidationUtils.validateWalletConnection(connected, publicKey);
    if (!walletValidation.isValid) {
      toast.error(walletValidation.error!);
      return { success: false, error: walletValidation.error };
    }

    // Double-check if time lock is actually unlocked
    const currentTime = Math.floor(Date.now() / 1000);
    const unlockTime = timeLock.account.unlockTimestamp.toNumber();
    const isActuallyUnlocked = currentTime >= unlockTime;

    if (!isActuallyUnlocked) {
      toast.error('Lock time has not expired yet');
      return { success: false, error: 'Lock time has not expired yet' };
    }

    // Verify owner matches
    if (!timeLock.account.owner.equals(publicKey!)) {
      toast.error('You are not the owner of this time lock');
      return { success: false, error: 'Not the owner' };
    }

    setIsWithdrawing(timeLock.publicKey.toBase58());
    
    try {
      toast.loading('Đang rút tiền...', { id: 'withdraw' });

      if (timeLock.account.assetType === AssetType.Sol) {
        await withdrawSol(timeLock.publicKey);
        
        const amount = (timeLock.account.amount.toNumber() / LAMPORTS_PER_SOL).toFixed(4);
        toast.success(
          `${SUCCESS_MESSAGES.WITHDRAW_SUCCESS} ${amount} SOL!`,
          { id: 'withdraw', duration: 5000 }
        );
      } else {
        // Handle token withdrawal
        if (!timeLock.account.tokenVault) {
          throw new Error('Invalid token vault');
        }

        // For token withdrawal, we need the token mint address
        // This would typically be stored or derived from the token vault
        throw new Error('Token withdrawal requires additional mint address information');
      }

      return { success: true };
      
    } catch (error: any) {
      const errorMessage = ValidationUtils.formatError(error);
      toast.error(`Withdrawal error: ${errorMessage}`, { id: 'withdraw' });
      return { success: false, error: errorMessage };
    } finally {
      setIsWithdrawing(null);
    }
  }, [connected, publicKey, withdrawSol]);

  // Withdraw and close account (combine withdraw + close in one transaction)
  const withdrawAndCloseTimeLock = useCallback(async (timeLock: TimeLockData) => {
    const walletValidation = ValidationUtils.validateWalletConnection(connected, publicKey);
    if (!walletValidation.isValid) {
      toast.error(walletValidation.error!);
      return { success: false, error: walletValidation.error };
    }

    // Double-check if time lock is actually unlocked
    const currentTime = Math.floor(Date.now() / 1000);
    const unlockTime = timeLock.account.unlockTimestamp.toNumber();
    const isActuallyUnlocked = currentTime >= unlockTime;

    if (!isActuallyUnlocked) {
      toast.error('Lock time has not expired yet');
      return { success: false, error: 'Lock time has not expired yet' };
    }

    // Verify owner matches
    if (!timeLock.account.owner.equals(publicKey!)) {
      toast.error('You are not the owner of this time lock');
      return { success: false, error: 'Not the owner' };
    }

    setIsWithdrawing(timeLock.publicKey.toBase58());
    
    try {
      toast.loading('Đang rút tiền và đóng account...', { id: 'withdraw-close' });

      if (timeLock.account.assetType === AssetType.Sol) {
        await withdrawAndCloseSol(timeLock.publicKey);
        
        const amount = (timeLock.account.amount.toNumber() / LAMPORTS_PER_SOL).toFixed(4);
        toast.success(
          `${SUCCESS_MESSAGES.WITHDRAW_SUCCESS} ${amount} SOL và đã đóng account!`,
          { id: 'withdraw-close', duration: 5000 }
        );
      } else {
        // Handle token withdrawal and close
        if (!timeLock.account.tokenVault) {
          throw new Error('Invalid token vault');
        }

        // First withdraw tokens
        // Note: This would need token mint info, which should be derived from vault
        toast.error('Token withdraw and close not fully implemented yet');
        return { success: false, error: 'Token withdraw and close feature coming soon' };
      }

      return { success: true };
      
    } catch (error: any) {
      const errorMessage = ValidationUtils.formatError(error);
      toast.error(`Withdrawal error: ${errorMessage}`, { id: 'withdraw-close' });
      return { success: false, error: errorMessage };
    } finally {
      setIsWithdrawing(null);
    }
  }, [connected, publicKey, withdrawAndCloseSol]);

  // Close empty account
  const closeEmptyTimeLock = useCallback(async (timeLock: TimeLockData) => {
    const walletValidation = ValidationUtils.validateWalletConnection(connected, publicKey);
    if (!walletValidation.isValid) {
      toast.error(walletValidation.error!);
      return { success: false, error: walletValidation.error };
    }

    // Check if account is actually empty
    if (timeLock.account.amount.toNumber() > 0) {
      toast.error('Cannot close account with remaining funds');
      return { success: false, error: 'Account not empty' };
    }

    // Verify owner matches
    if (!timeLock.account.owner.equals(publicKey!)) {
      toast.error('You are not the owner of this time lock');
      return { success: false, error: 'Not the owner' };
    }

    setIsWithdrawing(timeLock.publicKey.toBase58());
    
    try {
      toast.loading('Đang đóng empty account...', { id: 'close-empty' });
      
      await closeEmptyAccount(timeLock.publicKey);
      
      toast.success('Đã đóng empty account thành công!', { id: 'close-empty', duration: 5000 });

      return { success: true };
      
    } catch (error: any) {
      const errorMessage = ValidationUtils.formatError(error);
      toast.error(`Close account error: ${errorMessage}`, { id: 'close-empty' });
      return { success: false, error: errorMessage };
    } finally {
      setIsWithdrawing(null);
    }
  }, [connected, publicKey, closeEmptyAccount]);

  // Load user time locks
  const loadUserTimeLocks = useCallback(async (): Promise<TimeLockData[]> => {
    console.log('🔄 loadUserTimeLocks called:', { connected, publicKey: publicKey?.toBase58() });
    
    if (!connected || !publicKey) {
      console.log('❌ Not connected or no public key');
      return [];
    }

    try {
      console.log('📡 Calling getUserTimeLocks...');
      const result = await getUserTimeLocks(publicKey);
      console.log('✅ getUserTimeLocks result:', result.length, 'items');
      return result;
    } catch (error) {
      console.error('❌ Error in loadUserTimeLocks:', error);
      toast.error('Unable to load time-lock list');
      return [];
    }
  }, [connected, publicKey, getUserTimeLocks]);

  return {
    isLoading,
    isWithdrawing,
    createTimeLock,
    withdrawFromTimeLock,
    withdrawAndCloseTimeLock,
    closeEmptyTimeLock,
    loadUserTimeLocks,
  };
};
