# 오히려 좋아지는 것

상위 섹션: [14. 결론](../README.md)

---

## 개요

Solana 통합은 새로운 도전을 가져오지만, 몇몇 영역에서는 EVM보다 **명확하게 개선**되는 부분이 있다. 이 개선점들은 운영 효율성, 사용자 경험, 비용 절감에 직접적으로 기여한다.

---

## 1. Fee Delegation (수수료 위임)

### EVM의 현재 방식

EVM에서 사용자 대신 수수료를 지불하려면 복잡한 인프라가 필요하다:

```
EVM 수수료 위임 옵션:

Option A: Meta-Transaction (EIP-2771)
  1. 사용자가 TX 데이터에 서명 (오프체인)
  2. Relayer가 실제 TX를 구성하여 가스비 지불
  3. 수신 컨트랙트가 ERC-2771 Trusted Forwarder를 통해 원래 서명자 식별
  → Relayer 인프라 구축 필요, 컨트랙트 수정 필요

Option B: ERC-4337 Account Abstraction
  1. UserOperation 구조체 구성
  2. Bundler가 UserOp을 번들링
  3. Paymaster가 가스비 지불
  → Bundler + Paymaster 인프라 필요, 복잡한 아키텍처

Option C: 사용자에게 ETH 선전송
  1. 사용자 지갑에 가스비용 ETH를 먼저 전송
  2. 사용자가 토큰 전송 TX 실행
  → 2번의 TX 필요, 사용자 UX 나쁨
```

### Solana의 방식

Solana에서는 **feePayer가 트랜잭션의 네이티브 필드**이다. 별도 인프라 없이 TX 구성 시 feePayer만 지정하면 된다:

```
Solana 수수료 위임:

const tx = new Transaction()
tx.feePayer = hotWallet.publicKey    // 핫월렛이 수수료 지불
tx.add(
  SystemProgram.transfer({           // 사용자 자금 이동
    fromPubkey: user,
    toPubkey: destination,
    lamports: amount
  })
)
// feePayer(핫월렛)와 from(사용자) 모두 서명

→ 추가 인프라 없음
→ 컨트랙트 수정 없음
→ 단일 TX로 처리
```

### 정량적 개선

| 항목 | EVM (Meta-TX) | Solana (feePayer) |
|------|-------------|-------------------|
| 추가 인프라 | Relayer 서버 + Paymaster 컨트랙트 | 없음 |
| 구현 복잡도 | 높음 (ERC-2771/4337 통합) | 낮음 (필드 1개 설정) |
| TX 수 | 1-2회 | 1회 |
| 가스/수수료 오버헤드 | 높음 (Relayer 가스 + 컨트랙트 호출) | 없음 (기본 수수료만) |
| 개발 기간 | 2-4주 | 0주 (기본 기능) |

---

## 2. Finality 속도

### EVM 확정 시간

```
EVM (Ethereum PoS):
  블록 생성: ~12초
  안전한 확정: 15 confirmation = 15 x 12초 = ~3분
  경제적 확정 (finalized): 2 epoch = ~13분

  실제 Dagaon Core EVM 설정:
  Event Confirmer에서 15 confirmation 대기 → ~3-5분
```

### Solana 확정 시간

```
Solana:
  슬롯 생성: ~400ms
  finalized commitment: ~32슬롯 = ~13초

  Dagaon Core Solana 설정:
  finalized에서 직접 읽기 → ~13초 (추가 대기 없음)
```

### 정량적 개선

| 항목 | EVM | Solana | 개선 |
|------|-----|--------|------|
| 입금 확정 시간 | ~3-5분 | ~13초 | **약 15-23배 빠름** |
| 사용자 경험 | "입금 확인 중... (약 5분 소요)" | "입금 확인 중... (약 15초 소요)" | 체감 즉시 확정 |
| 파이프라인 단계 | 5단계 (Confirmer 포함) | 4단계 (Confirmer 생략) | 단순화 |
| 아비트라지 리스크 | 5분 동안 가격 변동 노출 | 15초 동안만 노출 | **리스크 감소** |

---

## 3. Reorg 리스크

### EVM의 reorg 대응

```
EVM:
  - 15 confirmation 대기로도 이론적 reorg 가능성 존재 (극히 낮지만 0은 아님)
  - Event Confirmer가 reorg 감지 시 이벤트 취소 로직 필요
  - RingBuffer로 최근 블록 해시 추적
  - reorg 발생 시 복구 로직 (영향받는 입금 재검증)

실제 코드 복잡성:
  - ReorgDetector 클래스
  - ReorgRecovery 핸들러
  - 이벤트 취소/재확정 상태 머신
  - 테스트 작성의 어려움 (reorg 시뮬레이션)
```

### Solana의 reorg 상황

```
Solana:
  - finalized에서 reorg: 역사상 0건, 경제적으로 불가능
  - ReorgDetector: 방어적으로 유지하되 실제 트리거 안 됨
  - ReorgRecovery: 불필요
  - 이벤트 취소 로직: 불필요

제거할 수 있는 코드:
  - Event Confirmer 전체 (ADR-4)
  - Reorg 복구 핸들러
  - Confirmation 카운트 추적
```

### 정량적 개선

| 항목 | EVM | Solana | 개선 |
|------|-----|--------|------|
| Finalized 블록 reorg 확률 | 극히 낮음 (> 0) | 사실상 0 (= 0) | **이론적 리스크 제거** |
| Reorg 대응 코드 | 필요 | 불필요 | 코드 복잡도 감소 |
| 이중 지불 리스크 | 이론적 존재 | 사실상 없음 | **보안 향상** |

---

## 4. 원자적 배칭 (Atomic Batching)

### EVM의 제약

```
EVM에서 여러 작업을 원자적으로 처리하려면:

방법 1: 각 작업을 별도 TX로 전송
  TX1: approve(spender, amount)
  TX2: transferFrom(from, to, amount)
  → 2개 TX, TX1 성공 + TX2 실패 가능 (비원자적)
  → 가스비 2배

방법 2: Multicall 컨트랙트 사용
  Multicall.aggregate([call1, call2, ...])
  → 커스텀 컨트랙트 배포 필요
  → 가스 오버헤드

방법 3: 배치 전송 컨트랙트
  BatchTransfer.batchSend([{to, amount}, ...])
  → 커스텀 컨트랙트 배포 필요
  → ERC-20마다 approve 필요
```

### Solana의 방식

```
Solana TX는 여러 instruction을 포함할 수 있다:

const tx = new Transaction()
tx.add(
  instruction1,  // ATA 생성
  instruction2,  // SOL 전송
  instruction3,  // SPL 토큰 전송
  instruction4,  // 다른 SPL 토큰 전송
)
// 모든 instruction이 원자적으로 실행
// 하나라도 실패하면 전체 롤백 (수수료는 부과)

→ 커스텀 컨트랙트 불필요
→ 단일 TX = 단일 수수료
→ 원자적 보장
```

### 정량적 개선

| 항목 | EVM | Solana | 개선 |
|------|-----|--------|------|
| 다중 작업 원자성 | 컨트랙트 필요 | 네이티브 지원 | **인프라 불필요** |
| ATA 생성 + 전송 | 2 TX (또는 커스텀 컨트랙트) | 1 TX | **TX 수 절반** |
| 배치 전송 | 커스텀 컨트랙트 | 네이티브 instruction 배칭 | **수수료 절감** |
| 실패 시 부분 실행 | 가능 (비원자적 시) | 불가 (전체 롤백) | **안전성 향상** |

---

## 5. 로컬 수수료 시장 (Local Fee Markets)

### EVM의 글로벌 수수료 시장

```
EVM (특히 Ethereum):
  - 모든 TX가 동일한 블록 공간을 두고 경쟁
  - NFT 민팅 이벤트 → 전체 네트워크 가스비 폭등
  - 우리 서비스와 무관한 트래픽이 우리 TX 수수료에 직접 영향
  - Base fee는 네트워크 전체 수요에 의해 결정

  예시: 2024년 NFT 민팅 시 가스비 100 gwei → 200 gwei 급등
  → 우리 출금 TX도 수수료 2배 지불
```

### Solana의 로컬 수수료 시장

```
Solana:
  - 수수료는 해당 TX가 접근하는 계정(state)에 국한
  - DEX에서 인기 토큰 쌍의 수수료가 올라도, 우리 핫월렛 TX는 영향 없음
  - 로컬 수수료 시장 = 동일한 계정에 접근하는 TX끼리만 경쟁

  예시: Raydium SOL/USDC 풀 수수료 폭등
  → 우리 핫월렛 → 사용자 지갑 전송은 다른 계정이므로 수수료 무영향

  Base fee: 항상 5,000 lamports/서명 (고정)
  Priority fee: 접근하는 계정의 경쟁 상황에 따라 동적
```

### 정량적 개선

| 항목 | EVM | Solana | 개선 |
|------|-----|--------|------|
| 수수료 변동성 | 높음 (네트워크 전체 연동) | 낮음 (로컬 계정 기반) | **비용 예측 가능** |
| 외부 이벤트 영향 | 직접적 (NFT 민팅 → 가스비 폭등) | 간접적 (다른 계정이면 무관) | **비용 안정성** |
| Base fee | 동적 (EIP-1559) | 고정 (5,000 lamports) | **기본 비용 고정** |
| 수수료 예측 | 어려움 (다음 블록 base fee 예측 필요) | 쉬움 (Priority fee만 조정) | **운영 단순화** |

---

## 개선 요약

| 개선 영역 | EVM 대비 정량적 개선 | 운영 영향 |
|----------|--------------------|---------| 
| Fee Delegation | 추가 인프라 0, 개발 기간 0주 | 수수료 위임 로직 대폭 단순화 |
| Finality 속도 | 15-23배 빠름 (~13초 vs ~3-5분) | 입금 UX 개선, 파이프라인 단순화 |
| Reorg 리스크 | 사실상 0 (Event Confirmer 불필요) | 코드 복잡도 감소, 보안 향상 |
| 원자적 배칭 | 네이티브 지원 (커스텀 컨트랙트 불필요) | TX 수 절감, 수수료 절감 |
| 로컬 수수료 시장 | 외부 이벤트 영향 최소화 | 비용 예측 가능, 운영 안정화 |

이 개선점들은 Solana 통합의 추가적인 복잡성(nonce 풀 관리, 블록 볼륨, TX 재전송 등)을 상당 부분 상쇄한다. 특히 finality 속도와 fee delegation은 **사용자에게 직접 체감되는 개선**이므로 비즈니스 가치가 높다.
