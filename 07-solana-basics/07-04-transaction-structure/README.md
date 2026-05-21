# 7.4 Transaction 구조

상위 섹션: [7. Solana 기초 개념 상세](../README.md)

## 개요

Solana 트랜잭션은 **하나 이상의 instruction을 원자적으로 실행**하는 단위이다.
EVM의 트랜잭션이 하나의 함수 호출에 해당한다면,
Solana 트랜잭션은 여러 함수 호출을 하나의 원자적 배치로 묶을 수 있다.

---

## Legacy Transaction 구조

```
Transaction {
  signatures: [Signature]          // Ed25519 서명 배열 (각 64 bytes)
  message: Message {
    header: MessageHeader {
      numRequiredSignatures: u8        // 필요한 서명 수
      numReadonlySignedAccounts: u8    // 서명자 중 readonly 수
      numReadonlyUnsignedAccounts: u8  // 비서명자 중 readonly 수
    }
    accountKeys: [Pubkey]              // 참여 계정 목록 (각 32 bytes)
    recentBlockhash: Hash              // 최근 블록해시 (32 bytes)
    instructions: [CompiledInstruction] {
      programIdIndex: u8               // accountKeys 내 프로그램 인덱스
      accounts: [u8]                   // accountKeys 내 계정 인덱스 배열
      data: [u8]                       // 프로그램별 인코딩된 데이터
    }
  }
}
```

### 실제 바이트 레이아웃

```
┌─────────────────────────────────────────────────────────┐
│ Compact-u16: 서명 수 (1~2 bytes)                        │
│ [Signature × N] (N × 64 bytes)                          │
├─────────────────────────────────────────────────────────┤
│ Message:                                                │
│   numRequiredSignatures (1 byte)                        │
│   numReadonlySignedAccounts (1 byte)                    │
│   numReadonlyUnsignedAccounts (1 byte)                  │
│   Compact-u16: accountKeys 수                           │
│   [Pubkey × M] (M × 32 bytes)                          │
│   recentBlockhash (32 bytes)                            │
│   Compact-u16: instructions 수                          │
│   [CompiledInstruction × K]                             │
│     programIdIndex (1 byte)                             │
│     Compact-u16: accounts 수                            │
│     [accountIndex × L] (L × 1 byte)                    │
│     Compact-u16: data 길이                               │
│     [data bytes]                                        │
└─────────────────────────────────────────────────────────┘
```

---

## Message Header 상세

Header의 3개 필드가 accountKeys 배열의 역할 구분을 인코딩한다:

```
accountKeys 배열:
  [0 .. numRequiredSignatures-1]              = 서명자 (signers)
  [0 .. numRequiredSignatures-numReadonlySignedAccounts-1]
                                              = writable signers
  [numRequiredSignatures-numReadonlySignedAccounts .. numRequiredSignatures-1]
                                              = readonly signers
  [numRequiredSignatures .. len-numReadonlyUnsignedAccounts-1]
                                              = writable non-signers
  [len-numReadonlyUnsignedAccounts .. len-1]  = readonly non-signers
```

예시:

```
header: {
  numRequiredSignatures: 2,
  numReadonlySignedAccounts: 0,
  numReadonlyUnsignedAccounts: 3
}
accountKeys: [
  feePayer,        // index 0: writable signer (fee payer)
  tokenOwner,      // index 1: writable signer
  sourceATA,       // index 2: writable non-signer
  destATA,         // index 3: writable non-signer
  tokenProgram,    // index 4: readonly non-signer  ┐
  ataProgramId,    // index 5: readonly non-signer  ├ numReadonlyUnsignedAccounts = 3
  systemProgram    // index 6: readonly non-signer  ┘
]
```

---

## Account Ordering 규칙

accountKeys 배열은 엄격한 정렬 규칙을 따른다:

```
정렬 우선순위:

1. Writable + Signer     (fee payer가 항상 첫 번째)
2. Readonly + Signer
3. Writable + Non-signer
4. Readonly + Non-signer

→ SDK가 자동 정렬하지만, 직렬화/역직렬화 시 이 순서를 알아야 함
```

---

## Instruction 형식

각 instruction은 "어떤 프로그램이, 어떤 계정으로, 무슨 작업을 수행할지"를 정의한다:

```typescript
// High-level (SDK에서 사용)
interface TransactionInstruction {
  programId: PublicKey;        // 실행할 프로그램
  keys: AccountMeta[];         // 참여 계정 목록
  data: Buffer;                // 프로그램별 인코딩된 데이터
}

interface AccountMeta {
  pubkey: PublicKey;
  isSigner: boolean;           // 이 계정이 서명자인지
  isWritable: boolean;         // 이 계정에 쓰기가 필요한지
}

// Low-level (직렬화 후)
interface CompiledInstruction {
  programIdIndex: number;      // accountKeys 배열의 인덱스
  accounts: number[];          // accountKeys 배열의 인덱스 배열
  data: Buffer;                // 원본 data 그대로
}
```

### Instruction → CompiledInstruction 변환

```
Transaction에 instruction을 추가하면:
1. 모든 instruction의 계정을 수집
2. 중복 제거 + 정렬 → accountKeys 배열 생성
3. 각 instruction의 programId와 accounts를 인덱스로 변환
```

```typescript
// High-level instruction 예시 (SPL Token Transfer)
const transferIx: TransactionInstruction = {
  programId: TOKEN_PROGRAM_ID,          // Token Program
  keys: [
    { pubkey: sourceATA, isSigner: false, isWritable: true },
    { pubkey: destATA, isSigner: false, isWritable: true },
    { pubkey: ownerPubkey, isSigner: true, isWritable: false },
  ],
  data: Buffer.from([3, ...amountBytes]),  // 3 = Transfer instruction
};

// 직렬화 후 CompiledInstruction:
// {
//   programIdIndex: 4,     // accountKeys[4] = TOKEN_PROGRAM_ID
//   accounts: [2, 3, 1],   // accountKeys의 인덱스
//   data: [3, ...]
// }
```

---

## 1,232 Byte 제한

### 제한의 근거

```
IPv6 MTU (Maximum Transmission Unit) = 1,280 bytes
IPv6 헤더 오버헤드 = 40 bytes
UDP 헤더 = 8 bytes

남은 페이로드 = 1,280 - 40 - 8 = 1,232 bytes

→ Solana 트랜잭션은 단일 UDP 패킷에 맞아야 함
→ 네트워크 계층에서 분할/재조립 없이 전파 가능
→ 빠른 전파 속도의 핵심
```

### 제한이 미치는 영향

```
일반적인 트랜잭션 크기 구성:

서명 (1개): 64 bytes
Header: 3 bytes
accountKeys (7개): 7 × 32 = 224 bytes
recentBlockhash: 32 bytes
Instructions 오버헤드: ~50 bytes

기본 오버헤드: ~373 bytes
남는 공간: ~859 bytes

→ 추가 계정 1개당 32 bytes 소비
→ 약 25~30개 계정까지 참조 가능 (Legacy TX)
→ 복잡한 DeFi 작업은 이 제한에 자주 부딪힘
```

### 실무 영향 (Dagaon Core)

```
배치 collect(sweep) 시:
  - 각 deposit 지갑 sweep에 필요한 계정: ~4개 (source ATA, dest ATA, owner, mint)
  - 공통 계정: ~3개 (fee payer, token program, system program)
  - 서명: 1개 (fee payer = owner)

  계산:
  기본 오버헤드: ~373 bytes
  공통 계정: 3 × 32 = 96 bytes
  sweep당 추가 계정: ~2개 × 32 = 64 bytes (중복 제거 후)
  남는 공간: 1,232 - 373 - 96 = 763 bytes
  최대 sweep 수: 763 / 64 ≈ 11개

  → 한 TX에 약 8~11개 deposit 지갑 sweep 가능
  → 그 이상은 ALT(Address Lookup Table) 사용 또는 TX 분할 필요
```

---

## Versioned Transaction (v0)

### Legacy vs v0 차이

```
Legacy Transaction:
  - 모든 계정이 accountKeys에 직접 포함 (32 bytes each)
  - 계정 수 제한이 엄격함

Versioned Transaction v0:
  - Address Lookup Tables (ALT) 참조 가능
  - ALT에 등록된 계정은 1 byte 인덱스로 참조
  - 훨씬 많은 계정을 참조 가능
```

```
Versioned Transaction v0 구조:

VersionedTransaction {
  signatures: [Signature]
  message: MessageV0 {
    header: MessageHeader          // Legacy와 동일
    staticAccountKeys: [Pubkey]    // 직접 포함된 계정 (Legacy의 accountKeys)
    recentBlockhash: Hash
    instructions: [CompiledInstruction]  // Legacy와 동일
    addressTableLookups: [           // ← 새로운 필드
      {
        accountKey: Pubkey           // ALT 계정 주소
        writableIndexes: [u8]        // ALT 내에서 writable 계정 인덱스
        readonlyIndexes: [u8]        // ALT 내에서 readonly 계정 인덱스
      }
    ]
  }
}
```

### Address Lookup Table (ALT)

```typescript
import {
  AddressLookupTableProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';

// 1. ALT 생성
const [createIx, lookupTableAddress] =
  AddressLookupTableProgram.createLookupTable({
    authority: payer.publicKey,
    payer: payer.publicKey,
    recentSlot: await connection.getSlot(),
  });

// 2. ALT에 주소 추가
const extendIx = AddressLookupTableProgram.extendLookupTable({
  payer: payer.publicKey,
  authority: payer.publicKey,
  lookupTable: lookupTableAddress,
  addresses: [
    depositATA1, depositATA2, depositATA3,
    // ... 자주 사용하는 계정 주소들
  ],
});

// 3. ALT를 사용하여 Versioned Transaction 생성
const lookupTableAccount = (
  await connection.getAddressLookupTable(lookupTableAddress)
).value;

const messageV0 = new TransactionMessage({
  payerKey: payer.publicKey,
  recentBlockhash: (await connection.getLatestBlockhash()).blockhash,
  instructions: [/* ... 다수의 instruction */],
}).compileToV0Message([lookupTableAccount]);  // ALT 참조

const versionedTx = new VersionedTransaction(messageV0);
versionedTx.sign([payer]);
```

### ALT 사용 시 크기 절약

```
Legacy: 30개 계정 = 30 × 32 = 960 bytes (거의 한계)

v0 + ALT: 30개 중 25개가 ALT 등록
  staticAccountKeys: 5개 = 5 × 32 = 160 bytes
  ALT 참조: 25개 = 25 × 1 = 25 bytes (인덱스만)
  ALT 메타데이터: ~35 bytes
  합계: ~220 bytes (760 bytes 절약)

→ 이론적으로 256개 계정까지 참조 가능
```

### RPC 설정

v0 트랜잭션을 처리하려면 RPC 호출 시 버전을 명시해야 한다:

```typescript
// v0 트랜잭션 조회
const tx = await connection.getTransaction(signature, {
  maxSupportedTransactionVersion: 0,  // 필수
});

// v0 지원 없이 조회하면 Legacy TX만 반환되고 v0은 에러
```

---

## recentBlockhash와 트랜잭션 수명

```
트랜잭션 생성 시:
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

유효 기간:
  - recentBlockhash 발행 후 ~150 슬롯 (~60~90초)
  - 유효 기간 초과 시 트랜잭션 거부 (BlockhashNotFound)

EVM과의 차이:
  EVM: nonce 기반 → nonce가 유효한 한 언제든 제출 가능
  Solana: blockhash 기반 → 시간 제한 있음, 자동 만료

대안: Durable Nonce
  - 특별한 nonce 계정을 사용하여 시간 제한 제거
  - 오프라인 서명이 필요한 경우에 사용
  - AdvanceNonceAccount instruction을 TX 첫 번째에 추가
```

---

## Multiple Instructions = Atomic Batch

하나의 트랜잭션에 여러 instruction을 포함하면 **전부 성공하거나 전부 실패**한다:

```typescript
const tx = new Transaction();

// Instruction 1: ATA 생성
tx.add(createAssociatedTokenAccountIdempotentInstruction(...));

// Instruction 2: 토큰 전송
tx.add(createTransferInstruction(...));

// Instruction 3: 메모 추가
tx.add(createMemoInstruction('transfer-001'));

// 세 instruction이 원자적으로 실행됨
// Instruction 2가 실패하면 Instruction 1의 효과도 롤백됨
await sendAndConfirmTransaction(connection, tx, [payer]);
```

### EVM과의 비교

```
EVM:
  - 트랜잭션 1개 = 컨트랙트 함수 1개 호출
  - 여러 작업을 원자적으로 묶으려면 → multicall 컨트랙트 또는 batch 컨트랙트 필요
  - 또는 컨트랙트 내부에서 여러 호출을 체이닝

Solana:
  - 트랜잭션 1개 = instruction N개 (N >= 1)
  - 별도 컨트랙트 없이 여러 프로그램 호출을 원자적으로 묶을 수 있음
  - 예: "ATA 생성 + 토큰 전송 + 메모 기록"을 하나의 TX로
```

---

## Compact-u16 인코딩

Solana 직렬화에서 배열 길이나 작은 숫자에 사용되는 가변 길이 인코딩:

```
값 범위          | 바이트 수 | 인코딩
0 ~ 127         | 1 byte   | 값 그대로
128 ~ 16,383    | 2 bytes  | 하위 7비트 + 0x80, 상위 비트
16,384 ~ 65,535 | 3 bytes  | 7비트씩 분할

예시:
  1    → [0x01]           (1 byte)
  128  → [0x80, 0x01]     (2 bytes)
  1000 → [0xE8, 0x07]     (2 bytes)
```

---

## 트랜잭션 크기 계산 요약

```
최소 트랜잭션 (SOL 전송):
  Compact-u16 서명 수:     1 byte
  서명 1개:               64 bytes
  Header:                  3 bytes
  Compact-u16 계정 수:     1 byte
  계정 3개:               96 bytes (from, to, System Program)
  recentBlockhash:        32 bytes
  Compact-u16 instruction 수: 1 byte
  Instruction:            ~15 bytes
  ─────────────────────────────
  합계:                   ~213 bytes (1,232 제한의 ~17%)

일반적인 SPL Token Transfer (ATA 생성 포함):
  서명 1~2개:             64~128 bytes
  계정 7~10개:            224~320 bytes
  고정 오버헤드:           ~70 bytes
  Instructions 2~3개:     ~100 bytes
  ─────────────────────────────
  합계:                   ~500~620 bytes (약 40~50% 사용)
```

## 참고 링크

- [Solana Transaction Structure](https://solana.com/docs/core/transactions)
- [Versioned Transactions](https://solana.com/docs/core/transactions/versions)
- [Address Lookup Tables](https://solana.com/docs/advanced/lookup-tables)
- [Durable Nonces](https://solana.com/docs/core/transactions/durable-nonces)
