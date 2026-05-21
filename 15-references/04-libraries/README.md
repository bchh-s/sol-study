# 라이브러리

상위 섹션: [15. 참고자료](../README.md)

---

## solana-kms-signer

### 개요

- **GitHub:** https://github.com/gtg7784/solana-kms-signer
- **용도:** AWS KMS의 Ed25519 키를 사용하여 Solana 트랜잭션에 서명하는 라이브러리
- **언어:** TypeScript/JavaScript

### 기능

- AWS KMS Ed25519 키에서 Solana 공개키/주소 추출
- DER 인코딩된 공개키 → raw 32 bytes → base58 변환 자동 처리
- Solana TX 메시지 서명 (`MessageType: RAW`)
- `@solana/web3.js`의 `Signer` 인터페이스 호환

### 사용법

```typescript
import { KmsSigner } from 'solana-kms-signer';
import { Connection, Transaction, SystemProgram } from '@solana/web3.js';

// KMS signer 초기화
const signer = new KmsSigner({
  keyId: 'your-kms-key-id',
  region: 'ap-northeast-2'
});

// Solana 주소 얻기
const publicKey = await signer.getPublicKey();
console.log('Address:', publicKey.toBase58());

// TX 서명 및 전송
const connection = new Connection('https://api.devnet.solana.com');
const tx = new Transaction().add(
  SystemProgram.transfer({
    fromPubkey: publicKey,
    toPubkey: recipientPubkey,
    lamports: 1000000
  })
);
tx.feePayer = publicKey;
tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

// KMS로 서명
await signer.signTransaction(tx);

// 전송
const signature = await connection.sendRawTransaction(tx.serialize());
```

### 제한사항 및 고려사항

| 항목 | 상세 |
|------|------|
| 성숙도 | 커뮤니티 라이브러리 (공식이 아님), 프로덕션 검증 필요 |
| 의존성 | `@aws-sdk/client-kms`, `@solana/web3.js` |
| 커스터마이징 | 소스 코드가 단순하므로 필요 시 직접 구현도 가능 |
| durable nonce 지원 | TX에 nonce instruction을 추가한 후 서명하면 됨 (라이브러리 제한 없음) |
| 에러 처리 | KMS API 에러(throttle, timeout) 처리는 호출자 책임 |

### Dagaon Core에서의 활용 방향

직접 사용보다는 **참고 구현**으로 활용하고, Dagaon Core의 기존 KMS 레이어에 Ed25519 지원을 추가하는 것이 바람직하다. 이유:

1. 기존 KMS 레이어의 에러 처리, 재시도, 로깅, 메트릭 패턴을 유지
2. 키 관리 정책(태깅, 로테이션, 접근 제어)과의 통합
3. 체인별 다른 서명 로직을 통일된 인터페이스로 추상화

---

## @solana/web3.js

### 개요

- **npm:** https://www.npmjs.com/package/@solana/web3.js
- **문서:** https://solana-labs.github.io/solana-web3.js/
- **용도:** Solana 네트워크와의 상호작용을 위한 핵심 SDK
- **언어:** TypeScript/JavaScript

### 핵심 기능

| 모듈 | 용도 | Dagaon 사용 위치 |
|------|------|-----------------|
| `Connection` | RPC 클라이언트 (HTTP + WebSocket) | RPC 클라이언트 래퍼 |
| `Transaction` | TX 구성 및 직렬화 | TX Preparer |
| `SystemProgram` | SOL 전송, nonce 관리 instruction | 출금 TX, nonce 풀 |
| `PublicKey` | Solana 주소/공개키 타입 | 전체 |
| `Keypair` | 키 페어 (테스트용) | devnet 테스트 |
| `sendAndConfirmTransaction` | TX 전송 + 확정 대기 | 단순 전송 (canary 등) |
| `NonceAccount` | nonce 계정 데이터 파싱 | nonce 값 조회 |

### 주요 사용 패턴

```typescript
import {
  Connection,
  Transaction,
  SystemProgram,
  NonceAccount,
  PublicKey,
  LAMPORTS_PER_SOL
} from '@solana/web3.js';

// Connection
const connection = new Connection(
  'https://api.mainnet-beta.solana.com',
  { commitment: 'finalized' }
);

// 블록 조회
const slot = await connection.getSlot('finalized');
const blocks = await connection.getBlocks(startSlot, endSlot, 'finalized');
const block = await connection.getBlock(slot, {
  transactionDetails: 'full',
  rewards: false,
  maxSupportedTransactionVersion: 0
});

// Nonce 값 조회
const nonceAccountInfo = await connection.getAccountInfo(nonceAccountPubkey);
const nonceAccount = NonceAccount.fromAccountData(nonceAccountInfo.data);
const nonceValue = nonceAccount.nonce;  // blockhash 대신 사용할 값

// Durable nonce TX 구성
const tx = new Transaction({
  nonceInfo: {
    nonce: nonceValue,
    nonceInstruction: SystemProgram.nonceAdvance({
      noncePubkey: nonceAccountPubkey,
      authorizedPubkey: authorityPubkey
    })
  }
});
tx.add(SystemProgram.transfer({ ... }));
tx.feePayer = feePayerPubkey;

// TX 전송
const rawTx = tx.serialize();
const signature = await connection.sendRawTransaction(rawTx, {
  skipPreflight: true
});

// TX 상태 확인
const statuses = await connection.getSignatureStatuses([signature]);
```

### 버전 주의사항

`@solana/web3.js` v2.x가 출시되었으며, 기존 v1.x와 API가 크게 다르다. 프로젝트 시작 시 버전을 명확히 결정해야 한다:

| 항목 | v1.x (legacy) | v2.x (modern) |
|------|--------------|---------------|
| API 스타일 | 클래스 기반 (Connection, Transaction) | 함수형 (composable) |
| 번들 크기 | 큼 (전체 포함) | 작음 (트리 셰이킹 가능) |
| 안정성 | 성숙 (수년간 사용) | 비교적 신규 |
| 문서/예제 | 풍부 | 성장 중 |
| 권장 | 기존 프로젝트 유지보수 | 신규 프로젝트 |

---

## @solana/spl-token

### 개요

- **npm:** https://www.npmjs.com/package/@solana/spl-token
- **용도:** SPL Token Program과의 상호작용 (토큰 전송, ATA 관리, mint/burn 등)
- **언어:** TypeScript/JavaScript

### 핵심 기능

| 함수 | 용도 | Dagaon 사용 위치 |
|------|------|-----------------|
| `getAssociatedTokenAddress` | (wallet, mint) → ATA 주소 계산 | ATA 관리 |
| `createAssociatedTokenAccountIdempotent` | ATA 생성 (이미 있으면 no-op) | 출금 TX 구성 |
| `createTransferInstruction` | SPL 토큰 전송 instruction | 출금 TX 구성 |
| `createCloseAccountInstruction` | ATA 폐쇄 (rent 환불) | ATA 정리 배치 |
| `getAccount` | 토큰 계정 정보 조회 | 잔액 확인 |
| `getMint` | 토큰 mint 정보 조회 (decimals 등) | 토큰 설정 |

### 사용 패턴

```typescript
import {
  getAssociatedTokenAddress,
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferInstruction,
  createCloseAccountInstruction,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
} from '@solana/spl-token';

// ATA 주소 계산 (오프체인, RPC 호출 불필요)
const ataAddress = await getAssociatedTokenAddress(
  mintPubkey,         // 토큰 mint
  walletPubkey,       // 소유자 지갑
  false,              // allowOwnerOffCurve
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
);

// ATA 생성 + 토큰 전송 (단일 TX)
const tx = new Transaction();

// 1. ATA 생성 (이미 있으면 no-op)
tx.add(createAssociatedTokenAccountIdempotentInstruction(
  feePayerPubkey,   // payer (rent 비용 지불)
  ataAddress,        // 생성할 ATA
  walletPubkey,      // ATA 소유자
  mintPubkey         // 토큰 mint
));

// 2. 토큰 전송
tx.add(createTransferInstruction(
  sourceAta,         // 보내는 ATA
  ataAddress,        // 받는 ATA
  authorityPubkey,   // 보내는 ATA의 authority
  amount             // 토큰 수량 (정수, decimals 적용 전)
));

// ATA 폐쇄 (rent 환불)
const closeTx = new Transaction().add(
  createCloseAccountInstruction(
    ataAddress,        // 폐쇄할 ATA
    feePayerPubkey,    // rent 환불 받을 주소
    walletPubkey       // ATA 소유자
  )
);
```

### Token 2022 (Token Extensions) 지원

`@solana/spl-token` 라이브러리는 Token 2022 프로그램도 지원한다. Token 2022 토큰을 처리할 때는 `TOKEN_2022_PROGRAM_ID`를 사용:

```typescript
import { TOKEN_2022_PROGRAM_ID } from '@solana/spl-token';

// Token 2022 ATA 주소 계산
const ata2022 = await getAssociatedTokenAddress(
  mintPubkey,
  walletPubkey,
  false,
  TOKEN_2022_PROGRAM_ID  // Token 2022 프로그램
);
```

---

## bs58

### 개요

- **npm:** https://www.npmjs.com/package/bs58
- **용도:** Base58 인코딩/디코딩
- **언어:** JavaScript/TypeScript

### 사용법

```typescript
import bs58 from 'bs58';

// 인코딩: bytes → base58 문자열
const bytes = new Uint8Array([1, 2, 3, ...]);  // 32 bytes
const encoded = bs58.encode(bytes);
// → "9WzDXwBb..."

// 디코딩: base58 문자열 → bytes
const decoded = bs58.decode("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
// → Uint8Array(32)

// Solana 주소 검증
function isValidSolanaAddress(address: string): boolean {
  try {
    const decoded = bs58.decode(address);
    return decoded.length === 32;
  } catch {
    return false;
  }
}

// TX signature 검증 (64 bytes)
function isValidSignature(sig: string): boolean {
  try {
    const decoded = bs58.decode(sig);
    return decoded.length === 64;
  } catch {
    return false;
  }
}
```

### Base58 알파벳

```
123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz

제외된 문자: 0(영), O(대문자 오), I(대문자 아이), l(소문자 엘)
→ 혼동 방지를 위해 제외 (Bitcoin 주소에서 유래)
```

### Dagaon Core에서의 활용

| 용도 | 설명 |
|------|------|
| 주소 변환 | KMS 공개키(raw bytes) → Solana 주소(base58) |
| 주소 검증 | 사용자 입력 주소의 유효성 확인 |
| 서명 표시 | TX signature(64 bytes) → base58 문자열 |
| DB 저장 | 모든 Solana 주소/서명을 base58 문자열로 저장 |

---

## 라이브러리 의존성 요약

```
Dagaon Core Solana Plugin 의존성:

@solana/web3.js          → RPC 통신, TX 구성, 블록 조회
@solana/spl-token        → SPL 토큰 전송, ATA 관리
@aws-sdk/client-kms      → KMS 키 생성, 서명, 검증
bs58                     → base58 인코딩/디코딩
solana-kms-signer        → 참고 구현 (직접 사용보다는 코드 참고)
```
