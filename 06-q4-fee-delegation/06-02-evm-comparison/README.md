# 6.2 EVM과의 비교

상위 섹션: [6. Q4: Fee Delegation](../README.md)

## 개요

EVM에서 "다른 사람이 가스비를 대신 내는 것"은 프로토콜이 설계될 때 고려되지 않았다.
`tx.origin`과 `msg.sender`가 항상 가스비를 지불하는 구조이기 때문에,
대납을 위해서는 애플리케이션 레벨에서 우회해야 한다.

Solana는 처음부터 다중 서명자를 지원하며, fee payer 분리가 프로토콜에 내장되어 있다.

---

## EVM 접근법 1: EIP-2771 Meta-Transactions

### 구조

```
┌──────────┐   1. 서명된 메타TX    ┌──────────────┐   2. 실제 TX     ┌──────────────┐
│   User   │ ──────────────────→ │   Relayer    │ ──────────────→ │  Forwarder   │
│ (서명만)  │                     │ (가스비 지불) │                 │  Contract    │
└──────────┘                     └──────────────┘                 └──────────────┘
                                                                        │
                                                                  3. _msgSender()
                                                                    override
                                                                        │
                                                                        ▼
                                                                 ┌──────────────┐
                                                                 │   Target     │
                                                                 │  Contract    │
                                                                 │ (ERC2771Context)
                                                                 └──────────────┘
```

### 동작 방식

1. **User**가 오프체인에서 메타 트랜잭션 데이터에 서명 (EIP-712 typed data)
2. **Relayer**가 이 서명을 Forwarder 컨트랙트에 제출 (Relayer가 가스비 부담)
3. **Forwarder**가 서명을 검증하고, 대상 컨트랙트를 호출
4. **대상 컨트랙트**는 `ERC2771Context`를 상속하여 `_msgSender()`가 calldata 끝의 20바이트(원래 서명자)를 반환

### 필요한 인프라

- **Forwarder 컨트랙트**: 체인마다 배포 필요 (MinimalForwarder 등)
- **Relayer 서버**: 메타TX 수신, 가스비 부담, 체인에 제출
- **대상 컨트랙트 수정**: `ERC2771Context` 상속, `_msgSender()` 사용
- **서명 체계**: EIP-712 도메인 분리, nonce 관리, replay 방지

### 한계

- 기존 컨트랙트와 호환 불가 (수정 필요)
- Relayer 서버 운영 부담
- 가스 오버헤드: 서명 검증 + calldata 파싱으로 ~30% 추가

---

## EVM 접근법 2: EIP-4337 Account Abstraction

### 구조

```
┌──────────┐  1. UserOperation  ┌──────────────┐  2. Bundle   ┌──────────────┐
│   User   │ ────────────────→ │   Bundler    │ ───────────→ │  EntryPoint  │
│ (Smart   │                   │              │              │  Contract    │
│  Account)│                   └──────────────┘              └──────────────┘
└──────────┘                                                       │
                                                             3. validateOp
                                                                   │
                                                    ┌──────────────┼──────────────┐
                                                    │              │              │
                                                    ▼              ▼              ▼
                                              ┌──────────┐  ┌──────────┐  ┌──────────┐
                                              │  Smart   │  │ Paymaster│  │  Target  │
                                              │ Account  │  │          │  │ Contract │
                                              └──────────┘  └──────────┘  └──────────┘
```

### 동작 방식

1. **User**가 `UserOperation` 구조체를 생성하여 Bundler에 제출
2. **Bundler**가 여러 UserOp을 묶어 `EntryPoint.handleOps()`를 호출
3. **EntryPoint**가 Smart Account의 `validateUserOp()`으로 서명 검증
4. **Paymaster**(선택)가 가스비 대납을 승인 (`validatePaymasterUserOp()`)
5. Smart Account가 실제 호출을 실행

### 필요한 인프라

- **EntryPoint 컨트랙트**: 글로벌 싱글톤 (이미 배포됨)
- **Smart Account 팩토리**: 유저별 컨트랙트 지갑 생성
- **Bundler**: UserOp을 수집하고 번들링하는 별도 노드
- **Paymaster 컨트랙트**: 가스비 대납 정책 로직 (스폰서 조건 등)
- **프론트엔드 SDK**: UserOp 생성, 서명, Bundler 통신

### 한계

- 엄청난 인프라 복잡도 (컨트랙트 4+개, 별도 서버)
- Smart Account 배포 비용 (첫 TX에 ~$5-15)
- 기존 EOA와 호환 불가
- 가스 오버헤드: EntryPoint 검증 로직으로 ~40-50% 추가

---

## EVM 접근법 3: Permit/Permit2 (EIP-2612)

### 구조

```
┌──────────┐  1. 오프체인 서명   ┌──────────────┐  2. permit() + transferFrom()
│   User   │ ────────────────→ │   Relayer    │ ────────────────────────────→ Token
│ (서명만)  │                   │ (가스비 지불) │
└──────────┘                   └──────────────┘
```

### 동작 방식

1. **User**가 EIP-712 서명으로 토큰 사용 승인 (approve 없이)
2. **Relayer**가 `permit()` 호출로 승인 등록 + `transferFrom()` 실행
3. 토큰이 컨트랙트 수정 없이 approve + transfer를 한 TX에서 처리

### 필요한 인프라

- **Permit 지원 토큰**: EIP-2612를 구현한 토큰만 가능 (USDC 등)
- **Permit2 컨트랙트**: Uniswap의 범용 승인 컨트랙트 (비표준 토큰 지원)
- **Relayer 서버**: 서명 수집 및 체인 제출

### 한계

- 토큰 전송에만 적용 가능 (범용 fee delegation 아님)
- 모든 토큰이 permit을 지원하지 않음
- Replay 공격 방지를 위한 nonce 관리 필요
- Permit2는 별도 컨트랙트에 대한 approve가 선행 필요

---

## Solana: 그냥 feePayer를 설정하면 된다

```typescript
const tx = new Transaction();
tx.feePayer = hotWallet.publicKey;  // 이것이 전부

tx.add(
  createTransferInstruction(
    sourceATA,
    destinationATA,
    userPublicKey,    // owner
    amount
  )
);

await sendAndConfirmTransaction(connection, tx, [hotWallet, userKeypair]);
```

- **추가 컨트랙트**: 없음
- **Relay 서버**: 없음 (커스터디얼에서는 백엔드가 직접 제출)
- **가스 오버헤드**: 0%
- **컨트랙트 수정**: 없음
- **호환성 제한**: 없음 (모든 프로그램에 적용)

---

## 종합 비교표

| 항목 | EIP-2771 | EIP-4337 | Permit/Permit2 | Solana Fee Payer |
|------|----------|----------|----------------|------------------|
| **구현 복잡도** | 중간 | 매우 높음 | 낮음 | **최소** |
| **가스 오버헤드** | ~30% | ~40-50% | ~10% | **0%** |
| **추가 컨트랙트** | Forwarder | EntryPoint, Account, Paymaster, Factory | Permit2 | **없음** |
| **Relay/Bundler** | 필요 | 필요 | 필요 | **불필요** |
| **기존 컨트랙트 호환** | 수정 필요 | 불가 (EOA 호환 X) | 토큰만 | **제한 없음** |
| **적용 범위** | 범용 | 범용 | 토큰 전송만 | **범용** |
| **유저 서명** | 필요 | 필요 | 필요 | **커스터디얼이면 불필요** |
| **첫 TX 추가비용** | 없음 | Smart Account 배포 ($5-15) | 없음 | **없음** |
| **보안 모델** | Forwarder 신뢰 | EntryPoint 검증 | 서명 검증 | **프로토콜 내장** |
| **표준화 수준** | ERC-2771 | ERC-4337 | EIP-2612 | **프로토콜 레벨** |

---

## 왜 이렇게 다른가: 근본적 설계 차이

### EVM의 한계

```
EVM Transaction:
  from: 0xUser        ← 단 하나의 서명자
  to: 0xContract
  value: 0
  data: 0x...
  gasPrice: ...
  gasLimit: ...
  signature: (v, r, s) ← from의 단일 서명

→ from이 반드시 가스비를 지불
→ "다른 사람이 대신 내는 것"은 설계에 없음
→ 우회 레이어(컨트랙트, 릴레이)가 필수
```

### Solana의 설계

```
Solana Transaction:
  signatures: [sig1, sig2, ...]     ← 여러 서명자
  message:
    accountKeys: [acct1, acct2, ...]
    instructions: [...]

→ 여러 서명자가 각자 역할 수행
→ accountKeys[0]이 fee payer (프로토콜 규칙)
→ fee payer ≠ 작업 수행자가 처음부터 가능
→ 우회 레이어 불필요
```

### 핵심 차이 요약

1. **서명자 수**: EVM은 1명, Solana는 N명
2. **fee 지불자 결정**: EVM은 서명자 = fee 지불자 (고정), Solana는 첫 번째 서명자 = fee 지불자 (분리 가능)
3. **상태 접근**: EVM은 컨트랙트 내부 storage, Solana는 외부 account로 분리
4. **결과**: EVM은 fee delegation을 위한 별도 계층 필요, Solana는 네이티브 지원

---

## Dagaon Core 실무 관점

### EVM 가스비 대납 현재 구현 (추정)

```
[Gas Supply Pipeline]
1. deposit 지갑 생성 시 초기 ETH 공급
2. 잔액 모니터링 (지갑별 주기적 체크)
3. 임계치 이하 시 ETH 재공급 TX 발생
4. collect 시 deposit 지갑의 ETH로 가스비 지불
5. Forwarder 컨트랙트 체인별 배포/관리
6. 체인별 가스 가격 변동 모니터링

→ 장애 포인트: ETH 공급 실패, 가스 가격 급등, 컨트랙트 버그
→ 운영 비용: ETH 잔액 유지, 모니터링 인프라, relay 서버
```

### Solana 구현 시

```
[Fee Payer Pipeline]
1. 핫월렛 SOL 잔액 모니터링 (단일 지점)
2. 모든 TX에서 hotWallet.publicKey = feePayer
3. 끝

→ 장애 포인트: 핫월렛 SOL 부족 (단일)
→ 운영 비용: 핫월렛 SOL 잔액 유지 (하나만)
```

## 참고 링크

- [EIP-2771: Secure Protocol for Native Meta Transactions](https://eips.ethereum.org/EIPS/eip-2771)
- [EIP-4337: Account Abstraction Using Alt Mempool](https://eips.ethereum.org/EIPS/eip-4337)
- [EIP-2612: Permit Extension for ERC-20](https://eips.ethereum.org/EIPS/eip-2612)
- [Solana Transaction Fees](https://solana.com/docs/core/fees)
