# 6.1 Solana의 Fee Payer 모델

상위 섹션: [6. Q4: Fee Delegation](../README.md)

## 핵심 원리: 첫 번째 서명자 = Fee Payer

Solana 트랜잭션에서 **`accountKeys` 배열의 첫 번째 계정**이 자동으로 fee payer가 된다.
이 계정은 반드시 서명자(signer)여야 하며, 트랜잭션 수수료를 지불할 SOL 잔액을 보유해야 한다.

```
Transaction {
  signatures: [fee_payer_sig, user_sig, ...]   // 서명 배열
  message: {
    header: {
      numRequiredSignatures: 2,                // 필요한 서명 수
      numReadonlySignedAccounts: 0,
      numReadonlyUnsignedAccounts: 2
    },
    accountKeys: [
      fee_payer,        // index 0 = 항상 fee payer
      user_wallet,      // index 1 = token owner (서명자)
      token_program,    // index 2 = readonly
      system_program    // index 3 = readonly
    ],
    recentBlockhash: "...",
    instructions: [...]
  }
}
```

## Transaction 클래스의 feePayer 필드

`@solana/web3.js`의 `Transaction` 클래스에는 명시적인 `feePayer` 필드가 있다:

```typescript
import {
  Transaction,
  SystemProgram,
  Keypair,
  Connection,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';

// 두 개의 키페어: fee payer와 실제 작업 수행자
const feePayer = Keypair.generate();   // 수수료 대납자
const user = Keypair.generate();       // 실제 유저 (토큰 소유자 등)

const transaction = new Transaction();

// feePayer를 명시적으로 설정
transaction.feePayer = feePayer.publicKey;

// instruction 추가 (예: SOL 전송)
transaction.add(
  SystemProgram.transfer({
    fromPubkey: user.publicKey,       // 보내는 사람 = user
    toPubkey: recipient.publicKey,
    lamports: 0.1 * LAMPORTS_PER_SOL,
  })
);

// recentBlockhash 설정
transaction.recentBlockhash = (
  await connection.getLatestBlockhash()
).blockhash;

// 두 명이 서명: fee payer + user
// fee payer가 첫 번째로 서명해야 함
await sendAndConfirmTransaction(
  connection,
  transaction,
  [feePayer, user]  // signers 배열: 첫 번째 = fee payer
);
```

**핵심:** `feePayer`를 설정하면 SDK가 자동으로 해당 계정을 `accountKeys[0]`에 배치한다.
서명 배열에서도 fee payer의 서명이 첫 번째에 위치한다.

## 다중 서명자 구조

Solana 트랜잭션은 여러 서명자를 가질 수 있다. 각 서명자는 자신의 역할에 해당하는 부분만 서명한다:

```
역할 분리 예시:

[Fee Payer]  ─── 수수료 지불만 담당, user의 private key 불필요
     │
[User/Owner] ─── 토큰 전송 권한 (authority)
     │
[Instruction] ── "user의 ATA에서 recipient의 ATA로 100 USDC 전송"
```

```typescript
// SPL Token 전송에서 fee payer와 owner가 다른 경우
import {
  createTransferInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token';

const hotWallet = Keypair.fromSecretKey(/* ... */);  // fee payer
const userKeypair = Keypair.fromSecretKey(/* ... */); // token owner

const userATA = await getAssociatedTokenAddress(
  mintAddress,
  userKeypair.publicKey
);
const recipientATA = await getAssociatedTokenAddress(
  mintAddress,
  recipientPubkey
);

const tx = new Transaction();
tx.feePayer = hotWallet.publicKey;

tx.add(
  createTransferInstruction(
    userATA,                  // source (user의 토큰 계정)
    recipientATA,             // destination
    userKeypair.publicKey,    // owner/authority (user가 서명)
    1_000_000                 // amount (USDC 6 decimals = 1 USDC)
  )
);

// 두 명이 서명
// hotWallet: fee 지불
// userKeypair: 토큰 전송 권한
await sendAndConfirmTransaction(connection, tx, [hotWallet, userKeypair]);
```

**중요:** fee payer는 user의 private key를 알 필요가 없다.
각자 자신의 키로 트랜잭션에 서명하면 된다.

## Fee Payer 흐름도 (비커스터디얼)

비커스터디얼 환경에서 릴레이어를 통한 fee delegation 흐름:

```
┌──────────┐     1. TX 구성 (서명 없이)      ┌──────────────┐
│          │ ──────────────────────────────→ │              │
│   User   │                                │   Relayer    │
│          │ ←────────────────────────────── │ (Fee Payer)  │
│          │     4. 완료 알림                │              │
└──────────┘                                └──────────────┘
     │                                            │
     │ 2. User가 자신의 부분 서명                  │ 3. Relayer가 fee payer
     │    (partial sign)                          │    서명 추가 + 브로드캐스트
     │                                            │
     ▼                                            ▼
┌─────────────────────────────────────────────────────────┐
│                    Solana Network                        │
│  - accountKeys[0] = Relayer (fee payer)                 │
│  - accountKeys[1] = User (authority)                    │
│  - 수수료: Relayer의 SOL에서 차감                        │
│  - 실제 작업: User의 권한으로 실행                        │
└─────────────────────────────────────────────────────────┘
```

**커스터디얼 환경(Dagaon Core)에서는 더 단순하다:**
핫월렛이 fee payer이자 모든 deposit 지갑의 authority이므로, 단일 서명자로 처리 가능하다.

```
┌────────────┐     TX 구성 + 서명 + 브로드캐스트     ┌─────────────┐
│            │ ────────────────────────────────────→ │             │
│  Hot Wallet │                                      │   Solana    │
│ (fee payer  │                                      │   Network   │
│  + owner)   │ ←──────────────────────────────────── │             │
│            │           확인 결과                    │             │
└────────────┘                                       └─────────────┘
```

## Account Ordering 규칙 상세

트랜잭션 메시지의 `accountKeys` 배열은 엄격한 정렬 규칙을 따른다:

```
accountKeys 정렬 순서:

1. Writable + Signer    (fee payer가 여기 첫 번째)
2. Readonly + Signer
3. Writable + Non-signer
4. Readonly + Non-signer
```

```typescript
// header 필드가 이 정렬을 인코딩한다
header: {
  numRequiredSignatures: 2,          // accountKeys[0..1]이 서명자
  numReadonlySignedAccounts: 0,      // 서명자 중 readonly 없음
  numReadonlyUnsignedAccounts: 2     // 마지막 2개가 readonly non-signer
}

// 결과적으로:
accountKeys: [
  hotWallet,      // writable + signer (fee payer)
  userWallet,     // writable + signer (authority)
  tokenProgram,   // readonly + non-signer
  systemProgram   // readonly + non-signer
]
```

SDK가 `feePayer` 설정과 instruction의 `AccountMeta`를 기반으로 자동 정렬하지만,
low-level에서 직접 메시지를 구성할 때는 이 순서를 반드시 지켜야 한다.

## 검증 포인트

1. **fee payer가 항상 accountKeys[0]인지 확인**: `transaction.serialize()`로 직렬화 후 바이트 검사
2. **fee payer SOL 부족 시 에러**: `InsufficientFundsForFee` 에러 코드 확인
3. **fee payer 서명 누락 시 에러**: `SignatureVerificationFailed` 확인
4. **다중 서명자 순서**: `sendAndConfirmTransaction`의 signers 배열 첫 번째가 fee payer와 일치하는지 확인

## 참고 링크

- [Solana Transaction Anatomy](https://solana.com/docs/core/transactions)
- [Solana Web3.js Transaction Class](https://solana-labs.github.io/solana-web3.js/v1.x/classes/Transaction.html)
