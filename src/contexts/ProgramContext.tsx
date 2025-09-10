import React, { createContext, useContext, useMemo, useEffect } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { Program, AnchorProvider, Idl, BN } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress } from '@solana/spl-token';

import IDL from '../time_locked_wallet.json';
import { 
  ProgramContextType, 
  InitializeParams, 
  DepositParams, 
  WalletInfo, 
  TimeLockData, 
  AssetType 
} from '../types';

// Debug IDL loading
console.log('📋 IDL loaded:', {
  address: IDL.address,
  instructions: IDL.instructions?.length || 0,
  accounts: IDL.accounts?.length || 0,
  types: IDL.types?.length || 0
});

const PROGRAM_ID = new PublicKey("899SKikn1WiRBSurKhMZyNCNvYmWXVE6hZFYbFim293g");

// Helper function to safely convert BN or number to number
const safeToNumber = (value: any): number => {
  if (typeof value === 'number') return value;
  if (value && typeof value.toNumber === 'function') return value.toNumber();
  return 0;
};

const ProgramContext = createContext<ProgramContextType | null>(null);

export const useProgramContext = () => {
  const context = useContext(ProgramContext);
  if (!context) {
    throw new Error('useProgramContext must be used within ProgramProvider');
  }
  return context;
};

interface ProgramProviderProps {
  children: React.ReactNode;
}

export const ProgramProvider: React.FC<ProgramProviderProps> = ({ children }) => {
  const { connection } = useConnection();
  const wallet = useWallet();

  // Track 403 errors
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (...args) => {
      try {
        const response = await originalFetch(...args);
        if (response.status === 403) {
          console.warn('🚫 403 Forbidden detected:', {
            url: args[0],
            status: response.status,
            statusText: response.statusText
          });
        }
        return response;
      } catch (error) {
        console.error('🔥 Fetch error:', error);
        throw error;
      }
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  const program = useMemo(() => {
    console.log('🔧 Program initialization check:', {
      hasPublicKey: !!wallet.publicKey,
      hasSignTransaction: !!wallet.signTransaction,
      connectionEndpoint: connection.rpcEndpoint,
      programId: PROGRAM_ID.toBase58()
    });
    
    if (!wallet.publicKey || !wallet.signTransaction) {
      console.log('❌ Program not initialized - missing wallet requirements');
      return null;
    }
    
    try {
      const provider = new AnchorProvider(
        connection,
        wallet as any,
        { commitment: 'confirmed' }
      );
      
      const program = new Program(IDL as Idl, provider);
      console.log('✅ Program initialized successfully');
      console.log('🔍 Program accounts available:', Object.keys(program.account));
      return program;
    } catch (error) {
      console.error('❌ Program initialization failed:', error);
      return null;
    }
  }, [connection, wallet]);

  // Get time lock PDA
  const getTimeLockPDA = (owner: PublicKey, unlockTimestamp: number): [PublicKey, number] => {
    const seeds = [
      Buffer.from("time_lock"),
      owner.toBuffer(),
      Buffer.from(new BN(unlockTimestamp).toArray("le", 8))
    ];
    
    return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
  };

  // Initialize a new time lock
  const initialize = async (params: InitializeParams): Promise<{ publicKey: PublicKey; signature: string }> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected or program not initialized');
    }

    const [timeLockAccount] = getTimeLockPDA(wallet.publicKey, params.unlockTimestamp);

    const tx = await program.methods
      .initialize(new BN(params.unlockTimestamp), { [params.assetType.toLowerCase()]: {} })
      .accounts({
        timeLockAccount,
        initializer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return { publicKey: timeLockAccount, signature: tx };
  };

  // Deposit SOL
  const depositSol = async (params: DepositParams): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected or program not initialized');
    }

    const tx = await program.methods
      .depositSol(new BN(params.amount))
      .accounts({
        timeLockAccount: params.timeLockAccount,
        initializer: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  };

  // Deposit Token
  const depositToken = async (params: DepositParams & { tokenMint: PublicKey }): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected or program not initialized');
    }

    const tokenFromAta = await getAssociatedTokenAddress(
      params.tokenMint,
      wallet.publicKey
    );

    const tokenVault = await getAssociatedTokenAddress(
      params.tokenMint,
      params.timeLockAccount,
      true // allowOwnerOffCurve
    );

    const tx = await program.methods
      .depositToken(new BN(params.amount))
      .accounts({
        timeLockAccount: params.timeLockAccount,
        initializer: wallet.publicKey,
        mint: params.tokenMint,
        tokenFromAta,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  };

  // Withdraw SOL
  const withdrawSol = async (timeLockAccount: PublicKey): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected or program not initialized');
    }

    console.log('=== WITHDRAWAL DEBUG ===');
    console.log('TimeLock Account:', timeLockAccount.toBase58());
    console.log('Owner:', wallet.publicKey.toBase58());
    
    // Check if account exists and get its data
    let accountInfo;
    try {
      accountInfo = await (program.account as any).timeLockAccount.fetch(timeLockAccount);
      console.log('Account exists:', !!accountInfo);
      console.log('Account data:', {
        owner: accountInfo.owner.toBase58(),
        unlockTimestamp: accountInfo.unlockTimestamp.toNumber(),
        assetType: accountInfo.assetType,
        amount: accountInfo.amount.toNumber(),
        isUnlocked: Date.now() / 1000 > accountInfo.unlockTimestamp.toNumber()
      });
    } catch (error) {
      console.error('Failed to fetch account:', error);
      throw new Error('Account not found or invalid');
    }

    // Verify PDA derivation
    const [expectedPDA] = getTimeLockPDA(accountInfo.owner, accountInfo.unlockTimestamp.toNumber());
    console.log('Expected PDA:', expectedPDA.toBase58());
    console.log('PDA matches:', expectedPDA.equals(timeLockAccount));
    
    if (!expectedPDA.equals(timeLockAccount)) {
      throw new Error('PDA derivation mismatch - account may be corrupted');
    }

    console.log('🚀 Attempting withdrawal with enhanced logging...');
    
    const tx = await program.methods
      .withdrawSol()
      .accounts({
        timeLockAccount,
        owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc({
        commitment: 'confirmed',
        preflightCommitment: 'confirmed'
      });

    return tx;
  };

  // Withdraw Token
  const withdrawToken = async (timeLockAccount: PublicKey, tokenMint: PublicKey): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected or program not initialized');
    }

    const tokenFromVault = await getAssociatedTokenAddress(
      tokenMint,
      timeLockAccount,
      true // allowOwnerOffCurve
    );

    const tokenToAta = await getAssociatedTokenAddress(
      tokenMint,
      wallet.publicKey
    );

    const tx = await program.methods
      .withdrawToken()
      .accounts({
        timeLockAccount,
        owner: wallet.publicKey,
        tokenFromVault,
        tokenToAta,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    return tx;
  };

  // Withdraw SOL and close account
  const withdrawAndCloseSol = async (timeLockAccount: PublicKey): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected or program not initialized');
    }

    console.log('=== WITHDRAW AND CLOSE SOL DEBUG ===');
    console.log('TimeLock Account:', timeLockAccount.toBase58());
    console.log('Owner:', wallet.publicKey.toBase58());

    const tx = await program.methods
      .withdrawAndCloseSol()
      .accounts({
        timeLockAccount,
        owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc({
        commitment: 'confirmed',
        preflightCommitment: 'confirmed'
      });

    return tx;
  };

  // Close empty account
  const closeEmptyAccount = async (timeLockAccount: PublicKey): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected or program not initialized');
    }

    const tx = await program.methods
      .closeEmptyAccount()
      .accounts({
        timeLockAccount,
        owner: wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  };

  // Close token account
  const closeTokenAccount = async (timeLockAccount: PublicKey, tokenVault: PublicKey): Promise<string> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected or program not initialized');
    }

    const tx = await program.methods
      .closeTokenAccount()
      .accounts({
        timeLockAccount,
        owner: wallet.publicKey,
        tokenVault,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    return tx;
  };

  // Get wallet info
  const getWalletInfo = async (timeLockAccount: PublicKey): Promise<WalletInfo> => {
    if (!program || !wallet.publicKey) {
      throw new Error('Wallet not connected or program not initialized');
    }

    const result = await program.methods
      .getWalletInfo()
      .accounts({
        timeLockAccount,
        owner: wallet.publicKey,
      })
      .view();

    return {
      owner: result.owner,
      unlockTimestamp: result.unlockTimestamp,
      assetType: result.assetType.sol ? AssetType.Sol : AssetType.Token,
      amount: result.amount,
      tokenVault: result.tokenVault,
      isUnlocked: result.isUnlocked,
      timeRemaining: result.timeRemaining,
    };
  };

  // Get user's time locks
  const getUserTimeLocks = async (userPublicKey: PublicKey): Promise<TimeLockData[]> => {
    if (!program) {
      console.error('❌ Program not initialized');
      throw new Error('Program not initialized');
    }

    try {
      console.log('🔍 Fetching all time-lock accounts...');
      console.log('🌐 Connection endpoint:', connection.rpcEndpoint);
      console.log('🔑 Program ID:', PROGRAM_ID.toBase58());
      
      // First try using Anchor's built-in account fetcher
      let allAccounts;
      try {
        console.log('🔍 Trying Anchor account.all()...');
        allAccounts = await (program.account as any).timeLockAccount.all();
        console.log('✅ Anchor account.all() successful:', allAccounts.length);
      } catch (anchorError) {
        console.log('⚠️ Anchor account.all() failed, trying getProgramAccounts:', anchorError);
        
        // Fallback to getProgramAccounts with correct sizes
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
          encoding: 'base64',
          // Remove size filter to get all accounts, then filter by data length
        });
        
        console.log('📊 Found accounts via getProgramAccounts:', accounts.length);
        
        // Convert to the format expected by the rest of the code
        allAccounts = accounts
          .filter(account => {
            // Filter by data length - time-lock accounts are typically 133 or 90 bytes
            const dataLength = account.account.data.length;
            return dataLength === 133 || dataLength === 90;
          })
          .map(account => {
          try {
            // First try Anchor decoder
            const decoded = program.coder.accounts.decode('TimeLockAccount', account.account.data);
            return {
              publicKey: account.pubkey,
              account: decoded
            };
          } catch (anchorError) {
            console.log('⚠️ Anchor decode failed, trying custom decoder for:', account.pubkey.toBase58());
            
            try {
              // Custom binary decoder for TimeLockAccount
              const data = account.account.data;
              
              // Expected discriminator: [112, 63, 106, 231, 182, 101, 88, 158]
              const expectedDiscriminator = [112, 63, 106, 231, 182, 101, 88, 158];
              const actualDiscriminator = Array.from(data.slice(0, 8));
              
              // Check discriminator
              const discriminatorMatch = expectedDiscriminator.every((byte, index) => 
                byte === actualDiscriminator[index]
              );
              
              if (!discriminatorMatch) {
                console.log('❌ Discriminator mismatch for:', account.pubkey.toBase58(), 
                  'Expected:', expectedDiscriminator, 'Actual:', actualDiscriminator);
                return null;
              }
              
              // Parse the account data manually
              // Full structure: 8-byte discriminator + 32-byte owner + 8-byte timestamp + 1-byte asset_type + 1-byte bump + 8-byte amount + 32-byte tokenVault + 1-byte isInitialized + 8-byte solBalance + more fields
              let offset = 8; // Skip discriminator
              
              // Owner (32 bytes)
              const ownerBytes = data.slice(offset, offset + 32);
              const owner = new PublicKey(ownerBytes);
              offset += 32;
              
              // Unlock timestamp (8 bytes, little-endian i64)
              const timestampBytes = data.slice(offset, offset + 8);
              const timestampBuffer = Buffer.from(timestampBytes);
              const unlockTimestamp = new BN(timestampBuffer, 'le');
              offset += 8;
              
              // Asset type (1 byte enum)
              const assetTypeByte = data[offset];
              let assetType;
              if (assetTypeByte === 0) {
                assetType = AssetType.Sol;
              } else if (assetTypeByte === 1) {
                assetType = AssetType.Token;
              } else {
                console.warn('⚠️ Unknown asset type:', assetTypeByte);
                assetType = AssetType.Sol; // Default
              }
              offset += 1;
              
              // Bump (1 byte)
              const bump = data[offset];
              offset += 1;
              
              // Amount (8 bytes, little-endian u64)
              const amountBytes = data.slice(offset, offset + 8);
              const amountBuffer = Buffer.from(amountBytes);
              const amount = new BN(amountBuffer, 'le');
              offset += 8;
              
              // Token vault (32 bytes)
              const tokenVaultBytes = data.slice(offset, offset + 32);
              const tokenVault = new PublicKey(tokenVaultBytes);
              offset += 32;
              
              // Is initialized (1 byte boolean)
              const isInitialized = data[offset] === 1;
              offset += 1;
              
              // Sol balance (8 bytes, little-endian u64) 
              const solBalanceBytes = data.slice(offset, offset + 8);
              const solBalanceBuffer = Buffer.from(solBalanceBytes);
              const solBalance = new BN(solBalanceBuffer, 'le');
              offset += 8;
              
              // SPL token account (32 bytes) - could be all zeros if null
              const splTokenAccountBytes = data.slice(offset, offset + 32);
              const splTokenAccount = new PublicKey(splTokenAccountBytes);
              // Check if it's all zeros (null)
              const isNullSplTokenAccount = splTokenAccountBytes.every(byte => byte === 0);
              offset += 32;
              
              // Is processing (1 byte boolean)
              const isProcessing = data[offset] === 1;
              
              console.log('✅ Custom decode successful:', {
                pubkey: account.pubkey.toBase58(),
                owner: owner.toBase58(),
                unlockTimestamp: unlockTimestamp.toString(),
                assetType,
                bump,
                amount: amount.toString(),
                tokenVault: tokenVault.toBase58(),
                isInitialized,
                solBalance: solBalance.toString(),
                splTokenAccount: isNullSplTokenAccount ? null : splTokenAccount.toBase58(),
                isProcessing
              });
              
              return {
                publicKey: account.pubkey,
                account: {
                  owner,
                  unlockTimestamp,
                  assetType,
                  bump,
                  amount,
                  tokenVault,
                  isInitialized,
                  solBalance,
                  splTokenAccount: isNullSplTokenAccount ? null : splTokenAccount,
                  isProcessing
                }
              };
              
            } catch (customError) {
              console.error('❌ Custom decode also failed for:', account.pubkey.toBase58(), customError);
              return null;
            }
          }
        }).filter(Boolean);
      }
      
      console.log('📊 Found total accounts:', allAccounts.length);
      console.log('👤 Looking for accounts owned by:', userPublicKey.toBase58());
      
      if (allAccounts.length === 0) {
        console.log('⚠️ No accounts found - this might be normal if no time-locks have been created yet');
        return [];
      }
      
      // Filter accounts where the user is the owner
      const userAccounts = allAccounts.filter((account: any) => {
        const owner = account.account.owner;
        const isUserOwned = owner.equals(userPublicKey);
        console.log('🔎 Account:', account.publicKey.toBase58().slice(0, 8) + '...', 'IsUserOwned:', isUserOwned);
        return isUserOwned;
      });

      console.log('✅ User-owned accounts found:', userAccounts.length);

      const timeLockData: TimeLockData[] = [];

      for (const account of userAccounts) {
        if (!account) continue; // Skip null accounts
        
        try {
          console.log('🔧 Processing account:', account.publicKey.toBase58());
          
          // Map account data with proper field mapping
          const accountData = account.account;
          
          // Determine asset type properly  
          let assetType: AssetType = accountData.assetType || AssetType.Sol;
          
          // Create wallet info manually based on account data
          const currentTime = Math.floor(Date.now() / 1000);
          const unlockTime = safeToNumber(accountData.unlockTimestamp);
          const isUnlocked = currentTime >= unlockTime;
          const timeRemaining = Math.max(0, unlockTime - currentTime);
          
          const walletInfo: WalletInfo = {
            owner: accountData.owner,
            unlockTimestamp: accountData.unlockTimestamp,
            assetType: assetType,
            amount: accountData.amount,
            tokenVault: accountData.tokenVault || new PublicKey("11111111111111111111111111111111"),
            isUnlocked: isUnlocked,
            timeRemaining: new BN(timeRemaining),
          };
          
          console.log('📋 Processed account data:', {
            owner: accountData.owner.toBase58(),
            unlockTimestamp: safeToNumber(accountData.unlockTimestamp),
            amount: safeToNumber(accountData.amount),
            assetType: assetType,
            isInitialized: accountData.isInitialized,
            isUnlocked: isUnlocked,
            timeRemaining: timeRemaining
          });

          timeLockData.push({
            publicKey: account.publicKey,
            account: {
              owner: accountData.owner,
              unlockTimestamp: accountData.unlockTimestamp,
              assetType: assetType,
              bump: accountData.bump || 0,
              amount: accountData.amount,
              tokenVault: accountData.tokenVault || new PublicKey("11111111111111111111111111111111"),
              isInitialized: accountData.isInitialized,
              solBalance: accountData.solBalance || new BN(0),
              splTokenAccount: accountData.splTokenAccount || null,
              isProcessing: accountData.isProcessing || false,
            },
            walletInfo,
          });
        } catch (error) {
          console.error('❌ Error processing account:', account.publicKey.toBase58(), error);
          // Skip this account if there's an error
        }
      }

      console.log('🎯 Final timeLockData:', timeLockData.length, 'items');
      return timeLockData;
    } catch (error) {
      console.error('❌ Error in getUserTimeLocks:', error);
      return [];
    }
  };

  const value: ProgramContextType = {
    program,
    connection,
    programId: PROGRAM_ID,
    initialize,
    depositSol,
    depositToken,
    withdrawSol,
    withdrawToken,
    withdrawAndCloseSol,
    closeEmptyAccount,
    closeTokenAccount,
    getWalletInfo,
    getUserTimeLocks,
    getTimeLockPDA,
  };

  return (
    <ProgramContext.Provider value={value}>
      {children}
    </ProgramContext.Provider>
  );
};

export default ProgramProvider;