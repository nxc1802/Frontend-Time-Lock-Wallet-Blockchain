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
      
      // Get all time-lock accounts using getProgramAccounts (more reliable)
      console.log('🔍 Fetching accounts using getProgramAccounts...');
      
      let allAccounts;
      try {
        // Use getProgramAccounts directly - this is more reliable than Anchor's account methods
        const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
          filters: [
            {
              dataSize: 200 // Approximate size of TimeLockAccount
            }
          ]
        });
        
        console.log('📊 Found accounts via getProgramAccounts:', accounts.length);
        
        // Convert to the format expected by the rest of the code
        allAccounts = accounts.map(account => {
          try {
            // Try to decode using the program's coder
            const decoded = program.coder.accounts.decode('TimeLockAccount', account.account.data);
            return {
              publicKey: account.pubkey,
              account: decoded
            };
          } catch (decodeError) {
            console.error('❌ Failed to decode account with Anchor coder:', account.pubkey.toBase58(), decodeError);
            
            // Fallback: Try manual decoding based on the known structure
            try {
              console.log('🔧 Trying manual decoding for account:', account.pubkey.toBase58());
              const data = account.account.data;
              
              // Skip discriminator (8 bytes)
              let offset = 8;
              
              // Read owner (32 bytes)
              const owner = new PublicKey(data.slice(offset, offset + 32));
              offset += 32;
              
              // Read unlock_timestamp (8 bytes, little endian)
              const unlockTimestamp = data.readBigUInt64LE(offset);
              offset += 8;
              
              // Read asset_type (1 byte)
              const assetTypeByte = data[offset];
              const assetType = assetTypeByte === 0 ? { sol: {} } : { token: {} };
              offset += 1;
              
              // Read bump (1 byte)
              const bump = data[offset];
              offset += 1;
              
              // Read amount (8 bytes, little endian)
              const amount = data.readBigUInt64LE(offset);
              offset += 8;
              
              // Read token_vault (32 bytes)
              const tokenVault = new PublicKey(data.slice(offset, offset + 32));
              offset += 32;
              
              // Read is_initialized (1 byte)
              const isInitialized = data[offset] === 1;
              offset += 1;
              
              // Read sol_balance (8 bytes, little endian)
              const solBalance = data.readBigUInt64LE(offset);
              offset += 8;
              
              // Read spl_token_account (Option<Pubkey> - 1 byte + 32 bytes if Some)
              const hasSplTokenAccount = data[offset] === 1;
              offset += 1;
              const splTokenAccount = hasSplTokenAccount ? new PublicKey(data.slice(offset, offset + 32)) : null;
              if (hasSplTokenAccount) offset += 32;
              
              // Read is_processing (1 byte)
              const isProcessing = data[offset] === 1;
              
              const decoded = {
                owner,
                unlockTimestamp: new BN(unlockTimestamp.toString()),
                assetType,
                bump,
                amount: new BN(amount.toString()),
                tokenVault,
                isInitialized,
                solBalance: new BN(solBalance.toString()),
                splTokenAccount,
                isProcessing
              };
              
              console.log('✅ Manual decoding successful for account:', account.pubkey.toBase58());
              return {
                publicKey: account.pubkey,
                account: decoded
              };
            } catch (manualDecodeError) {
              console.error('❌ Manual decoding also failed:', account.pubkey.toBase58(), manualDecodeError);
              return null;
            }
          }
        }).filter(Boolean);
        
        console.log('✅ Successfully decoded accounts:', allAccounts.length);
      } catch (error) {
        console.error('❌ getProgramAccounts failed:', error);
        throw error;
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
        console.log('🔎 Account:', account.publicKey.toBase58(), 'Owner:', owner.toBase58(), 'IsUserOwned:', isUserOwned);
        return isUserOwned;
      });

      console.log('✅ User-owned accounts found:', userAccounts.length);

      const timeLockData: TimeLockData[] = [];

      for (const account of userAccounts) {
        if (!account) continue; // Skip null accounts
        
        try {
          console.log('🔧 Processing account:', account.publicKey.toBase58());
          console.log('📋 Account data:', {
            owner: account.account.owner.toBase58(),
            unlockTimestamp: account.account.unlockTimestamp.toNumber(),
            amount: account.account.amount.toNumber(),
            assetType: account.account.assetType,
            isInitialized: account.account.isInitialized,
            solBalance: account.account.solBalance.toNumber(),
            isProcessing: account.account.isProcessing
          });
          
          // Try to get wallet info, but don't fail if it doesn't work
          let walletInfo;
          try {
            walletInfo = await getWalletInfo(account.publicKey);
            console.log('✅ Wallet info retrieved:', walletInfo);
          } catch (walletInfoError) {
            console.log('⚠️ Could not get wallet info, using account data only:', walletInfoError);
            walletInfo = undefined;
          }
          
          // Map account data with proper field mapping
          const accountData = account.account;
          console.log('📋 Raw account data:', {
            owner: accountData.owner?.toBase58?.() || accountData.owner,
            unlockTimestamp: accountData.unlockTimestamp?.toNumber?.() || accountData.unlockTimestamp,
            assetType: accountData.assetType,
            amount: accountData.amount?.toNumber?.() || accountData.amount,
            isInitialized: accountData.isInitialized,
            solBalance: accountData.solBalance?.toNumber?.() || accountData.solBalance,
            isProcessing: accountData.isProcessing
          });

          timeLockData.push({
            publicKey: account.publicKey,
            account: {
              owner: accountData.owner,
              unlockTimestamp: accountData.unlockTimestamp,
              assetType: accountData.assetType?.sol ? AssetType.Sol : AssetType.Token,
              bump: accountData.bump,
              amount: accountData.amount,
              tokenVault: accountData.tokenVault,
              isInitialized: accountData.isInitialized,
              solBalance: accountData.solBalance,
              splTokenAccount: accountData.splTokenAccount,
              isProcessing: accountData.isProcessing,
            },
            walletInfo,
          });
        } catch (error) {
          console.error('❌ Error processing account:', account.publicKey.toBase58(), error);
          // Skip this account if there's an error
        }
      }

      console.log('🎯 Final timeLockData:', timeLockData);
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
