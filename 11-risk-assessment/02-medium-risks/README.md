# 중간 리스크

상위 섹션: [11. 리스크 평가](../README.md)

---

## Risk 4: ATA 라이프사이클 관리

### 근본 원인

Solana에서 SPL 토큰을 수신하려면 수신자의 **Associated Token Account(ATA)**가 해당 토큰 mint에 대해 미리 생성되어 있어야 한다. EVM에서는 ERC-20 전송 시 수신자 주소에 별도 계정 생성이 필요 없지만, Solana에서는 각 (지갑 주소, 토큰 mint) 쌍마다 별도의 ATA가 필요하다.

```
EVM:
  transfer(to, amount) → 바로 전송 가능 (계정 생성 불필요)

Solana:
  1. ATA 존재 확인: getAccountInfo(ata_address)
  2. ATA 없으면 → createAssociatedTokenAccount TX 먼저 실행
  3. 그 후 transfer instruction 실행
  (또는 createAssociatedTokenAccountIdempotent로 1TX에 통합)
```

### 영향도: MEDIUM

- ATA 미생성 상태에서 토큰 전송 시 TX 실패
- 대량 사용자에 대한 ATA 생성 비용 누적
- ATA 관리 실패 시 입금 누락 가능

### 발생 확률: MEDIUM

모든 SPL 토큰 입금/출금에서 발생하는 필수 과정이나, 올바른 구현으로 완화 가능.

### 비용 분석

```
ATA 생성 비용:
- rent-exempt 최소 잔액: ~0.00203928 SOL (165 bytes 토큰 계정)
- TX 수수료: 5,000 lamports (0.000005 SOL)
- 합계: ~0.002 SOL/ATA

규모별 비용:

| 사용자 수 | 토큰 종류 | ATA 수 | 비용 (SOL) | 비용 (USD, $200/SOL) |
|----------|----------|--------|-----------|---------------------|
| 1,000 | 3 | 3,000 | ~6.1 SOL | ~$1,220 |
| 10,000 | 3 | 30,000 | ~61 SOL | ~$12,200 |
| 100,000 | 3 | 300,000 | ~612 SOL | ~$122,400 |

참고: rent 비용은 ATA 폐쇄 시 전액 환불됨
```

### 완화 전략

#### Lazy 생성 전략

모든 사용자의 ATA를 미리 생성하지 않고, 실제 토큰 수신이 필요한 시점에 생성한다.

```
입금 시나리오 (사용자 → 거래소 입금 주소):
  1. 사용자별 입금 주소 생성 시: SOL 계정만 생성 (ATA 미생성)
  2. 사용자가 특정 토큰 입금 요청 시: 해당 토큰의 ATA 생성
  3. ATA 생성 비용: fee payer(핫월렛)가 부담

출금 시나리오 (거래소 → 사용자):
  1. 출금 TX 구성 시 수신자 ATA 존재 확인
  2. ATA 없으면 → createAssociatedTokenAccountIdempotent 명령을
     transfer 명령 앞에 추가 (단일 TX로 처리)
  3. ATA 생성 비용: fee payer(핫월렛)가 부담
```

#### 미사용 ATA 폐쇄로 rent 회수

```
[매일 배치 스캔]
  ↓
잔액 = 0 && 마지막 활동 > 30일인 ATA 조회
  ↓
closeAccount instruction 실행
  ↓
rent (~0.002 SOL) 환불 → fee payer 지갑으로
  ↓
DB에서 ATA 상태를 CLOSED로 업데이트

주의사항:
- 사용자가 다시 해당 토큰을 입금하면 ATA 재생성 필요
- 폐쇄 전 잔액이 정확히 0인지 반드시 확인
- 폐쇄 TX도 수수료(5,000 lamports) 소비
```

#### DB 상태 추적

```sql
CREATE TABLE solana_ata_accounts (
  id              BIGSERIAL PRIMARY KEY,
  wallet_address  VARCHAR(44) NOT NULL,     -- 소유자 지갑 주소
  mint_address    VARCHAR(44) NOT NULL,     -- 토큰 mint 주소
  ata_address     VARCHAR(44) NOT NULL,     -- ATA 주소 (PDA)
  status          VARCHAR(20) NOT NULL,     -- ACTIVE, CLOSED, PENDING_CREATE
  created_slot    BIGINT,
  closed_slot     BIGINT,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (wallet_address, mint_address)
);

-- 활성 ATA 조회 인덱스
CREATE INDEX idx_ata_active ON solana_ata_accounts(wallet_address, status)
  WHERE status = 'ACTIVE';
```

### 모니터링

| 메트릭 | 설명 | 알림 기준 |
|--------|------|----------|
| `ata_creation_failure_rate` | ATA 생성 실패 비율 | > 5% warn, > 15% critical |
| `ata_creation_cost_daily` | 일일 ATA 생성 비용 (SOL) | > 1 SOL warn |
| `ata_total_rent_locked` | 활성 ATA에 잠긴 총 rent | 정보성 (비용 추적) |
| `ata_close_reclaimed` | ATA 폐쇄로 회수한 rent | 정보성 |

---

## Risk 5: 실패 TX 수수료 회계

### 근본 원인

EVM에서는 트랜잭션이 revert되면 가스비가 소비되지만, EVM의 가스비는 실행량에 비례한다. Solana에서는 TX가 체인에 포함되면 **실행 결과와 무관하게** 기본 수수료(base fee)가 부과된다.

```
Solana TX 수수료 구조:
- Base fee: 서명 수 x 5,000 lamports (보통 1개 서명 = 5,000 lamports = 0.000005 SOL)
- Priority fee: compute_units x compute_unit_price (선택적)
- 실패한 TX도 base fee + priority fee 소비

예시:
  TX 성공: 5,000 lamports (base) + 1,000 lamports (priority) = 6,000 lamports 소비
  TX 실패: 5,000 lamports (base) + 1,000 lamports (priority) = 6,000 lamports 소비
  → 동일한 수수료 지출
```

### 영향도: LOW

- 금전적 영향: 5,000 lamports = 0.000005 SOL (~$0.001) -- 매우 적음
- 그러나 **잔액 추적 정확성**에 영향
  - 실패 TX의 수수료를 회계에 반영하지 않으면 DB 잔액과 온체인 잔액 불일치
  - 불일치 누적 시 reconciliation 실패

### 발생 확률: MEDIUM

TX 실패는 일상적으로 발생한다(insufficient balance, ATA 미존재, compute unit 초과 등). 실패 TX마다 수수료가 차감되므로 회계 처리가 필요하다.

### 완화 전략

#### TX 상태별 수수료 기록

```
TX 결과 수신 시:
  1. getTransaction(signature) 호출
  2. meta.fee 필드에서 실제 소비된 수수료 확인
  3. meta.err 필드로 성공/실패 판별
  4. DB에 기록:

  solana_tx_log:
  | tx_signature | status  | fee_lamports | fee_payer | error_code        |
  |-------------|---------|-------------|-----------|-------------------|
  | sig_abc123  | SUCCESS | 5000        | HotWlt1   | NULL              |
  | sig_def456  | FAILED  | 5000        | HotWlt1   | InsufficientFunds |
```

#### 잔액 reconciliation 로직

```
[매 시간 reconciliation 배치]
  ↓
DB 잔액 계산:
  초기 잔액
  + SUM(입금 금액)
  - SUM(출금 금액)
  - SUM(성공 TX 수수료)
  - SUM(실패 TX 수수료)    ← 이 부분이 누락되기 쉬움
  - SUM(ATA 생성 비용)
  - SUM(nonce 계정 생성 비용)
  = 예상 잔액
  ↓
온체인 잔액 조회: getBalance(hotWallet)
  ↓
|예상 잔액 - 온체인 잔액| > 임계값 → RECONCILIATION_MISMATCH 알림
```

#### 실패 원인별 분류 및 대응

| 실패 원인 | 재시도 여부 | 대응 |
|----------|-----------|------|
| `InsufficientFundsForRent` | X | ATA rent 부족 → fee payer 잔액 보충 |
| `InsufficientFunds` | X | 잔액 부족 → 출금 금액 재확인 |
| `AccountNotFound` | O | ATA 생성 후 재시도 |
| `BlockhashNotFound` | O | 새 blockhash/nonce로 재시도 |
| `ProgramFailedToComplete` | X | compute unit 초과 → CU 한도 증가 |
| `DuplicateSignature` | X | 이미 처리됨 → idempotency 처리 |

### 모니터링

| 메트릭 | 알림 기준 |
|--------|----------|
| `failed_tx_fee_total_daily` | > 0.01 SOL/일 warn (비정상적 실패 빈도) |
| `reconciliation_mismatch` | > 0 critical |
| `tx_failure_rate` | > 10% warn, > 25% critical |

---

## Risk 6: 주소 포맷 전환

### 근본 원인

EVM 주소와 Solana 주소는 근본적으로 다르다:

| 항목 | EVM | Solana |
|------|-----|--------|
| 인코딩 | hex (0x 접두사) | base58 |
| 길이 | 42자 (`0x` + 40 hex) | 32-44자 (base58 가변 길이) |
| 바이트 크기 | 20 bytes | 32 bytes |
| 체크섬 | EIP-55 mixed-case | 없음 (base58에 내장) |
| 예시 | `0x1234...abcd` | `9WzDXwBb...mZa8` |

### 영향도: MEDIUM

주소 포맷 변경은 시스템 전반에 영향을 미친다:
- DB 스키마: VARCHAR(42) → VARCHAR(44)
- API 응답: hex 주소 → base58 주소
- 입력값 검증: hex 패턴 → base58 패턴
- 로깅: 주소 형식 변경
- UI: 주소 표시 및 복사 기능
- 블록 익스플로러 링크: etherscan → solscan/solana explorer

### 발생 확률: LOW

이 리스크는 "발생할 수도 있는 것"이 아니라 **반드시 처리해야 하는 마이그레이션 작업**이다. 다만 올바른 설계(Solana 전용 테이블 분리)로 기존 EVM 테이블에 대한 영향을 완전히 제거할 수 있으므로 리스크 등급은 MEDIUM이다.

### 완화 전략: Solana 전용 테이블 분리

기존 EVM 테이블을 수정(ALTER)하지 않고, Solana 전용 테이블을 새로 생성한다.

```
기존 EVM 테이블 (변경 없음):
  blocks           → VARCHAR(66) block_hash, BIGINT block_number
  transfers        → VARCHAR(66) tx_hash, VARCHAR(42) from_address
  wallets          → VARCHAR(42) address

신규 Solana 테이블:
  solana_blocks    → VARCHAR(88) blockhash, BIGINT slot
  solana_transfers → VARCHAR(88) signature, VARCHAR(44) from_address
  solana_wallets   → VARCHAR(44) address
```

#### 검증 로직 변경

```
EVM 주소 검증:
  /^0x[0-9a-fA-F]{40}$/ (정규식)
  + EIP-55 체크섬 검증

Solana 주소 검증:
  1. base58 디코딩 가능 여부
  2. 디코딩 결과가 정확히 32 bytes인지
  3. 온체인 계정 존재 여부 (선택적)

  // base58 알파벳: 123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz
  // 0, O, I, l 제외 (혼동 방지)
  /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
```

#### API 레이어 분리

```
기존 EVM API (변경 없음):
  GET /api/v1/ethereum/deposits
  GET /api/v1/ethereum/withdrawals

신규 Solana API:
  GET /api/v1/solana/deposits
  GET /api/v1/solana/withdrawals

크로스 체인 통합 API (필요시):
  GET /api/v1/deposits?chain=solana
  → 내부적으로 체인별 테이블 조회 후 UNION
```

#### 로깅/모니터링 포맷 통일

```
로그 포맷에 chain 필드 추가:
  {
    "chain": "solana",
    "address": "9WzDXwBb...mZa8",
    "signature": "5K8Ld..."
  }

  vs 기존:
  {
    "chain": "ethereum",
    "address": "0x1234...abcd",
    "tx_hash": "0xabcd..."
  }
```

### 체크리스트

- [ ] Solana 전용 DB 테이블 DDL 작성
- [ ] base58 인코딩/디코딩 유틸리티 구현
- [ ] 주소 검증 함수 구현 (base58 + 32 bytes)
- [ ] API 엔드포인트에 chain 파라미터 추가
- [ ] 블록 익스플로러 링크 생성 함수 (solscan.io)
- [ ] 로그 포맷에 chain 필드 추가
- [ ] 기존 EVM 테이블/API 무변경 확인 (regression test)
