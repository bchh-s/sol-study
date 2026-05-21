# 7.5 프로그램 (스마트 컨트랙트)

상위 섹션: [7. Solana 기초 개념 상세](../README.md)

## Programs vs Smart Contracts

Solana의 "프로그램"은 EVM의 "스마트 컨트랙트"에 해당하지만, 근본적인 차이가 있다.

```
EVM Smart Contract:
  ┌──────────────────────────┐
  │ Address: 0xContract      │
  │ Code: bytecode          │  ← 코드
  │ Storage:                │
  │   slot[0] = totalSupply │  ← 상태 (코드와 같은 주소)
  │   slot[1] = balances    │
  │   slot[2] = ...         │
  └──────────────────────────┘

Solana Program:
  ┌──────────────────────┐     ┌──────────────────────┐
  │ Program Account      │     │ Data Account 1       │
  │ executable: true     │     │ owner: Program       │
  │ data: BPF bytecode   │     │ data: [mint info]    │
  └──────────────────────┘     └──────────────────────┘
         코드만                  ┌──────────────────────┐
                                │ Data Account 2       │
                                │ owner: Program       │
                                │ data: [balance info] │
                                └──────────────────────┘
                                       상태만
```

### 핵심 차이: 상태 비분리(Stateless)

```
EVM:
  - 컨트랙트가 자신의 storage를 직접 읽고 쓴다
  - storage는 컨트랙트에 귀속됨
  - SLOAD/SSTORE로 접근

Solana:
  - 프로그램은 코드만 저장 (stateless)
  - 상태는 별도 계정(Account)에 저장
  - 프로그램은 자신이 owner인 계정만 수정 가능
  - 트랜잭션이 필요한 계정을 명시적으로 전달해야 함
```

이 설계의 장점:
1. **병렬 실행**: 서로 다른 계정에 접근하는 TX는 병렬 처리 가능
2. **프로그램 재사용**: 하나의 프로그램이 무수한 계정을 관리
3. **투명한 접근 패턴**: TX에 어떤 계정을 읽고 쓰는지 사전에 알 수 있음

---

## 주요 시스템 프로그램

### 1. System Program

```
Program ID: 11111111111111111111111111111111

역할:
  - 새 계정 생성 (CreateAccount)
  - SOL 전송 (Transfer)
  - 계정 소유권 변경 (Assign)
  - 계정 공간 할당 (Allocate)
  - Nonce 계정 관리 (CreateNonce, AdvanceNonce, etc.)
```

```typescript
import { SystemProgram } from '@solana/web3.js';

// 계정 생성 instruction
SystemProgram.createAccount({
  fromPubkey: payer.publicKey,
  newAccountPubkey: newAccount.publicKey,
  lamports: rentExemptBalance,
  space: dataSize,
  programId: ownerProgramId,
});

// SOL 전송 instruction
SystemProgram.transfer({
  fromPubkey: sender.publicKey,
  toPubkey: recipient.publicKey,
  lamports: amount,
});

// Nonce 관련 (Durable Nonce)
SystemProgram.nonceAdvance({
  noncePubkey: nonceAccount.publicKey,
  authorizedPubkey: authority.publicKey,
});
```

### 2. Token Program (SPL Token)

```
Program ID: TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA

역할:
  - 토큰 Mint 생성 및 관리
  - 토큰 계정 초기화
  - 토큰 전송 (Transfer, TransferChecked)
  - 토큰 발행 (MintTo)
  - 토큰 소각 (Burn)
  - 계정 동결/해제 (Freeze, Thaw)
  - 위임 (Approve, Revoke)
  - 계정 종료 (CloseAccount)
```

```typescript
import {
  createTransferInstruction,
  createTransferCheckedInstruction,
  createMintToInstruction,
  createBurnInstruction,
  createFreezeAccountInstruction,
  createThawAccountInstruction,
  createApproveInstruction,
  createRevokeInstruction,
  createCloseAccountInstruction,
} from '@solana/spl-token';

// 토큰 전송 (amount만 지정)
createTransferInstruction(
  sourceATA,         // source token account
  destATA,           // destination token account
  ownerPubkey,       // source account owner
  amount             // raw amount (decimals 미적용)
);

// 토큰 전송 Checked (amount + decimals 검증)
// → 프로덕션에서 권장 (실수 방지)
createTransferCheckedInstruction(
  sourceATA,
  mintAddress,       // mint (decimals 검증용)
  destATA,
  ownerPubkey,
  amount,
  decimals           // mint의 decimals (예: USDC = 6)
);
```

**Transfer vs TransferChecked:**
- `Transfer`: amount만 전달, decimals 검증 없음
- `TransferChecked`: mint + decimals를 함께 전달, 런타임에서 검증
- 프로덕션에서는 `TransferChecked` 권장 (실수로 10^6배 전송 방지)

### 3. Token-2022 Program (Token Extensions)

```
Program ID: TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

SPL Token의 확장 버전으로, 추가 기능 지원:
  - Transfer Fee (전송 수수료)
  - Interest-Bearing Tokens
  - Non-Transferable Tokens (SBT)
  - Confidential Transfers
  - Transfer Hook (커스텀 로직)
  - Metadata 내장
  - Permanent Delegate
```

Dagaon Core 관점에서는 Token-2022 토큰도 지원해야 할 수 있다.
SPL Token과 API는 유사하지만 program ID가 다르다.

### 4. Associated Token Program

```
Program ID: ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL

역할:
  - ATA(Associated Token Account) 생성
  - ATA 주소 도출 (PDA)
```

```typescript
import {
  createAssociatedTokenAccountInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token';

// ATA 주소 도출 (오프체인)
const ataAddress = getAssociatedTokenAddressSync(mint, owner);

// ATA 생성 (중복 시 에러)
createAssociatedTokenAccountInstruction(payer, ata, owner, mint);

// ATA 생성 (중복 시 무시) - 권장
createAssociatedTokenAccountIdempotentInstruction(payer, ata, owner, mint);
```

### 5. Compute Budget Program

```
Program ID: ComputeBudget111111111111111111111111111111

역할:
  - Compute Unit Price 설정 (Priority Fee)
  - Compute Unit Limit 설정
  - Heap 크기 요청
```

```typescript
import { ComputeBudgetProgram } from '@solana/web3.js';

// Priority Fee 설정
ComputeBudgetProgram.setComputeUnitPrice({
  microLamports: 1_000,  // micro-lamports per CU
});

// CU Limit 설정
ComputeBudgetProgram.setComputeUnitLimit({
  units: 200_000,
});

// Heap 크기 요청 (복잡한 프로그램용)
ComputeBudgetProgram.requestHeapFrame({
  bytes: 256 * 1024,  // 256 KB
});
```

---

## BPF Runtime

### 프로그램 실행 환경

```
Solana 프로그램 실행 흐름:

1. 개발자가 Rust/C로 프로그램 작성
2. Solana BPF 타겟으로 컴파일 → .so (Shared Object) 파일
3. deploy TX로 온체인에 업로드
4. 트랜잭션이 도착하면 BPF VM이 프로그램을 실행

BPF (Berkeley Packet Filter):
  - 원래 네트워크 패킷 필터링용으로 설계된 VM
  - Solana는 eBPF의 변형인 SBF(Solana BPF)를 사용
  - 결정적(deterministic) 실행 보장
  - Compute Unit으로 실행 비용 측정
```

### 프로그램 업그레이드

```
Upgradeable Loader를 사용한 프로그램:

Program Account
  → executable: true
  → data: 프로그램 데이터 계정을 가리키는 포인터

Program Data Account
  → 실제 BPF 바이트코드
  → 업그레이드 권한자(authority) 정보

업그레이드 과정:
  1. authority가 새 바이트코드를 배포
  2. 기존 Program Data Account의 바이트코드를 교체
  3. Program Account의 주소는 변경되지 않음

→ EVM의 Proxy Pattern과 유사하지만, 프로토콜 레벨에서 지원
→ authority를 null로 설정하면 영구 불변(immutable)
```

---

## Cross-Program Invocation (CPI)

프로그램이 다른 프로그램을 호출하는 메커니즘이다.

```
CPI 호출 흐름:

Program A (호출자)
  └→ invoke(instruction, account_infos)
       └→ Program B (피호출자)
            └→ Program B가 자신의 로직 실행
                 └→ 결과를 Program A에 반환
```

### 일반 CPI (invoke)

```rust
// Rust 프로그램 코드 예시
use solana_program::program::invoke;

// Program A에서 Token Program의 transfer를 호출
invoke(
    &spl_token::instruction::transfer(
        &spl_token::id(),
        source_account.key,
        destination_account.key,
        authority.key,
        &[],
        amount,
    )?,
    &[
        source_account.clone(),
        destination_account.clone(),
        authority.clone(),
        token_program.clone(),
    ],
)?;
```

### PDA를 이용한 CPI (invoke_signed)

```rust
// PDA가 authority인 경우: invoke_signed 사용
use solana_program::program::invoke_signed;

// PDA의 seeds (생성 시 사용한 것과 동일)
let seeds = &[b"vault", pool_id.as_ref(), &[bump_seed]];

invoke_signed(
    &spl_token::instruction::transfer(
        &spl_token::id(),
        vault_token_account.key,   // PDA가 owner인 토큰 계정
        destination.key,
        vault_pda.key,             // PDA = authority
        &[],
        amount,
    )?,
    &[
        vault_token_account.clone(),
        destination.clone(),
        vault_pda.clone(),
        token_program.clone(),
    ],
    &[seeds],  // PDA seeds 전달 → 런타임이 서명 검증
)?;
```

### CPI 깊이 제한

```
최대 CPI 깊이: 4 레벨

Program A → Program B → Program C → Program D (최대)
                                        ↓
                                   Program E (불가: CPI 깊이 초과)

각 CPI 호출마다 추가 Compute Unit 소비
```

---

## EVM 용어 매핑 테이블

| EVM 용어 | Solana 용어 | 비고 |
|----------|------------|------|
| Smart Contract | Program | 코드만 저장 (stateless) |
| Contract Storage | Account Data | 별도 계정에 저장 |
| Contract Address | Program ID | 32 bytes (Ed25519) |
| msg.sender | Signer | TX에 서명한 계정 |
| tx.origin | 없음 (CPI에서도 원본 서명자 확인 불가) | 보안상 제거됨 |
| ETH transfer | SOL transfer (System Program) | System Program instruction |
| ERC-20 | SPL Token | Token Program으로 관리 |
| ERC-721 | Metaplex NFT (SPL Token, supply=1) | 외부 프로그램(Metaplex) |
| approve/transferFrom | Approve + Transfer (Delegate) | Token Program 기능 |
| mapping(address => uint256) | PDA-derived accounts | 계정 자체가 mapping entry |
| constructor | Initialize instruction | 프로그램에 init 로직 구현 |
| selfdestruct | Close Account | lamports 회수 + data 삭제 |
| Proxy Pattern | Upgradeable Loader | 프로토콜 레벨 지원 |
| CREATE2 | PDA (findProgramAddress) | 결정적 주소 도출 |
| multicall | 다중 Instruction | TX에 여러 ix 포함 (네이티브) |
| try/catch | CPI 결과 검사 | invoke 반환값으로 에러 처리 |
| block.timestamp | Clock sysvar | Sysvar 계정으로 접근 |
| block.number | Slot / Block Height | 두 개념이 별도 (빈 슬롯 존재) |
| gasleft() | sol_remaining_compute_units() | CU 잔량 확인 |
| revert | ProgramError 반환 | TX 전체 롤백 |

---

## Dagaon Core 구현에서 사용할 프로그램 요약

```
필수 프로그램:
  ┌─────────────────────────┐
  │ System Program          │ → 계정 생성, SOL 전송, Nonce 관리
  │ Token Program           │ → SPL Token 전송, ATA 관리
  │ Associated Token Program│ → ATA 주소 도출 및 생성
  │ Compute Budget Program  │ → Priority Fee 설정
  └─────────────────────────┘

선택 프로그램:
  ┌─────────────────────────┐
  │ Token-2022 Program      │ → Token Extensions 토큰 지원 시
  │ Memo Program            │ → 트랜잭션에 메모 추가 시
  │ Address Lookup Table    │ → 대량 배치 TX 시
  └─────────────────────────┘
```

## 참고 링크

- [Solana Programs Overview](https://solana.com/docs/core/programs)
- [SPL Token Program](https://spl.solana.com/token)
- [Token-2022 Program](https://spl.solana.com/token-2022)
- [Cross-Program Invocation](https://solana.com/docs/core/cpi)
- [BPF Loader](https://solana.com/docs/programs/deploying)
