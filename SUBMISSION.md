# drain't — Hackathon Submission

> AI security agent that stops wallet drainers — EIP-7702 delegations, Permit/Permit2 phishing, and malicious approvals — before your funds move. **Wallet drain? Didn't happen.**

**Tracks:** Best Agent · Best use of Venice AI · Best Use of 1Shot Permissionless Relayer
**Live:** [draint.vercel.app](https://draint.vercel.app) · [api-draint.vercel.app](https://api-draint.vercel.app) · `npm:@draint/snap`
**Proof tx (1Shot gasless rescue, Arbitrum One):** https://arbiscan.io/tx/0x401874cc3404083dca0010684931604dd9a1a944129d8653646a3882e0f02d35

---

## Smart Accounts Kit Usage

### Advanced Permissions
Not used — drain't integrates via **Delegations (ERC-7710)**, not ERC-7715 Advanced Permissions.

### Delegations
- **Create delegation:** [src/agent/oneshot7710.ts](https://github.com/DraintAi/draint-be/blob/main/src/agent/oneshot7710.ts) — `toMetaMaskSmartAccount` (Stateless-7702) + `createDelegation` (ERC-20 transfer scope) + `signDelegation` + `signAuthorization`
- **Redeem delegation:** [src/agent/oneshot7710.ts](https://github.com/DraintAi/draint-be/blob/main/src/agent/oneshot7710.ts) — signed `permissionContext` submitted to the 1Shot relayer for redemption; on-chain caveat enforced by [draint-sc/src/DraintCuratedTargetsEnforcer.sol](https://github.com/DraintAi/draint-sc/blob/main/src/DraintCuratedTargetsEnforcer.sol) (ICaveatEnforcer, delegation framework v1.3.0, verified on Sepolia)
- Snap reads EIP-7702 delegation targets in the wallet's main flow: [draint-fe/snap/src/index.tsx](https://github.com/DraintAi/draint-fe/blob/main/snap/src/index.tsx) · [eip7702.ts](https://github.com/DraintAi/draint-fe/blob/main/snap/src/eip7702.ts)

### Redelegation
Not used — drain't uses a single-hop delegation (user → 1Shot redeemer).

### x402
Not used.

## 1Shot API Usage
- Full EIP-7710 gasless flow — `relayer_getCapabilities` → `relayer_getFeeData` → `relayer_estimate7710Transaction` → `relayer_send7710Transaction` → `relayer_getStatus`: [src/agent/oneshot7710.ts](https://github.com/DraintAi/draint-be/blob/main/src/agent/oneshot7710.ts)
- Rescue routing / modes: [src/agent/rescue.ts](https://github.com/DraintAi/draint-be/blob/main/src/agent/rescue.ts)
- Runnable CLI: [scripts/oneshot-rescue.ts](https://github.com/DraintAi/draint-be/blob/main/scripts/oneshot-rescue.ts)
- Verified on-chain (Arbitrum One, gas paid in USDC, zero ETH): https://arbiscan.io/tx/0x401874cc3404083dca0010684931604dd9a1a944129d8653646a3882e0f02d35

## Venice AI Usage
- Venice client + classification prompt: [src/lib/classifier/venice.ts](https://github.com/DraintAi/draint-be/blob/main/src/lib/classifier/venice.ts)
- Classifier orchestration (heuristic → Venice escalation on borderline): [src/lib/classifier/index.ts](https://github.com/DraintAi/draint-be/blob/main/src/lib/classifier/index.ts)

---

_Also applying for **Best Agent** — autonomous monitor→classify→rescue loop: [loop.ts](https://github.com/DraintAi/draint-be/blob/main/src/agent/loop.ts) · [monitor.ts](https://github.com/DraintAi/draint-be/blob/main/src/agent/monitor.ts) · [routes/agent.ts](https://github.com/DraintAi/draint-be/blob/main/src/routes/agent.ts)_
