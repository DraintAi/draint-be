# drain't — Submission (code-usage map for judges)

> AI security agent that stops wallet drainers — EIP-7702 delegations, Permit/Permit2 phishing, and malicious approvals — before your funds move. **Wallet drain? Didn't happen.**

**Tracks applied:** Best Agent · Best use of Venice AI · Best Use of 1Shot Permissionless Relayer

**Live:** Frontend https://draint.vercel.app · Backend https://api-draint.vercel.app · Snap `npm:@draint/snap`
**Proof tx (1Shot gasless rescue, Arbitrum One):** https://arbiscan.io/tx/0x401874cc3404083dca0010684931604dd9a1a944129d8653646a3882e0f02d35
**Contract (verified, Sepolia):** https://sepolia.etherscan.io/address/0x2187D61279a8A54dc8907865959ef6cC8beBDa14

---

## 1. MetaMask Smart Accounts Kit Usage

**Delegations — create & sign** (Stateless-7702 smart account + ERC-20-scoped delegation to the 1Shot redeemer):
- https://github.com/DraintAi/draint-be/blob/main/src/agent/oneshot7710.ts (`toMetaMaskSmartAccount`, `createDelegation`, `account.signDelegation`, `signAuthorization`)

**Delegations — redeem** (permissionContext + executions submitted for redemption via relayer):
- https://github.com/DraintAi/draint-be/blob/main/src/agent/oneshot7710.ts (estimate/send with `permissionContext`)

**On-chain caveat enforcer** (ICaveatEnforcer on MetaMask delegation framework v1.3.0; deployed + verified on Sepolia):
- https://github.com/DraintAi/draint-sc/blob/main/src/DraintCuratedTargetsEnforcer.sol
- Tests / attack simulation: https://github.com/DraintAi/draint-sc/blob/main/test/AttackSimulation.t.sol

**MetaMask Snap — Smart Accounts Kit integration in the main flow** (intercepts signatures + EIP-7702 authorizations in the wallet):
- onSignature / onTransaction: https://github.com/DraintAi/draint-fe/blob/main/snap/src/index.tsx
- EIP-7702 authorization-list parsing: https://github.com/DraintAi/draint-fe/blob/main/snap/src/eip7702.ts

## 2. Best Agent — autonomous agent

- Monitor → classify → rescue loop: https://github.com/DraintAi/draint-be/blob/main/src/agent/loop.ts
- EVM delegation monitor: https://github.com/DraintAi/draint-be/blob/main/src/agent/monitor.ts
- Agent HTTP surface (watch / incidents / tick): https://github.com/DraintAi/draint-be/blob/main/src/routes/agent.ts

## 3. 1Shot Permissionless Relayer Usage

Full EIP-7710 gasless-rescue flow — `relayer_getCapabilities` → `relayer_getFeeData` → `relayer_estimate7710Transaction` → `relayer_send7710Transaction` → `relayer_getStatus`; gas paid in USDC, zero ETH:
- https://github.com/DraintAi/draint-be/blob/main/src/agent/oneshot7710.ts
- Rescue routing / modes: https://github.com/DraintAi/draint-be/blob/main/src/agent/rescue.ts
- Runnable CLI (dry-run + live `--send`): https://github.com/DraintAi/draint-be/blob/main/scripts/oneshot-rescue.ts
- **Verified on-chain:** https://arbiscan.io/tx/0x401874cc3404083dca0010684931604dd9a1a944129d8653646a3882e0f02d35

## 4. Venice AI Usage

- Venice client + classification prompt: https://github.com/DraintAi/draint-be/blob/main/src/lib/classifier/venice.ts
- Classifier orchestration (heuristic → Venice escalation on borderline): https://github.com/DraintAi/draint-be/blob/main/src/lib/classifier/index.ts

## 5. Feedback
<!-- if applying: link the issue / feedback you submitted -->

## 6. Social Media
<!-- if applying: link your X post tagging @MetaMaskDev showing the drain't journey -->
