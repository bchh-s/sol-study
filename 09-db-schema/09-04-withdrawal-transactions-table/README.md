# 9.4 solana_withdrawal_transactions 테이블

상위 섹션: [9. DB 스키마 영향](../README.md)

## 전체 DDL

```sql
CREATE TABLE solana_withdrawal_transactions (
  id                    BIGINT       AUTO_INCREMENT PRIMARY KEY,
  request_id            BIGINT       NOT NULL COMMENT '출금 요청 ID (비즈니스 레이어에서 발급)',
  chain_id              BIGINT       NOT NULL COMMENT 'Solana 네트워크 식별',

  -- 주소 정보
  fee_payer_address     VARCHAR(44)  NOT NULL COMMENT '수수료 납부자 주소 (핫월렛)',
  from_address          VARCHAR(44)  NOT NULL COMMENT '자산 출금 주소',
  to_address            VARCHAR(44)  NOT NULL COMMENT '수신자 주소',
  mint_address          VARCHAR(44)  NULL     COMMENT 'SPL token mint 주소 (SOL이면 NULL)',

  -- 금액
  amount                VARCHAR(100) NOT NULL COMMENT '전송 수량 (정수 문자열, lamports/raw amount)',

  -- Solana 고유 필드: Durable Nonce
  durable_nonce_account VARCHAR(44)  NULL     COMMENT '할당된 durable nonce 계정 주소',
  nonce_value           VARCHAR(44)  NULL     COMMENT '사용된 stored nonce 값 (AdvanceNonce 전 값)',

  -- Solana 고유 필드: Compute Unit (수수료)
  compute_unit_limit    INT          NULL     COMMENT 'Compute Unit 한도 (기본 200,000)',
  compute_unit_price    BIGINT       NULL     COMMENT 'Compute Unit 당 가격 (micro-lamports)',

  -- 서명/직렬화
  tx_signature          VARCHAR(88)  NULL     COMMENT '서명 후 생성되는 TX 식별자',
  signed_tx             TEXT         NULL     COMMENT 'base64 인코딩된 직렬화 서명 TX',

  -- 상태 관리
  status                TINYINT      NOT NULL DEFAULT 1 COMMENT '1=PENDING, 2=SIGNED, 3=BROADCASTED, 4=RETRIED, 5=COMPLETED, 6=DROPPED, 7=FAILED',
  error_message         VARCHAR(500) NULL     COMMENT '실패 시 에러 메시지',
  retry_count           INT          NOT NULL DEFAULT 0 COMMENT '재전송 횟수',
  max_retries           INT          NOT NULL DEFAULT 5 COMMENT '최대 재전송 횟수',

  -- 타임스탬프
  retry_at              TIMESTAMP    NULL     COMMENT '다음 재시도 예정 시간',
  signed_at             TIMESTAMP    NULL     COMMENT '서명 완료 시간',
  broadcasted_at        TIMESTAMP    NULL     COMMENT '브로드캐스트 시간',
  confirmed_at          TIMESTAMP    NULL     COMMENT 'finalized 확인 시간',
  created_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- 인덱스
  INDEX idx_request_id (request_id),
  INDEX idx_fee_payer (fee_payer_address),
  INDEX idx_tx_signature (tx_signature),
  INDEX idx_status_retry (status, retry_at),
  INDEX idx_chain_status (chain_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Solana 출금 트랜잭션 관리 - tx-ticketer부터 tx-monitor까지의 생명주기';
```

## EVM withdrawal_transactions와의 비교

### 제거된 EVM 필드

| EVM 필드 | 왜 제거? |
|---------|---------|
| `nonce` (BIGINT) | Solana에는 순차 정수 nonce가 없음. durable nonce로 대체 |
| `gas_limit` (BIGINT) | Solana는 gas 모델이 아님. compute_unit_limit으로 대체 |
| `max_fee_per_gas` (VARCHAR) | EIP-1559 모델. Solana는 compute_unit_price로 대체 |
| `max_priority_fee_per_gas` (VARCHAR) | EIP-1559 모델. Solana는 priority fee가 compute_unit_price에 통합 |
| `gas_used` (BIGINT) | Solana는 실행 후 compute units consumed를 반환하지만 별도 저장 불필요 |

### 추가된 Solana 필드

#### durable_nonce_account + nonce_value

```
EVM 출금 흐름:
  1. tx-ticketer: nonce = atomic_increment(wallet.current_nonce)
  2. nonce를 TX에 포함하여 서명
  3. 같은 nonce로 replacement TX 가능 (gas bump)

Solana 출금 흐름:
  1. tx-ticketer: nonce_account = pool에서 FREE 계정 획득 (SELECT ... FOR UPDATE SKIP LOCKED)
  2. nonce_value = nonce_account의 현재 stored_nonce 조회
  3. TX의 recentBlockhash에 nonce_value를 사용
  4. AdvanceNonceAccount instruction을 TX 첫 번째에 포함
  5. 서명 -> 브로드캐스트
  6. 완료 후 nonce_account를 FREE로 반환
```

`durable_nonce_account`와 `nonce_value`를 TX 레코드에 저장하는 이유:
- TX 실패/드롭 시 어떤 nonce 계정을 사용했는지 추적
- nonce_value가 advance되었는지 확인 (advance 되면 TX가 포함되었거나 만료됨)
- 디버깅/감사 목적

#### compute_unit_limit + compute_unit_price

```
EVM 수수료:
  fee = gasUsed * (baseFee + priorityFee)
  사용자가 제어: gas_limit, max_fee_per_gas, max_priority_fee_per_gas

Solana 수수료:
  base_fee = 5,000 lamports (고정, 서명 수 기반)
  priority_fee = compute_unit_limit * compute_unit_price / 1,000,000
  총 수수료 = base_fee + priority_fee
```

| 항목 | 설명 | 기본값 |
|------|------|-------|
| compute_unit_limit | TX가 사용할 수 있는 최대 compute units | 200,000 (단일 instruction) |
| compute_unit_price | compute unit당 가격 (micro-lamports) | 0 (priority fee 없이) |

실제 비용 계산 예시:
```
compute_unit_limit = 200,000
compute_unit_price = 50,000 (micro-lamports)
priority_fee = 200,000 * 50,000 / 1,000,000 = 10,000 lamports = 0.00001 SOL
base_fee = 5,000 lamports
총 수수료 = 15,000 lamports = 0.000015 SOL
```

### fee_payer_address vs relayer_address

```
EVM:
  relayer_address = 없음 (sender가 직접 gas 지불)
  또는 meta-tx 패턴에서 relayer가 gas 지불 (복잡)
  from_address = gas 지불자 = sender

Solana:
  fee_payer_address = TX의 첫 번째 서명자 (수수료 납부)
  from_address = 실제 자산 보유 주소 (다를 수 있음)

  fee delegation이 네이티브로 지원되므로:
  - fee_payer = 핫월렛 (SOL로 수수료 납부)
  - from_address = 출금 지갑 (자산 보유)
  - 두 주소가 같을 수도, 다를 수도 있음
```

## 상태 머신 (Status Machine)

```
                    +-- 7=FAILED (서명 실패, 시뮬레이션 실패)
                    |
1=PENDING --> 2=SIGNED --> 3=BROADCASTED --> 5=COMPLETED
                              |        ^
                              |        |
                              +-> 4=RETRIED (재브로드캐스트)
                              |
                              +-> 6=DROPPED (nonce advance됨 but TX 미포함,
                                             또는 max_retries 초과)
```

### 상태 전이 상세

| 전이 | 조건 | 동작 |
|------|------|------|
| PENDING -> SIGNED | tx-signer가 KMS 서명 완료 | tx_signature, signed_tx 저장, signed_at 기록 |
| PENDING -> FAILED | 시뮬레이션 실패 또는 서명 에러 | error_message 저장, nonce 계정 반환 |
| SIGNED -> BROADCASTED | sendTransaction 성공 | broadcasted_at 기록 |
| BROADCASTED -> COMPLETED | getSignatureStatuses: finalized | confirmed_at 기록, nonce 계정 반환 |
| BROADCASTED -> RETRIED | 일정 시간 내 미확인 | retry_count++, retry_at 갱신, 재전송 |
| RETRIED -> COMPLETED | 재전송 후 finalized 확인 | 동일 |
| RETRIED -> DROPPED | max_retries 초과 또는 nonce advance 감지 | nonce 계정 반환, 수동 개입 필요 |
| BROADCASTED -> DROPPED | nonce가 이미 advance됨 but TX 미포함 | 매우 드문 케이스 |

### EVM과의 상태 전이 차이

```
EVM:
  PENDING -> SIGNED -> BROADCASTED -> COMPLETED
                          |
                          +-> GAS_BUMPED (같은 nonce로 더 높은 gas의 replacement TX)
                          |
                          +-> STUCK (nonce gap이나 low gas로 mempool에 정체)

  - mempool에 TX가 머무름 -> 언젠가 채굴되거나 replacement 가능
  - 순차 nonce이므로 "이전 TX가 처리될 때까지" 다음 TX 대기

Solana:
  PENDING -> SIGNED -> BROADCASTED -> COMPLETED
                          |
                          +-> RETRIED (동일 TX를 재브로드캐스트)
                          |
                          +-> DROPPED (TX가 리더에게 도달하지 못하고 소실)

  - mempool이 없음 -> TX가 현재 리더에게 도달하지 못하면 그냥 사라짐
  - replacement TX 개념 없음 (nonce가 advance되면 같은 nonce의 TX는 무효)
  - 재전송 = 완전히 동일한 TX를 다시 보내는 것 (idempotent)
```

### DROPPED 처리 전략

```
TX가 drop된 경우:
  1. durable nonce가 아직 advance되지 않았다면:
     - 같은 signed_tx를 다시 sendTransaction으로 재전송
     - 동일 nonce_value를 사용하므로 중복 실행 불가능 (idempotent)

  2. durable nonce가 advance되었다면:
     a. TX가 온체인에 포함됨 -> COMPLETED로 전이
     b. TX가 포함되지 않았는데 nonce가 advance됨 -> 비정상 상황
        - nonce 계정이 다른 TX에 의해 advance된 경우 (보안 이슈 가능)
        - 수동 개입 필요, DROPPED + 알림
```

## signed_tx 크기 고려사항 (TEXT vs VARCHAR)

```
Solana TX 최대 크기: 1,232 bytes (하드 리밋)
base64 인코딩: ceil(1232 * 4/3) = 1,644 bytes

VARCHAR(2000)으로 충분하지만 TEXT를 사용하는 이유:
1. 향후 TX versioning으로 크기 제한이 변경될 가능성
2. MySQL에서 TEXT는 row 외부에 저장되어 row 크기 제한(65,535 bytes)에 영향 적음
3. 이 컬럼은 조회보다 삽입/업데이트 위주이므로 TEXT의 성능 페널티가 미미

대안: VARBINARY(2000)로 원본 바이트 저장
  - base64 인코딩/디코딩 오버헤드 제거
  - 하지만 디버깅 시 가독성이 떨어짐
```

## 핵심 쿼리 패턴

```sql
-- tx-sender: 서명 완료된 TX 중 미브로드캐스트 건 조회
SELECT * FROM solana_withdrawal_transactions
WHERE chain_id = 900 AND status = 2  -- SIGNED
ORDER BY created_at
LIMIT 10;

-- tx-monitor: 브로드캐스트 후 미확인 건 조회 (재시도 대상)
SELECT * FROM solana_withdrawal_transactions
WHERE chain_id = 900 AND status IN (3, 4)  -- BROADCASTED or RETRIED
AND retry_at <= NOW()
ORDER BY retry_at
LIMIT 10;

-- 특정 요청의 TX 상태 추적
SELECT * FROM solana_withdrawal_transactions
WHERE request_id = 12345
ORDER BY created_at DESC;

-- fee_payer별 미완료 TX 수 (부하 분산)
SELECT fee_payer_address, COUNT(*) AS pending_count
FROM solana_withdrawal_transactions
WHERE chain_id = 900 AND status IN (1, 2, 3, 4)
GROUP BY fee_payer_address;
```

## 실습/검증 과제

- [ ] durable nonce 기반 TX의 전체 생명주기를 devnet에서 실행
- [ ] signed_tx의 실제 base64 크기가 TEXT 컬럼으로 충분한지 확인
- [ ] status 전이가 올바르게 동작하는지 상태 머신 단위 테스트 설계
- [ ] retry_at 인덱스가 tx-monitor 쿼리에서 효과적으로 사용되는지 EXPLAIN으로 확인
- [ ] fee_payer_address와 from_address가 다른 경우의 TX 구성 확인
