# 7.2 계정 모델

상위 섹션: [7. Solana 기초 개념 상세](../README.md)

## 핵심 원칙: 모든 것이 계정이다

Solana에서 모든 데이터는 **계정(Account)** 에 저장된다.
지갑, 토큰 잔액, 프로그램 코드, NFT 메타데이터 등 예외 없이 모두 계정이다.

---

## 계정의 5가지 필드

모든 Solana 계정은 정확히 5개의 필드로 구성된다:

```rust
pub struct Account {
    pub lamports: u64,        // SOL 잔액 (1 SOL = 10^9 lamports)
    pub data: Vec<u8>,        // 임의 바이트 배열 (프로그램이 해석)
    pub owner: Pubkey,        // 이 계정을 소유한 프로그램
    pub executable: bool,     // 이 계정이 프로그램 코드인지
    pub rent_epoch: u64,      // 마지막으로 rent를 지불한 에포크
}
```

### 필드별 상세

**1. lamports (u64)**
- SOL의 최소 단위 (1 SOL = 1,000,000,000 lamports)
- 모든 계정은 lamports를 보유할 수 있음
- rent-exempt 최소 잔액 미달 시 계정이 가비지 컬렉션될 수 있음

**2. data (Vec<u8>)**
- 가변 길이 바이트 배열
- 계정 생성 시 크기를 지정, 이후 변경 불가 (realloc 가능하지만 제한적)
- 프로그램마다 자체 직렬화 형식으로 해석 (Borsh, Pack 등)
- 일반 지갑(System Account)은 data가 비어있음 (0 bytes)

**3. owner (Pubkey)**
- 이 계정의 data를 수정할 권한을 가진 프로그램
- **오직 owner 프로그램만 data를 변경 가능**
- lamports는 누구나 추가 가능하지만, 차감은 owner만 가능

```
소유권 예시:

일반 지갑 (SOL만 보유)
  → owner: System Program (11111111111111111111111111111111)

SPL Token 계정 (토큰 보유)
  → owner: Token Program (TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA)

프로그램 실행 파일
  → owner: BPF Loader (BPFLoaderUpgradeab1e11111111111111111111111)
```

**4. executable (bool)**
- `true`: 이 계정에 프로그램 코드가 저장되어 있음
- `false`: 데이터 계정 (대부분의 계정)
- 한번 `true`로 설정되면 변경 불가

**5. rent_epoch (u64)**
- 현재는 대부분의 계정이 rent-exempt이므로 실질적으로 사용되지 않음
- 역사적 이유로 남아있는 필드

---

## 계정 소유권 (Account Ownership)

Solana의 보안 모델 핵심이다.

```
규칙 1: 오직 owner 프로그램만 data를 수정할 수 있다
규칙 2: 오직 owner 프로그램만 lamports를 차감할 수 있다
규칙 3: 누구나 lamports를 추가(입금)할 수 있다
규칙 4: owner는 System Program의 assign instruction으로 변경 가능
```

```
예시: SPL Token Transfer

Token Account A (owner: Token Program)
  data: { mint: USDC, owner: UserA, amount: 100 }

→ Token Program이 transfer instruction을 받으면:
  1. UserA가 서명했는지 확인 (signer check)
  2. Token Account A의 data에서 amount를 차감
  3. Token Account B의 data에서 amount를 증가

→ System Program은 Token Account A의 data를 수정할 수 없음
→ 다른 프로그램도 Token Account A의 data를 수정할 수 없음
```

### EVM과의 차이

```
EVM:
  - 컨트랙트가 자신의 storage를 직접 수정
  - storage는 컨트랙트 주소에 종속
  - 외부에서 storage에 직접 접근 불가

Solana:
  - 프로그램(컨트랙트)은 코드만 저장
  - 데이터는 별도 계정에 저장
  - 프로그램은 자신이 owner인 계정의 data만 수정 가능
  - 하나의 프로그램이 여러 계정의 data를 관리

→ EVM: 코드 + 상태 = 하나의 주소
→ Solana: 코드(Program Account) + 상태(Data Account) = 별개
```

---

## System Program

System Program은 Solana의 가장 기본적인 프로그램이다:

```
Program ID: 11111111111111111111111111111111

역할:
1. 새 계정 생성 (createAccount)
2. SOL 전송 (transfer)
3. 계정 소유권 변경 (assign)
4. Nonce 계정 관리 (durable nonce)
5. 계정 공간 할당 (allocate)
```

```typescript
import { SystemProgram, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js';

// 새 계정 생성
const newAccount = Keypair.generate();
const createAccountIx = SystemProgram.createAccount({
  fromPubkey: payer.publicKey,          // 비용 지불자
  newAccountPubkey: newAccount.publicKey,
  lamports: rentExemptBalance,          // rent-exempt 최소 잔액
  space: 165,                           // 데이터 크기 (bytes)
  programId: TOKEN_PROGRAM_ID,          // owner가 될 프로그램
});

// SOL 전송
const transferIx = SystemProgram.transfer({
  fromPubkey: sender.publicKey,
  toPubkey: recipient.publicKey,
  lamports: 1 * LAMPORTS_PER_SOL,
});
```

---

## Rent (임대료)

### Rent-Exempt 보증금

모든 계정은 **rent-exempt 최소 잔액**을 유지해야 한다.
이는 "임대료"라기보다 **보증금(deposit)** 에 가깝다.

### 계산 공식

```
rent_exempt_balance = (128 + data_size) * 6,960 lamports

128 = 계정 메타데이터 오버헤드 (bytes)
data_size = 계정의 data 필드 크기 (bytes)
6,960 = 2년치 rent에 해당하는 lamports/byte
```

정확한 값은 `getMinimumBalanceForRentExemption` RPC로 조회:

```typescript
// 165 bytes 계정(SPL Token Account)의 rent-exempt 잔액 조회
const rentExempt = await connection.getMinimumBalanceForRentExemption(165);
// → 2,039,280 lamports (약 0.00204 SOL)
```

### 주요 계정 유형별 Rent 비용

| 계정 유형 | data 크기 | Rent-exempt 비용 | SOL 환산 |
|----------|----------|-----------------|---------|
| System Account (SOL 지갑) | 0 bytes | 890,880 lamports | ~0.00089 SOL |
| SPL Token Account | 165 bytes | 2,039,280 lamports | ~0.00204 SOL |
| Token Mint | 82 bytes | 1,461,600 lamports | ~0.00146 SOL |
| Nonce Account | 80 bytes | 1,447,680 lamports | ~0.00145 SOL |
| Metadata Account (Metaplex) | 679 bytes | 5,616,720 lamports | ~0.00562 SOL |

### Rent가 보증금인 이유

```
계정 생성:
  → lamports 지불 (rent-exempt 이상)
  → 계정 사용

계정 종료 (close):
  → lamports가 지정 주소로 반환
  → 계정의 data가 0으로 초기화
  → 다음 에포크에 가비지 컬렉션

→ Rent는 실제로 소모되지 않고, 계정 삭제 시 100% 환불됨
```

### Rent 미달 시

```
계정 잔액 < rent-exempt 최소값:
  → 에포크마다 rent 차감 (매우 소량)
  → 잔액이 0이 되면 계정 삭제 (가비지 컬렉션)
  → data 영구 소실

현재는 대부분의 프로그램이 rent-exempt을 강제하므로,
실질적으로 rent 미달 계정이 생성되는 경우는 드물다.
```

---

## Program Derived Address (PDA)

### PDA란

PDA는 프로그램이 결정적으로 도출하는 주소로, **Ed25519 커브 위에 없는 공개키**이다.
누구의 private key도 아니므로, 오직 프로그램만이 PDA를 대신하여 서명할 수 있다.

### 도출 방법

```
PDA = findProgramAddress(seeds, programId)

내부 동작:
1. hash = SHA-256(seeds + programId + [bump])
2. bump를 255부터 0까지 감소시키며 시도
3. hash가 Ed25519 커브 위에 없으면 → 유효한 PDA
4. 첫 번째로 발견된 (hash, bump)를 반환
```

```typescript
import { PublicKey } from '@solana/web3.js';

// PDA 도출 예시: 유저별 설정 계정
const [pdaAddress, bump] = PublicKey.findProgramAddressSync(
  [
    Buffer.from('user-settings'),       // seed 1: 문자열
    userPubkey.toBuffer(),              // seed 2: 유저 공개키
  ],
  programId                             // 프로그램 ID
);

// pdaAddress는 결정적 → 같은 seeds + programId = 같은 주소
// bump는 255에서 시작하여 유효한 PDA가 될 때까지 감소
```

### PDA의 용도

```
1. 토큰 계정 주소 도출 (ATA)
   seeds: [wallet, TOKEN_PROGRAM, mint]
   → 지갑 + 토큰 조합마다 고유한 주소

2. 프로그램 권한 위임 (Authority)
   seeds: ['vault', pool_id]
   → 프로그램이 관리하는 금고 주소

3. 데이터 계정 매핑
   seeds: ['user-data', user_pubkey]
   → 유저별 데이터 계정 주소

4. 서명 대리 (CPI with PDA signer)
   → 프로그램이 PDA를 대신하여 invoke_signed로 서명
```

### PDA vs EOA (EVM과의 비교)

```
EVM:
  - EOA: private key로 생성된 주소
  - Contract: CREATE/CREATE2로 배포된 주소
  - CREATE2: 결정적 주소 가능하지만, 코드 배포가 필요

Solana PDA:
  - Private key 없음 → 누구도 직접 서명 불가
  - 프로그램이 invoke_signed로 대리 서명
  - 결정적 주소 → 코드 배포 없이 주소만 도출 가능
  - 계정 생성은 별도 instruction으로 수행
```

---

## EVM 대비 계정 모델 비교

```
EVM Account:
  ┌──────────────────────┐
  │ Address (20 bytes)   │
  │ Balance (ETH)        │
  │ Nonce               │
  │ Code (if contract)  │  ← 코드와 상태가 하나의 주소
  │ Storage:            │
  │   slot[0] = value   │  ← key-value storage
  │   slot[1] = value   │
  │   ...               │
  └──────────────────────┘

Solana Account:
  ┌──────────────────────┐     ┌──────────────────────┐
  │ Program Account      │     │ Data Account         │
  │ (executable: true)   │     │ (executable: false)  │
  │ owner: BPF Loader   │     │ owner: Program       │
  │ data: BPF bytecode  │     │ data: 구조화된 바이트   │
  │ lamports: rent       │     │ lamports: rent + SOL │
  └──────────────────────┘     └──────────────────────┘
        코드만 저장                  상태만 저장
```

| 관점 | EVM | Solana |
|------|-----|--------|
| 주소 크기 | 20 bytes (160 bit) | 32 bytes (256 bit, Ed25519) |
| 상태 저장 | 컨트랙트 내부 storage slots | 외부 account의 data 필드 |
| 상태 접근 | SLOAD/SSTORE (key-value) | 계정을 TX에 포함하여 전달 |
| 상태 크기 | 무제한 (가스비로 제한) | 계정 생성 시 크기 고정 (realloc 제한적) |
| 비용 모델 | 가스비 (실행 시 매번) | Rent 보증금 (1회, 환불 가능) |
| 계정 삭제 | SELFDESTRUCT (deprecated) | Close instruction으로 lamports 회수 |
| 결정적 주소 | CREATE2 | PDA (findProgramAddress) |

## 참고 링크

- [Solana Account Model](https://solana.com/docs/core/accounts)
- [Rent Documentation](https://solana.com/docs/core/fees#rent)
- [Program Derived Addresses](https://solana.com/docs/core/pda)
