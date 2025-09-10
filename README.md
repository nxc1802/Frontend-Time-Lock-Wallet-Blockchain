# Time-Locked Wallet Frontend

A modern React/TypeScript frontend application for creating time-locked wallets on Solana. This application allows users to lock their own SOL and SPL tokens with a specific unlock time, ensuring funds can only be withdrawn after the lock period expires.

## 🚀 Features

- *Self-Locking Wallets*: Lock your own tokens with custom unlock timestamps
- *Multi-Asset Support*: Support for SOL and SPL tokens (USDC)
- *Tabbed Dashboard*: Easy switching between locked, ready to withdraw, and completed transactions
- *Wallet Integration*: Connect with Phantom, Solflare, and other Solana wallets
- *Dark Mode*: Beautiful dark/light theme toggle (default dark)
- *Responsive Design*: Mobile-first design with Tailwind CSS
- *Devnet Airdrop*: Request SOL and USDC from devnet faucet
- *Production Ready*: Optimized build with proper error handling

## 🛠 Tech Stack

- *React 19.1.1* with TypeScript
- *Tailwind CSS* for styling
- *@solana/wallet-adapter-react* for wallet integration
- *@coral-xyz/anchor* for blockchain interaction
- *react-hot-toast* for notifications

## 📦 Installation

# Install dependencies
npm install

# Start development server
npm start

# Build for production
npm run build

### Package Management

This project uses *npm* as the package manager with package-lock.json for dependency locking.

- *package-lock.json*: Ensures consistent dependency versions across all environments
- *Do not use yarn*: This would create conflicts with existing npm lock file
- *Version consistency*: All team members get the same dependency versions

If you prefer yarn, you can convert the project:
# Remove npm lock file
rm package-lock.json

# Install with yarn (creates yarn.lock)
yarn install

# Continue using yarn commands
yarn start
yarn build

*Note*: If using yarn, make sure to commit yarn.lock and avoid mixing npm/yarn commands.

## 🔧 Configuration

The application is configured to work with:
- *Network*: Solana Devnet
- *Program ID*: 899SKikn1WiRBSurKhMZyNCNvYmWXVE6hZFYbFim293g
- *Supported Wallets*: Phantom, Solflare, Torus

## 📱 Usage

1. *Connect Wallet*: Click the wallet button to connect your Solana wallet
2. *Create Time-Locked Wallet*: 
   - Select lock type (self-lock with beautiful selector)
   - Select asset type (SOL/USDC)
   - Enter amount to lock
   - Set unlock date/time
   - Confirm transaction
3. *View Dashboard*: Switch between tabs to monitor locked, ready to withdraw, and completed transactions
4. *Withdraw*: Withdraw funds when lock period expires
5. *Airdrop*: Request SOL/USDC from devnet faucet for testing

## 🏗 Project Structure

src/
├── components/          # Reusable UI components
├── contexts/           # React contexts (Wallet, Program)
├── pages/              # Main application pages
├── services/           # Business logic services
├── types/              # TypeScript definitions
└── utils/              # Utility functions

## 🔒 Security Features

- *Time Validation*: Prevents early withdrawals
- *Owner Verification*: Only wallet owner can withdraw
- *Transaction Signing*: All transactions require wallet approval
- *Error Handling*: Comprehensive error boundaries and user feedback

## 🚀 Deployment

# Build for production
npm run build

# Serve the build
npx serve -s build

## 📄 License

This project is part of a blockchain development portfolio and is for educational purposes.