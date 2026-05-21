# 5.2 Durable Nonce 상세

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)

## Nonce 계정 구조

Durable Nonce 계정은 **System Program이 소유하는 특수 계정**이다. 일반 SOL 계정과 달리, 내부에 nonce 상태 데이터를 저장한다.

### 온체인 데이터 레이아웃 (80 바이트)

```
오프셋     크기        필드명              설명
─────────────────────────────────────────────────────────────
0x00       4 bytes     version            Nonce 버전 (현재: 1)
0x04       4 bytes     state              NonceState 열거형
0x08       32 bytes    authority          Nonce authority 공개키
0x28       32 bytes    storedNonce        저장된 nonce 값 (blockhash 형태)
─────────────────────────────────────────────────────────────
합계: 80 bytes
```

Solana의 `@solana/web3.js` SDK에서는 `NonceAccount` 클래스로 이 데이터를 디코딩한다:

```typescript
import { NonceAccount } from '@solana/web3.js';

const accountInfo = await connection.getAccountInfo(nonceAccountPubkey);
const nonceAccount = NonceAccount.fromAccountData(accountInfo.data);

console.log(nonceAccount.authorizedPubkey.toBase58()); // authority
console.log(nonceAccount.nonce);                       // storedNonce (base58)
```

### NonceState: 초기화 상태

| 상태 | 값 | 설명 |
|------|-----|------|
| `Uninitialized` | 0 | 계정이 생성되었지만 InitializeNonceAccount가 실행되지 않음 |
| `Initialized` | 1 | 정상 상태. storedNonce와 authority가 설정됨 |

`Initialized` 상태의 계정만 durable nonce TX에 사용할 수 있다.

## Nonce 계정 생성

Nonce 계정 생성은 **2개의 instruction을 하나의 TX에 포함**하여 원자적으로 수행한다:

### Step 1: CreateAccount

새 계정을 만들고, rent-exempt에 필요한 SOL을 예치하며, System Program에 소유권을 할당한다.

```typescript
SystemProgram.createAccount({
  fromPubkey: payer.publicKey,          // 비용 지불자
  newAccountPubkey: nonceKeypair.publicKey, // 새 nonce 계정
  lamports: rentExemptBalance,          // ~0.00144768 SOL (rent-exempt)
  space: NONCE_ACCOUNT_LENGTH,          // 80 bytes
  programId: SystemProgram.programId,   // System Program 소유
})
```

### Step 2: InitializeNonceAccount

계정을 nonce 계정으로 초기화하고, authority를 지정한다.

```typescript
SystemProgram.nonceInitialize({
  noncePubkey: nonceKeypair.publicKey,  // 초기화할 계정
  authorizedPubkey: authority.publicKey, // nonce authority (보통 hot wallet)
})
```

### 전체 생성 TX

```typescript
const tx = new Transaction().add(
  // Instruction 0: 계정 생성
  SystemProgram.createAccount({
    fromPubkey: payer.publicKey,
    newAccountPubkey: nonceKeypair.publicKey,
    lamports: await connection.getMinimumBalanceForRentExemption(NONCE_ACCOUNT_LENGTH),
    space: NONCE_ACCOUNT_LENGTH,
    programId: SystemProgram.programId,
  }),
  // Instruction 1: nonce 초기화
  SystemProgram.nonceInitialize({
    noncePubkey: nonceKeypair.publicKey,
    authorizedPubkey: hotWallet.publicKey,
  })
);
```

비용:
- rent-exempt 예치금: **~0.00144768 SOL** (약 $0.22 @SOL=$150)
- 이 예치금은 nonce 계정을 닫을 때(close/withdraw) **전액 반환**된다
- 트랜잭션 수수료: ~0.000005 SOL (별도)

## AdvanceNonceAccount Instruction

**Durable Nonce TX에서 가장 중요한 규칙: AdvanceNonceAccount는 반드시 첫 번째 instruction이어야 한다.**

```typescript
SystemProgram.nonceAdvance({
  noncePubkey: nonceAccount.publicKey,  // nonce 계정
  authorizedPubkey: authority.publicKey, // authority (서명 필요)
})
```

### AdvanceNonce가 수행하는 것

1. `storedNonce`를 현재 `recentBlockhash`로 갱신한다
2. 이전 `storedNonce` 값은 무효화된다
3. 이 instruction이 성공해야 나머지 instruction들이 실행된다

### TX에서의 배치

```
Transaction {
  recentBlockhash: nonceAccount.storedNonce,  // ← 일반 blockhash 대신
  feePayer: hotWallet,
  instructions: [
    AdvanceNonceAccount(nonceAccount, authority),  // ← 반드시 [0]
    Transfer(from, to, amount),                    // ← 실제 작업 [1]
    // ... 추가 instruction 가능
  ],
  signatures: [
    hotWalletSignature,   // feePayer이자 authority
  ]
}
```

### 왜 첫 번째여야 하는가?

Solana 런타임은 TX를 검증할 때 다음을 확인한다:

1. `recentBlockhash`가 최근 150개 해시에 있는지 확인
2. **없으면**, 첫 번째 instruction이 `AdvanceNonceAccount`인지 확인
3. 첫 번째 instruction이 `AdvanceNonceAccount`이고, `recentBlockhash`가 해당 nonce 계정의 `storedNonce`와 일치하면 TX를 유효한 것으로 처리
4. 첫 번째가 아닌 다른 위치에 있으면 이 검증을 수행하지 않는다

```
런타임 검증 흐름:
                                    
recentBlockhash ∈ recent_hashes?
         │
    ┌────┴────┐
    YES       NO
    │         │
    v         v
  일반 TX    instructions[0] == AdvanceNonceAccount?
  처리              │
              ┌─────┴─────┐
              YES         NO
              │           │
              v           v
        storedNonce ==    TX 거부
        recentBlockhash?  (BlockhashNotFound)
              │
         ┌────┴────┐
         YES       NO
         │         │
         v         v
     Durable      TX 거부
     Nonce TX     (Nonce 불일치)
     처리
```

## storedNonce 값

`storedNonce`는 **32바이트 값으로, blockhash와 동일한 형태(base58 인코딩)**이다.

```
일반 blockhash:  "EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N"
storedNonce:     "2Dz8THCMeRVmrP5MqLv4BHCbZB9jkRFiUarBQPhYTCgC"  ← 형태가 동일
```

TX의 `recentBlockhash` 필드에 storedNonce를 넣어도, 필드 형식 자체는 동일하기 때문에 SDK에서 별도 처리가 필요 없다. 다만 **의미**가 다르다:

| 속성 | 일반 blockhash | storedNonce |
|------|---------------|-------------|
| 생성 주체 | 네트워크 (매 슬롯마다 자동) | AdvanceNonce instruction |
| 유효 기간 | ~150 슬롯 (60-90초) | AdvanceNonce 실행 전까지 무기한 |
| 변경 조건 | 시간 경과 (자동 밀려남) | 명시적 instruction 실행 |
| 중복 방지 | 같은 blockhash로 같은 TX는 1번만 | 같은 storedNonce로 같은 TX는 1번만 |

## Nonce Authority

Nonce authority는 nonce 계정을 **제어할 수 있는 권한을 가진 공개키**이다.

### Authority가 할 수 있는 것

| 작업 | instruction | 설명 |
|------|------------|------|
| Nonce 전진 | `NonceAdvance` | storedNonce를 새 값으로 변경 |
| Authority 변경 | `NonceAuthorize` | 다른 키로 authority를 이전 |
| 잔액 인출 | `NonceWithdraw` | nonce 계정의 SOL을 인출 (계정 닫기 포함) |

### Dagaon Core에서의 Authority 설계

```
권장 구조:

hot_wallet_keypair = Dagaon Core의 핫월렛
nonce_account_1.authority = hot_wallet_keypair.publicKey
nonce_account_2.authority = hot_wallet_keypair.publicKey
...
nonce_account_N.authority = hot_wallet_keypair.publicKey

→ 핫월렛이 모든 nonce 계정의 authority가 되므로:
  - 출금 TX에서 feePayer와 authority가 동일 = 서명 1개로 충분
  - 취소(nonce advance)도 핫월렛 서명 1개로 가능
  - 관리 단순화
```

## TX 취소 (Nonce Advance)

Durable Nonce의 결정적 취소는 **이미 서명된 TX를 무효화**하는 메커니즘이다.

### 취소 방법

`AdvanceNonceAccount` instruction만 포함한 TX를 전송한다:

```typescript
// 취소 TX: AdvanceNonce만 실행
const cancelTx = new Transaction();
cancelTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
cancelTx.feePayer = authority.publicKey;
cancelTx.add(
  SystemProgram.nonceAdvance({
    noncePubkey: nonceAccount.publicKey,
    authorizedPubkey: authority.publicKey,
  })
);
```

이 TX가 확인되면:
1. `storedNonce`가 새로운 값으로 변경된다
2. 이전 `storedNonce`를 `recentBlockhash`로 사용한 모든 미결 TX가 **즉시 무효화**된다
3. nonce 계정은 새 `storedNonce`와 함께 다시 사용할 수 있다

### 취소가 필요한 시나리오

```
시나리오 1: 잘못된 금액으로 서명된 TX
  → nonce advance로 해당 TX 무효화 → 올바른 금액으로 새 TX 생성

시나리오 2: 오랫동안 확인되지 않는 TX (priority fee 부족)
  → nonce advance로 기존 TX 무효화 → 더 높은 priority fee로 새 TX 생성

시나리오 3: 출금 요청이 취소됨
  → nonce advance로 서명된 TX 무효화 → nonce 계정을 FREE로 반환
```

### EVM 취소와의 비교

```
EVM:    같은 nonce, 더 높은 gas, 자기 자신에게 0 ETH 전송
        → "replacement" TX가 원본을 밀어냄
        → gas 비용 발생

Solana: AdvanceNonce만 실행
        → storedNonce 변경으로 원본 TX 자동 무효화
        → TX 수수료(~0.000005 SOL)만 발생
        → 더 직관적이고 저렴
```

## Nonce 계정 라이프사이클

```
                                ┌──────────────────┐
                                │  CreateAccount   │
                                │  + Initialize    │
                                └────────┬─────────┘
                                         │
                                         v
                              ┌──────────────────────┐
          ┌──────────────────>│    INITIALIZED       │<──────────────────┐
          │                   │  storedNonce = X     │                   │
          │                   │  authority = wallet  │                   │
          │                   └──────────┬───────────┘                   │
          │                              │                               │
          │                    출금 요청 발생                              │
          │                              │                               │
          │                              v                               │
          │                   ┌──────────────────────┐                   │
          │                   │  TX 빌드 + 서명       │                   │
          │                   │  recentBlockhash = X │                   │
          │                   └──────────┬───────────┘                   │
          │                              │                               │
          │                              v                               │
          │                   ┌──────────────────────┐                   │
          │                   │  TX 전송 + 재전송     │                   │
          │                   │  (2초 간격 루프)       │                   │
          │                   └──────────┬───────────┘                   │
          │                              │                               │
          │               ┌──────────────┼──────────────┐               │
          │               │              │              │               │
          │               v              v              v               │
          │         ┌──────────┐  ┌──────────┐  ┌──────────────┐       │
          │         │ TX 확인   │  │ TX 드롭   │  │ 취소 필요     │       │
          │         │ (성공)    │  │ (재전송)   │  │ (nonce adv.) │       │
          │         └─────┬────┘  └─────┬────┘  └──────┬───────┘       │
          │               │             │              │               │
          │               v             │              v               │
          │     storedNonce 변경됨       │    AdvanceNonce 전송          │
          │     (= X -> Y, 자동)        │    storedNonce: X -> Y        │
          │               │             │              │               │
          │               v             │              v               │
          └───── nonce 계정 재사용 ◄─────┘──── nonce 계정 재사용 ────────┘
                 가능 (새 storedNonce Y)
```

## 참고 자료

- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- NonceAccount 소스코드: https://github.com/solana-labs/solana-web3.js/blob/master/packages/library-legacy/src/nonce-account.ts
- System Program Nonce Instructions: https://github.com/solana-labs/solana/blob/master/sdk/program/src/system_instruction.rs
