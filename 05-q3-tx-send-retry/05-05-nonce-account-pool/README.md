# 5.5 Nonce 계정 풀 관리

상위 섹션: [5. Q3: TX 전송 및 재전송 방식](../README.md)

## 왜 풀이 필요한가

Solana에서 durable nonce를 사용한 동시 출금은 **nonce 계정 수에 의해 제한**된다. 하나의 nonce 계정은 한 번에 하나의 출금에만 사용할 수 있으므로, 동시 출금 10건을 처리하려면 최소 10개의 nonce 계정이 필요하다.

```
EVM:                                    Solana:
nonce = 42 → TX #42                    nonce_account_1 → TX #42
nonce = 43 → TX #43                    nonce_account_2 → TX #43
nonce = 44 → TX #44                    nonce_account_3 → TX #44
...                                     ...
→ 순차 카운터, 무한대               → 풀 크기 = 동시 처리 한도
→ head-of-line blocking 있음         → 각 TX 독립적, blocking 없음
```

## 풀 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                    Nonce Account Pool                        │
│                  (per hot wallet)                            │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐   │
│  │  nonce_account_1:  FREE      storedNonce: abc123...  │   │
│  │  nonce_account_2:  IN_USE    storedNonce: def456...  │ ←─── 출금 TX #42에 사용 중
│  │  nonce_account_3:  FREE      storedNonce: ghi789...  │   │
│  │  nonce_account_4:  IN_USE    storedNonce: jkl012...  │ ←─── 출금 TX #43에 사용 중
│  │  nonce_account_5:  FREE      storedNonce: mno345...  │   │
│  │  nonce_account_6:  DISABLED  storedNonce: (invalid)  │ ←─── 문제 발생, 사용 중지
│  │  ...                                                  │   │
│  │  nonce_account_N:  FREE      storedNonce: xyz999...  │   │
│  └──────────────────────────────────────────────────────┘   │
│                                                             │
│  Pool Stats:                                                │
│    Total: N accounts                                        │
│    Free: N-3   In Use: 2   Disabled: 1                     │
│    Utilization: 2/N (low)                                   │
│    Cost: N x 0.00144768 SOL (rent-exempt, refundable)      │
└─────────────────────────────────────────────────────────────┘
```

## 풀 사이징

### 결정 기준

핫월렛당 필요한 nonce 계정 수 = **피크 시간 동시 출금 수 + 버퍼**

```
예시 계산:

평균 동시 출금: 20건
피크 동시 출금: 50건 (이벤트, 시장 급변 시)
안전 버퍼: 20% 여유

필요 계정 수: 50 x 1.2 = 60개
초기 할당: 100개 (넉넉하게)
```

### 비용 계산

| 계정 수 | rent-exempt 비용 | 총 비용 (SOL) | USD (@$150/SOL) | 비고 |
|---------|-----------------|---------------|-----------------|------|
| 50개 | 0.00144768 SOL | 0.072 SOL | $10.84 | 최소 |
| 100개 | 0.00144768 SOL | 0.145 SOL | $21.71 | 권장 |
| 200개 | 0.00144768 SOL | 0.289 SOL | $43.43 | 대규모 |
| 500개 | 0.00144768 SOL | 0.724 SOL | $108.58 | 최대 |

**핵심**: rent-exempt 비용은 nonce 계정을 닫을 때 **전액 환불**된다. 따라서 이는 "보증금"에 가까우며, 실질적인 비용은 계정 생성 TX 수수료(~0.000005 SOL x N)뿐이다.

## 상태 전이

```
                 ┌──────────────────────────┐
                 │       CREATE             │
                 │  (CreateAccount +        │
                 │   InitializeNonce)       │
                 └────────────┬─────────────┘
                              │
                              v
                 ┌──────────────────────────┐
       ┌────────>│         FREE             │<────────┐
       │         │  (사용 가능 상태)          │         │
       │         └────────────┬─────────────┘         │
       │                      │                        │
       │            출금 요청 발생                       │
       │         (tx-preparer가 할당)                   │
       │                      │                        │
       │                      v                        │
       │         ┌──────────────────────────┐         │
       │         │        IN_USE            │         │
       │         │  (출금 TX에 사용 중)       │         │
       │         └──────┬──────────┬────────┘         │
       │                │          │                   │
       │         TX 확인됨      TX 드롭/실패           │
       │         (FINALIZED)    + 재시도 후 확인        │
       │                │          │                   │
       │                v          v                   │
       │         nonce 계정 반환                        │
       └───────── (status = FREE) ────────────────────┘
                              
                              
       문제 발생 시:
       ┌──────────────────────────┐
       │       DISABLED           │
       │  (수동 복구 필요)         │
       │  - storedNonce 불일치    │
       │  - authority 문제        │
       │  - rent 부족             │
       └────────────┬─────────────┘
                    │
              수동 복구 후
                    │
                    v
              FREE로 복원
```

### 상태 전이 규칙

| 현재 상태 | 이벤트 | 다음 상태 | 조건 |
|-----------|--------|----------|------|
| - | 계정 생성 | FREE | CreateAccount + InitializeNonce 성공 |
| FREE | tx-preparer 할당 | IN_USE | `FOR UPDATE SKIP LOCKED`로 원자적 할당 |
| IN_USE | TX finalized | FREE | `getSignatureStatuses` = finalized |
| IN_USE | TX 드롭 + 재전송 성공 | FREE | 재전송된 TX가 finalized |
| IN_USE | TX 실패 + nonce advance | FREE | advance 후 새 storedNonce 확인 |
| IN_USE | 비정상 (타임아웃) | DISABLED | 30분 이상 IN_USE 상태 유지 |
| DISABLED | 수동 복구 | FREE | 관리자가 storedNonce 확인 후 복원 |

## 동적 확장

풀 사용률이 임계치를 넘으면 자동으로 nonce 계정을 추가 생성한다.

### 확장 전략

```
모니터링 루프 (30초마다):

  utilization = IN_USE / (FREE + IN_USE)
  
  if utilization > 80%:
    new_accounts = max(10, total * 0.2)  // 최소 10개 또는 현재의 20%
    create_nonce_accounts(new_accounts)
    alert("Nonce pool expanded: +{new_accounts} accounts")
    
  if utilization > 95%:
    alert_critical("Nonce pool near exhaustion!")
    // 긴급: 즉시 대량 생성
    create_nonce_accounts(50)
    
  if FREE == 0:
    alert_page("Nonce pool exhausted! Withdrawals blocked!")
    // 출금 요청은 큐에 대기
```

### 축소 (선택사항)

```
사용률이 장기간(24시간+) 20% 미만:
  excess = FREE - (IN_USE * 3)  // 최소 IN_USE의 3배는 유지
  if excess > 20:
    // 초과분의 nonce 계정을 닫고 SOL 회수
    close_nonce_accounts(excess - 20)  // 20개 여유 유지
    // WithdrawNonceAccount로 rent-exempt SOL 회수
```

## 모니터링 지표

| 지표 | 설명 | 알림 임계치 |
|------|------|------------|
| `nonce_pool_total` | 전체 nonce 계정 수 | - |
| `nonce_pool_free` | FREE 상태 계정 수 | < 10: WARN |
| `nonce_pool_in_use` | IN_USE 상태 계정 수 | - |
| `nonce_pool_disabled` | DISABLED 상태 계정 수 | > 0: WARN |
| `nonce_pool_utilization` | IN_USE / (FREE + IN_USE) | > 80%: WARN, > 95%: CRITICAL |
| `nonce_allocation_wait_ms` | 할당 대기 시간 | > 1000ms: WARN |
| `nonce_stuck_in_use_count` | 30분+ IN_USE 상태 | > 0: WARN |
| `nonce_expansion_events` | 풀 확장 횟수 (1시간) | > 3: WARN (급격한 사용 증가) |

## 복구: IN_USE stuck 계정 처리

nonce 계정이 `IN_USE` 상태에서 오랫동안 빠져나오지 못하는 경우:

### 원인 분석 플로우

```
IN_USE 30분 이상 stuck
        │
        v
  storedNonce 확인 (getAccountInfo)
        │
   ┌────┴────┐
   │         │
  변경됨    동일
   │         │
   v         v
  TX가 온체인에서  TX가 드롭됨
  처리되었으나       │
  DB 미갱신         │
   │         ┌──────┴──────┐
   v         │             │
  DB 상태    연관 TX 재전송   nonce advance
  수동 갱신   시도          + 새 TX 생성
  → FREE     │             │
             v             v
           성공 시 FREE   성공 시 FREE
```

### 자동 복구 스크립트

```
tx-monitor 내 stuck 복구 로직 (의사코드):

function recoverStuckNonceAccounts():
  stuckAccounts = SELECT * FROM nonce_accounts 
    WHERE status = 'IN_USE' 
    AND updated_at < NOW() - INTERVAL '30 minutes'
  
  for each account in stuckAccounts:
    // 1. 온체인 storedNonce 확인
    onchainNonce = getStoredNonce(account.pubkey)
    
    if onchainNonce != account.stored_nonce:
      // TX가 처리되었음 → DB만 갱신
      UPDATE nonce_accounts SET 
        status = 'FREE', 
        stored_nonce = onchainNonce 
      WHERE id = account.id
      log("Recovered: nonce changed on-chain")
      continue
    
    // 2. 연관 TX 확인
    tx = SELECT * FROM transactions WHERE nonce_account_id = account.id
    if tx.status == 'COMPLETED':
      // 이미 완료됨 → DB만 갱신
      UPDATE nonce_accounts SET status = 'FREE' WHERE id = account.id
      continue
    
    // 3. TX 드롭 판단 → nonce advance로 무효화
    advanceTx = buildAdvanceNonceTx(account.pubkey)
    sendAndConfirm(advanceTx)
    
    newNonce = getStoredNonce(account.pubkey)
    UPDATE nonce_accounts SET 
      status = 'FREE', 
      stored_nonce = newNonce 
    WHERE id = account.id
    
    // 4. 원래 출금 요청을 새로 처리
    UPDATE withdrawal_requests SET status = 'PENDING' WHERE id = tx.withdrawal_id
    log("Recovered: nonce advanced, withdrawal re-queued")
```

## DB 스키마

### nonce_accounts 테이블

```sql
CREATE TABLE nonce_accounts (
  id              BIGSERIAL PRIMARY KEY,
  
  -- 식별 정보
  hot_wallet_id   BIGINT NOT NULL REFERENCES hot_wallets(id),
  pubkey          VARCHAR(44) NOT NULL UNIQUE,       -- base58 주소
  authority       VARCHAR(44) NOT NULL,               -- authority 공개키
  
  -- 상태 관리
  status          VARCHAR(10) NOT NULL DEFAULT 'FREE' 
                  CHECK (status IN ('FREE', 'IN_USE', 'DISABLED')),
  stored_nonce    VARCHAR(44),                        -- 현재 storedNonce (base58)
  
  -- 할당 추적
  current_tx_id   BIGINT REFERENCES transactions(id), -- IN_USE일 때 연관 TX
  allocated_at    TIMESTAMPTZ,                        -- IN_USE 시작 시간
  
  -- 감사 추적
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  disabled_reason TEXT,                               -- DISABLED 사유
  
  -- 인덱스
  CONSTRAINT idx_nonce_status_wallet 
    UNIQUE (hot_wallet_id, status, id)                -- 풀 할당 쿼리 최적화
);

-- 할당 쿼리용 인덱스
CREATE INDEX idx_nonce_free ON nonce_accounts(hot_wallet_id, status) 
  WHERE status = 'FREE';

-- stuck 감지용 인덱스
CREATE INDEX idx_nonce_stuck ON nonce_accounts(allocated_at) 
  WHERE status = 'IN_USE';
```

### 할당 쿼리 (tx-preparer)

```sql
-- 원자적 nonce 계정 할당
-- FOR UPDATE SKIP LOCKED: 다른 tx-preparer 인스턴스와 충돌 방지
UPDATE nonce_accounts
SET 
  status = 'IN_USE',
  current_tx_id = :tx_id,
  allocated_at = NOW(),
  updated_at = NOW()
WHERE id = (
  SELECT id FROM nonce_accounts
  WHERE hot_wallet_id = :hot_wallet_id
    AND status = 'FREE'
  ORDER BY id
  LIMIT 1
  FOR UPDATE SKIP LOCKED
)
RETURNING *;
```

### 반환 쿼리 (tx-monitor)

```sql
-- TX 완료 후 nonce 계정 반환
UPDATE nonce_accounts
SET 
  status = 'FREE',
  current_tx_id = NULL,
  allocated_at = NULL,
  stored_nonce = :new_stored_nonce,  -- 온체인에서 조회한 새 nonce 값
  updated_at = NOW()
WHERE id = :nonce_account_id
  AND status = 'IN_USE';
```

### transactions 테이블 (Solana 확장)

```sql
-- 기존 transactions 테이블에 Solana 전용 컬럼 추가
ALTER TABLE transactions ADD COLUMN IF NOT EXISTS
  nonce_account_id    BIGINT REFERENCES nonce_accounts(id);

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS
  stored_nonce_used   VARCHAR(44);      -- TX에 사용된 storedNonce

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS
  tx_signature        VARCHAR(88);      -- Solana TX signature (base58)

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS
  retry_count         INT DEFAULT 0;    -- 재전송 횟수

ALTER TABLE transactions ADD COLUMN IF NOT EXISTS
  priority_fee        BIGINT DEFAULT 0; -- micro-lamports per compute unit
```

## 전체 풀 관리 흐름

```
┌────────────────────────────────────────────────────────────────────┐
│  시스템 시작                                                        │
│                                                                    │
│  1. hot_wallet 목록 조회                                            │
│  2. 각 hot_wallet별:                                               │
│     a. 기존 nonce 계정 로드 (DB)                                    │
│     b. 온체인 storedNonce와 동기화 (getMultipleAccounts)             │
│     c. IN_USE + 30분 이상 stuck → 복구 프로세스                      │
│     d. 부족하면 추가 생성                                           │
│  3. 모니터링 루프 시작                                              │
└────────────────────────────────────────────────────────────────────┘
        │
        v
┌────────────────────────────────────────────────────────────────────┐
│  정상 운영 루프                                                     │
│                                                                    │
│  tx-preparer:                                                      │
│    출금 요청 → nonce 할당 (FOR UPDATE SKIP LOCKED)                  │
│    → storedNonce 조회 → TX 빌드 → tx-signer로 전달                  │
│                                                                    │
│  tx-sender:                                                        │
│    서명된 TX → sendTransaction → 2초 재전송 루프                     │
│    → confirmed 시 tx-monitor로 전달                                 │
│                                                                    │
│  tx-monitor:                                                       │
│    finalized 확인 → nonce 계정 반환 (FREE)                          │
│    stuck 감지 → 복구 프로세스                                       │
│                                                                    │
│  pool-monitor (30초마다):                                          │
│    사용률 체크 → 80% 이상 시 확장 → 알림                            │
└────────────────────────────────────────────────────────────────────┘
```

## 참고 자료

- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- System Program: https://solana.com/docs/core/accounts#system-program
