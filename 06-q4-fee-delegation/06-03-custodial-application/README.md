# 6.3 Dagaon Core 커스터디얼 모델에서의 적용

상위 섹션: [6. Q4: Fee Delegation](../README.md)

## 커스터디얼 아키텍처 개요

Dagaon Core의 커스터디얼 모델에서 핫월렛은 두 가지 역할을 동시에 수행한다:

1. **Fee Payer**: 모든 트랜잭션의 수수료 지불
2. **Authority**: deposit 지갑 내 토큰에 대한 전송 권한

```
┌─────────────────────────────────────────────────────────────────┐
│                        Dagaon Core                              │
│                                                                 │
│  ┌──────────────┐                                               │
│  │   Hot Wallet  │  ← fee payer + authority (SOL 보유)          │
│  │  (단일 키페어) │                                               │
│  └──────┬───────┘                                               │
│         │                                                       │
│    ┌────┼────────────────────────────────┐                      │
│    │    │    Deposit 지갑들               │                      │
│    │    ▼                                │                      │
│    │  ┌──────────┐  ┌──────────┐        │                      │
│    │  │ Wallet A │  │ Wallet B │  ...   │                      │
│    │  │ SOL: 0   │  │ SOL: 0   │        │  ← SOL 잔액 0       │
│    │  │ USDC ATA │  │ USDC ATA │        │  ← SPL 토큰만 보유  │
│    │  └──────────┘  └──────────┘        │                      │
│    └─────────────────────────────────────┘                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

## SOL 잔액 0인 Deposit 지갑

Solana의 fee payer 모델 덕분에, deposit 지갑에는 SOL이 전혀 필요 없다.

### EVM에서의 문제

```
[EVM deposit 지갑]
- USDC 입금 받음 ✓
- collect(sweep) 하려면 → deposit 지갑에서 TX 발행 필요
- TX 발행하려면 → ETH(가스비) 필요
- ETH가 없으면 → 먼저 ETH를 공급해야 함

결과: deposit 지갑마다 ETH 잔액 관리 필요
     → gas-supply 모듈, 잔액 모니터링, 재공급 로직
```

### Solana에서의 해결

```
[Solana deposit 지갑]
- USDC 입금 받음 ✓
- collect(sweep) 하려면 → 핫월렛이 fee payer로 TX 구성
- deposit 지갑의 SOL? → 필요 없음
- 핫월렛이 fee + authority 모두 처리

결과: deposit 지갑에 SOL 공급 불필요
     → gas-supply 모듈 제거, 지갑별 모니터링 제거
```

## Collect (Sweep) 흐름

### 단일 지갑 Collect

```typescript
import {
  Transaction,
  Connection,
  Keypair,
  sendAndConfirmTransaction,
} from '@solana/web3.js';
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';

async function collectFromDeposit(
  connection: Connection,
  hotWallet: Keypair,           // fee payer + authority
  depositWalletPubkey: PublicKey,
  destinationPubkey: PublicKey,  // 콜드월렛 또는 핫월렛
  mintAddress: PublicKey,
  amount: bigint
) {
  const sourceATA = await getAssociatedTokenAddress(
    mintAddress,
    depositWalletPubkey
  );
  const destinationATA = await getAssociatedTokenAddress(
    mintAddress,
    destinationPubkey
  );

  const tx = new Transaction();
  tx.feePayer = hotWallet.publicKey;  // 핫월렛이 fee 부담

  // destination ATA가 없을 수 있으므로 idempotent 생성
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      hotWallet.publicKey,     // payer (ATA rent도 핫월렛이 부담)
      destinationATA,          // ATA 주소
      destinationPubkey,       // ATA 소유자
      mintAddress              // mint
    )
  );

  // 토큰 전송
  tx.add(
    createTransferInstruction(
      sourceATA,               // source
      destinationATA,          // destination
      hotWallet.publicKey,     // authority (핫월렛이 deposit 지갑 토큰의 authority)
      amount
    )
  );

  const sig = await sendAndConfirmTransaction(connection, tx, [hotWallet]);
  // 서명자: hotWallet 하나만 (fee payer + authority)
  return sig;
}
```

**핵심:** 커스터디얼 모델에서는 핫월렛이 deposit 지갑의 authority이므로,
서명자가 `hotWallet` 하나뿐이다. fee payer와 authority가 동일하므로 서명이 하나만 필요하다.

### 배치 Collect (여러 지갑 → 핫월렛)

```typescript
async function batchCollect(
  connection: Connection,
  hotWallet: Keypair,
  deposits: Array<{ wallet: PublicKey; amount: bigint }>,
  mintAddress: PublicKey
) {
  const hotWalletATA = await getAssociatedTokenAddress(
    mintAddress,
    hotWallet.publicKey
  );

  const tx = new Transaction();
  tx.feePayer = hotWallet.publicKey;

  // 주의: 트랜잭션 크기 제한 (1,232 bytes)
  // deposit 지갑당 ~1개 instruction + account 추가
  // 실무에서는 한 TX에 약 5~8개 지갑 sweep 가능

  for (const deposit of deposits) {
    const sourceATA = await getAssociatedTokenAddress(
      mintAddress,
      deposit.wallet
    );

    tx.add(
      createTransferInstruction(
        sourceATA,
        hotWalletATA,
        hotWallet.publicKey,  // authority
        deposit.amount
      )
    );
  }

  return await sendAndConfirmTransaction(connection, tx, [hotWallet]);
}
```

**TX 크기 제한 주의:** 한 트랜잭션에 너무 많은 instruction을 넣으면 1,232 byte 제한에 걸린다.
실무에서는 5~8개 단위로 배치를 나누거나, Address Lookup Table을 사용해야 한다.

## 출금 흐름

```typescript
async function withdraw(
  connection: Connection,
  hotWallet: Keypair,
  recipientPubkey: PublicKey,
  mintAddress: PublicKey,
  amount: bigint
) {
  const hotWalletATA = await getAssociatedTokenAddress(
    mintAddress,
    hotWallet.publicKey
  );
  const recipientATA = await getAssociatedTokenAddress(
    mintAddress,
    recipientPubkey
  );

  const tx = new Transaction();
  tx.feePayer = hotWallet.publicKey;

  // 수신자 ATA가 없으면 생성 (비용: ~0.00204 SOL, 핫월렛 부담)
  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(
      hotWallet.publicKey,
      recipientATA,
      recipientPubkey,
      mintAddress
    )
  );

  tx.add(
    createTransferInstruction(
      hotWalletATA,
      recipientATA,
      hotWallet.publicKey,    // authority
      amount
    )
  );

  return await sendAndConfirmTransaction(connection, tx, [hotWallet]);
}
```

## Gas Supply 개념의 소멸

### EVM에서 필요했던 Gas Supply 모듈

```
[EVM Gas Supply Pipeline]
                                    ┌─────────────────┐
                                    │  Gas Monitor    │
                                    │  - 지갑별 잔액 체크│
                                    │  - 임계치 비교    │
                                    │  - 알림 발송      │
                                    └────────┬────────┘
                                             │
                                    ┌────────▼────────┐
                                    │  Gas Supplier   │
                                    │  - ETH 전송 TX  │
                                    │  - nonce 관리   │
                                    │  - 실패 재시도   │
                                    └────────┬────────┘
                                             │
                              ┌──────────────┼──────────────┐
                              ▼              ▼              ▼
                         Deposit A      Deposit B      Deposit C
                         ETH: 0.01     ETH: 0.005     ETH: 0.02
```

이 파이프라인에서 발생하는 문제들:
- Gas 가격 급등 시 공급량 재계산
- 공급 TX 자체의 가스비
- Nonce 충돌 (동시 공급 시)
- 공급 TX 실패 시 collect 불가
- 수백~수천 개 지갑의 잔액 모니터링 비용

### Solana에서의 구조

```
[Solana Fee Payer 구조]

┌─────────────────┐
│  Hot Wallet     │
│  SOL Monitor    │  ← 단 하나의 모니터링 포인트
│  (단일 잔액 체크) │
└────────┬────────┘
         │
         │  fee payer로 모든 TX에 포함
         │
    ┌────┼────────────────────┐
    ▼    ▼                    ▼
Deposit A  Deposit B     Deposit C
SOL: 0     SOL: 0        SOL: 0      ← 가스비 공급 불필요
USDC: 100  USDC: 50      USDC: 200
```

**제거되는 컴포넌트:**
- Gas Monitor (지갑별 모니터링)
- Gas Supplier (ETH 공급 TX 생성)
- Gas Nonce Manager (공급 TX nonce 관리)
- Gas Threshold Config (지갑별 임계치 설정)

**추가되는 컴포넌트:**
- Hot Wallet SOL Balance Monitor (단일 모니터링 포인트)
- SOL Refill Alert (임계치 알림)

## 비용 구조 비교

### EVM (예: Ethereum L1, 1,000개 deposit 지갑 운영)

| 항목 | 비용 (월간 추정) |
|------|----------------|
| 지갑별 ETH 최소 잔액 유지 (0.01 ETH x 1,000) | ~10 ETH |
| Gas 공급 TX 가스비 (월 500건 x 0.001 ETH) | ~0.5 ETH |
| Relay 서버 운영 | 인프라 비용 |
| Forwarder 컨트랙트 감사 비용 | 일회성 |

### Solana (동일 1,000개 deposit 지갑 운영)

| 항목 | 비용 (월간 추정) |
|------|----------------|
| 핫월렛 SOL 잔액 | ~1 SOL (수만 건 TX 가능) |
| ATA 생성 비용 (토큰별, 1회성) | ~2 SOL (1,000개 x 0.00204) |
| 릴레이 서버 | 없음 |
| 추가 컨트랙트 | 없음 |

## 모니터링 항목

### 핫월렛 SOL 잔액 모니터링

```typescript
// 프로덕션 모니터링 예시
async function monitorHotWalletBalance(
  connection: Connection,
  hotWalletPubkey: PublicKey,
  thresholds: {
    warning: number;   // SOL (예: 1.0)
    critical: number;  // SOL (예: 0.1)
  }
) {
  const balance = await connection.getBalance(hotWalletPubkey);
  const solBalance = balance / 1e9;

  if (solBalance < thresholds.critical) {
    // CRITICAL: 즉시 SOL 충전 필요
    // → PagerDuty 알림
    return { level: 'critical', balance: solBalance };
  } else if (solBalance < thresholds.warning) {
    // WARNING: SOL 충전 예약
    // → Slack 알림
    return { level: 'warning', balance: solBalance };
  }

  return { level: 'ok', balance: solBalance };
}
```

### 핫월렛 잔액 소모 예측

```
기본 수수료: 5,000 lamports/TX = 0.000005 SOL
Priority fee (보수적): 50,000 lamports/TX = 0.00005 SOL
ATA 생성 비용: 2,040,000 lamports = 0.00204 SOL

일일 TX 1,000건 기준:
- 기본 비용: 1,000 * 0.000005 = 0.005 SOL/일
- Priority 포함: 1,000 * 0.00005 = 0.05 SOL/일
- ATA 생성 100건 포함: 100 * 0.00204 = 0.204 SOL/일

→ 1 SOL로 약 4~20일 운영 가능 (ATA 생성 빈도에 따라)
→ 10 SOL이면 40~200일 운영 가능
```

## 참고 링크

- [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange)
- [SPL Token Docs](https://spl.solana.com/token)
