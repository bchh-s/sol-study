# 7.3 Associated Token Account (ATA)

상위 섹션: [7. Solana 기초 개념 상세](../README.md)

## ATA가 필요한 이유

EVM에서는 어떤 주소든 ERC-20 토큰을 받을 수 있다.
토큰 잔액은 토큰 컨트랙트 내부의 `mapping(address => uint256)`에 저장되므로,
수신자가 별도로 준비할 것이 없다.

```solidity
// EVM: 어떤 주소든 즉시 토큰을 받을 수 있음
mapping(address => uint256) private _balances;

function transfer(address to, uint256 amount) public {
    _balances[msg.sender] -= amount;
    _balances[to] += amount;  // to가 처음 받아도 문제 없음
}
```

**Solana는 다르다.** 토큰 잔액은 별도의 **Token Account**에 저장된다.
각 토큰(mint)마다 지갑별로 고유한 Token Account가 필요하다.

```
EVM:
  유저 지갑 0xABC...
    → USDC 컨트랙트의 balances[0xABC...] = 100
    → USDT 컨트랙트의 balances[0xABC...] = 200

Solana:
  유저 지갑 7Np41...
    → USDC ATA (3xnB7...) → { mint: USDC, owner: 7Np41, amount: 100 }
    → USDT ATA (9kLm2...) → { mint: USDT, owner: 7Np41, amount: 200 }
```

토큰을 받으려면 해당 토큰의 ATA가 **사전에 생성**되어 있어야 한다.
존재하지 않는 ATA로 토큰을 전송하면 트랜잭션이 실패한다.

---

## ATA 주소 도출

ATA는 PDA(Program Derived Address)로 결정적으로 도출된다:

```
ATA = findProgramAddress(
  [
    wallet_address,              // 지갑 주소 (32 bytes)
    TOKEN_PROGRAM_ID,            // Token Program (고정)
    mint_address                 // 토큰 mint 주소 (32 bytes)
  ],
  ASSOCIATED_TOKEN_PROGRAM_ID    // ATA Program (고정)
)
```

### 결정론적 성질

**같은 (wallet, mint) 조합은 항상 같은 ATA 주소를 생성한다.**
온체인 조회 없이 오프체인에서 ATA 주소를 계산할 수 있다.

```typescript
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from '@solana/spl-token';
import { PublicKey } from '@solana/web3.js';

const wallet = new PublicKey('7Np41oeYqPefeNQEHSv1UDhYR3o4GviL6e8');
const usdcMint = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// 동기적으로 ATA 주소 도출 (온체인 호출 없음)
const ataAddress = getAssociatedTokenAddressSync(
  usdcMint,        // mint
  wallet,          // owner
  false,           // allowOwnerOffCurve (PDA owner를 허용할지)
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID
);

console.log(`USDC ATA: ${ataAddress.toBase58()}`);
// → 항상 동일한 주소 반환
```

---

## ATA 생성

### 기본 생성

```typescript
import {
  createAssociatedTokenAccountInstruction,
} from '@solana/spl-token';

// ATA 생성 instruction
const createATAIx = createAssociatedTokenAccountInstruction(
  payer.publicKey,     // ATA rent 비용을 지불할 계정
  ataAddress,          // 생성할 ATA 주소
  wallet,              // ATA의 owner (토큰 소유자)
  mintAddress          // 토큰 mint
);
```

### Idempotent 생성 (권장)

이미 존재하는 ATA에 대해 생성을 시도하면 기본 instruction은 에러를 발생시킨다.
`Idempotent` 버전은 이미 존재하면 아무 작업도 하지 않는다:

```typescript
import {
  createAssociatedTokenAccountIdempotentInstruction,
} from '@solana/spl-token';

// 이미 존재하면 무시, 없으면 생성
const createATAIx = createAssociatedTokenAccountIdempotentInstruction(
  payer.publicKey,     // rent payer
  ataAddress,          // ATA 주소
  wallet,              // owner
  mintAddress          // mint
);
```

**커스터디얼 시스템에서는 항상 idempotent 버전을 사용해야 한다.**
동시에 여러 TX가 같은 ATA를 생성하려 할 수 있으므로, 멱등성이 필수적이다.

### 생성 비용

```
ATA 생성 비용 = Token Account의 rent-exempt 보증금
             = (128 + 165) * 6,960 lamports
             = 2,039,280 lamports
             ≈ 0.00204 SOL

→ SOL $170 기준 약 $0.35
→ 이 비용은 ATA 종료(close) 시 환불됨
```

---

## Token Account 데이터 구조

SPL Token Account (165 bytes)의 내부 레이아웃:

```
Offset  Size   Field           설명
0       32     mint            토큰 mint 주소
32      32     owner           이 토큰 계정의 소유자 (지갑 주소)
64      8      amount          토큰 잔액 (u64, raw amount)
72      4      delegate_opt    delegate 존재 여부 (0 or 1)
76      32     delegate        위임받은 주소 (delegate_opt=1일 때)
108     1      state           계정 상태 (0=uninitialized, 1=initialized, 2=frozen)
109     4      is_native_opt   네이티브 SOL 래핑 여부
113     8      is_native       네이티브 SOL 양
121     8      delegated_amount  위임된 토큰 양
129     4      close_auth_opt  close authority 존재 여부
133     32     close_authority  종료 권한을 가진 주소
합계: 165 bytes
```

```typescript
// Token Account 조회 및 디코딩
import { getAccount, Account } from '@solana/spl-token';

const tokenAccount: Account = await getAccount(connection, ataAddress);

console.log({
  mint: tokenAccount.mint.toBase58(),        // 토큰 mint
  owner: tokenAccount.owner.toBase58(),      // 소유자 지갑
  amount: tokenAccount.amount.toString(),    // 잔액 (bigint)
  delegate: tokenAccount.delegate?.toBase58(),
  isNative: tokenAccount.isNative,
  isFrozen: tokenAccount.isFrozen,
  closeAuthority: tokenAccount.closeAuthority?.toBase58(),
});
```

---

## Lazy Creation 전략 (커스터디얼 시스템)

### 문제

1,000개의 deposit 지갑에 10종의 토큰을 지원하면 → 10,000개의 ATA 생성 필요.
생성 비용: 10,000 * 0.00204 SOL = **20.4 SOL** (~$3,500)

### 해결: Lazy Creation

```
전략: ATA를 미리 만들지 않고, 해당 토큰을 처음 사용할 때 생성한다.

입금 시:
  1. 입금 TX 감지
  2. deposit 지갑의 ATA가 있는지 확인
  3. 없으면 → "ATA 생성 + 토큰 전송"을 하나의 TX로 처리
     (실제로는 입금 TX가 ATA를 생성해야 하므로, 보내는 쪽에서 처리)
  4. 있으면 → 바로 입금 처리

출금 시:
  1. 수신자의 ATA가 있는지 확인
  2. 없으면 → createAssociatedTokenAccountIdempotent + transfer 를 한 TX에
  3. 있으면 → transfer만

Collect(sweep) 시:
  1. 핫월렛의 해당 토큰 ATA가 있는지 확인
  2. 없으면 → 첫 collect 때 생성 (이후 재사용)
  3. 있으면 → transfer만
```

### getOrCreateAssociatedTokenAccount 헬퍼

`@solana/spl-token` 라이브러리가 제공하는 편의 함수:

```typescript
import {
  getOrCreateAssociatedTokenAccount,
} from '@solana/spl-token';

// ATA가 있으면 조회, 없으면 생성
const ata = await getOrCreateAssociatedTokenAccount(
  connection,
  payer,           // Keypair: TX fee + ATA rent 지불
  mintAddress,     // 토큰 mint
  ownerAddress,    // ATA의 owner
  false,           // allowOwnerOffCurve
);

// ata.address: ATA 주소
// ata.amount: 현재 잔액
```

**주의:** 이 함수는 내부적으로 RPC 호출 2번(조회 + 생성TX 제출)을 수행한다.
프로덕션에서는 직접 instruction을 구성하는 것이 더 효율적일 수 있다.

---

## ATA Close (종료)

사용하지 않는 ATA를 종료하면 rent 보증금을 회수할 수 있다:

```typescript
import { createCloseAccountInstruction } from '@solana/spl-token';

// ATA 종료 (잔액이 0이어야 함)
const closeIx = createCloseAccountInstruction(
  ataAddress,              // 종료할 ATA
  destination.publicKey,   // lamports 수신 주소
  owner.publicKey,         // ATA owner (또는 close authority)
);

// → ~0.00204 SOL이 destination으로 반환됨
```

**조건:** ATA의 토큰 잔액이 0이어야 종료 가능하다.
잔액이 남아있으면 먼저 전송하거나 burn해야 한다.

---

## EVM과의 비교

| 항목 | EVM (ERC-20) | Solana (SPL Token + ATA) |
|------|-------------|-------------------------|
| 토큰 잔액 저장 | 토큰 컨트랙트 내부 mapping | 별도 Token Account (ATA) |
| 수신 준비 | 불필요 | ATA 사전 생성 필요 |
| 주소 도출 | 고정 (지갑 주소 = 수신 주소) | PDA 도출 (wallet + mint) |
| 비용 | 없음 (storage slot은 첫 사용 시 가스비) | ~0.00204 SOL (환불 가능) |
| 토큰 계정 수 | 1개 주소 = 모든 토큰 | 토큰 종류 x 지갑 수 |
| 잔액 회수 | 불가 | close로 rent 환불 |

## 참고 링크

- [Associated Token Account Program](https://spl.solana.com/associated-token-account)
- [SPL Token Documentation](https://spl.solana.com/token)
- [Token Account Layout](https://github.com/solana-labs/solana-program-library/blob/master/token/program/src/state.rs)
