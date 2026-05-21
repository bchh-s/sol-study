# ADR-3: DB 테이블 분리

상위 섹션: [12. Architecture Decision Records](../README.md)

---

## 상태

**Accepted** (2026-05)

## 맥락 (Context)

Dagaon Core에 Solana 체인을 추가할 때, 블록/트랜잭션/이벤트 데이터를 기존 EVM 테이블에 저장할지, Solana 전용 테이블을 새로 만들지 결정해야 한다.

EVM과 Solana의 데이터 모델은 근본적으로 다르다:

| 필드 | EVM | Solana | 호환성 |
|------|-----|--------|--------|
| 블록 식별자 | `block_number` (순차 정수) | `slot` (비순차, 빈 슬롯 존재) | 의미 다름 |
| 블록 해시 | 32 bytes hex (66자) | 32 bytes base58 (44자) | 인코딩 다름 |
| TX 식별자 | `tx_hash` 32 bytes hex | `signature` 64 bytes base58 (88자) | 길이+인코딩 다름 |
| 주소 | 20 bytes hex (42자) | 32 bytes base58 (44자) | 길이+인코딩 다름 |
| 수수료 | gas_price x gas_used (wei) | lamports (고정 base + priority) | 계산 방식 다름 |
| nonce | 계정 순차 번호 | durable nonce (계정 기반) | 완전히 다른 개념 |
| 이벤트 위치 | log_index | instruction_index + inner_index | 구조 다름 |
| 실행 단위 | gas | compute units | 단위 다름 |
| 토큰 전송 감지 | event log (Transfer) | balance diff (pre/post) | 방식 다름 |
| confirmation | block confirmations | commitment level | 메커니즘 다름 |

## 결정 (Decision)

**Solana 전용 데이터베이스 테이블을 새로 생성한다. 기존 EVM 테이블은 일체 변경하지 않는다.**

### 신규 테이블 목록

```sql
-- 블록(슬롯) 데이터
CREATE TABLE solana_blocks (
  id              BIGSERIAL PRIMARY KEY,
  slot            BIGINT NOT NULL UNIQUE,
  blockhash       VARCHAR(88) NOT NULL,
  parent_slot     BIGINT NOT NULL,
  parent_hash     VARCHAR(88) NOT NULL,
  block_time      BIGINT,                    -- Unix timestamp (nullable, 일부 슬롯에 없음)
  block_height    BIGINT,
  tx_count        INTEGER NOT NULL DEFAULT 0,
  status          VARCHAR(20) NOT NULL DEFAULT 'PROCESSED',
  created_at      TIMESTAMP DEFAULT NOW()
);

-- 트랜잭션(서명) 데이터
CREATE TABLE solana_transactions (
  id              BIGSERIAL PRIMARY KEY,
  signature       VARCHAR(128) NOT NULL UNIQUE,
  slot            BIGINT NOT NULL REFERENCES solana_blocks(slot),
  tx_index        INTEGER NOT NULL,          -- 블록 내 순서
  fee_lamports    BIGINT NOT NULL,
  compute_units   INTEGER,
  success         BOOLEAN NOT NULL,
  error_code      VARCHAR(100),
  signer          VARCHAR(44) NOT NULL,      -- fee payer
  created_at      TIMESTAMP DEFAULT NOW()
);

-- SOL/SPL 토큰 전송 이벤트
CREATE TABLE solana_transfers (
  id              BIGSERIAL PRIMARY KEY,
  signature       VARCHAR(128) NOT NULL,
  slot            BIGINT NOT NULL,
  instruction_index INTEGER NOT NULL,
  inner_index     INTEGER,                   -- inner instruction인 경우
  transfer_type   VARCHAR(20) NOT NULL,      -- 'SOL' | 'SPL'
  mint            VARCHAR(44),               -- SPL인 경우 토큰 mint 주소
  from_address    VARCHAR(44) NOT NULL,
  to_address      VARCHAR(44) NOT NULL,
  amount          NUMERIC(20,0) NOT NULL,    -- lamports 또는 token amount (정수)
  decimals        SMALLINT,                  -- SPL인 경우 토큰 decimals
  direction       VARCHAR(10) NOT NULL,      -- 'DEPOSIT' | 'WITHDRAWAL'
  status          VARCHAR(20) NOT NULL DEFAULT 'CONFIRMED',
  created_at      TIMESTAMP DEFAULT NOW(),
  UNIQUE (signature, instruction_index, inner_index)
);

-- 출금 TX append-only 로그
CREATE TABLE solana_withdrawal_log (
  id              BIGSERIAL PRIMARY KEY,
  withdrawal_id   BIGINT NOT NULL,           -- 출금 요청 ID
  signature       VARCHAR(128),
  nonce_account   VARCHAR(44),               -- 사용된 durable nonce 계정
  nonce_value     VARCHAR(88),               -- 사용된 nonce 값
  status          VARCHAR(30) NOT NULL,      -- CREATED, SIGNED, BROADCASTED, CONFIRMED, FAILED, CANCELLED
  fee_lamports    BIGINT,
  error_detail    TEXT,
  created_at      TIMESTAMP DEFAULT NOW()
);

-- Durable nonce 계정 풀
CREATE TABLE solana_nonce_accounts (
  id              BIGSERIAL PRIMARY KEY,
  nonce_pubkey    VARCHAR(44) NOT NULL UNIQUE,
  authority       VARCHAR(44) NOT NULL,      -- 핫월렛 authority
  current_nonce   VARCHAR(88),               -- 현재 nonce 값
  status          VARCHAR(20) NOT NULL DEFAULT 'AVAILABLE',
  assigned_tx_id  BIGINT,
  assigned_at     TIMESTAMP,
  created_at      TIMESTAMP DEFAULT NOW(),
  updated_at      TIMESTAMP DEFAULT NOW()
);

-- 인덱스
CREATE INDEX idx_sol_blocks_slot ON solana_blocks(slot);
CREATE INDEX idx_sol_tx_slot ON solana_transactions(slot);
CREATE INDEX idx_sol_transfers_addresses ON solana_transfers(to_address, status);
CREATE INDEX idx_sol_transfers_slot ON solana_transfers(slot);
CREATE INDEX idx_sol_nonce_status ON solana_nonce_accounts(authority, status);
CREATE INDEX idx_sol_withdrawal_log_wid ON solana_withdrawal_log(withdrawal_id);
```

## 근거 (Rationale)

### 1. 데이터 모델 불일치 해결

EVM 테이블에 Solana 데이터를 넣으려면 50% 이상의 컬럼이 NULL이거나 의미가 왜곡된다:

```
기존 blocks 테이블에 Solana 데이터를 넣는다면:
  block_number → slot (의미 유사하나, 빈 슬롯 처리 다름)
  block_hash   → blockhash (길이 다름: VARCHAR(66) → VARCHAR(88))
  gas_used     → NULL (Solana에는 없음)
  gas_limit    → NULL
  base_fee     → NULL
  nonce        → NULL (EVM의 miner nonce, Solana에는 해당 없음)

기존 transactions 테이블에 Solana 데이터를 넣는다면:
  tx_hash      → signature (길이 다름: VARCHAR(66) → VARCHAR(128))
  from_address → signer (길이 다름: VARCHAR(42) → VARCHAR(44))
  gas_price    → NULL
  gas_used     → NULL
  nonce        → NULL (EVM 계정 nonce vs Solana durable nonce, 완전히 다른 개념)
```

### 2. 기존 EVM 테이블 무변경 보장

ALTER TABLE로 컬럼을 추가하거나 타입을 변경하면:
- 기존 EVM 데이터에 영향을 줄 수 있음
- 기존 쿼리가 깨질 수 있음
- 마이그레이션 중 서비스 중단 리스크
- 롤백이 복잡함

Solana 전용 테이블은 기존 테이블과 완전히 독립적이므로:
- 기존 EVM 서비스에 영향 0
- 마이그레이션 = 새 테이블 CREATE (기존 테이블 건드리지 않음)
- 롤백 = 새 테이블 DROP (기존 데이터 무영향)

### 3. 쿼리 명확성

```sql
-- Solana 입금 조회 (명확)
SELECT * FROM solana_transfers WHERE to_address = ? AND direction = 'DEPOSIT';

-- vs 공유 테이블에서의 Solana 입금 조회 (혼란)
SELECT * FROM transfers WHERE chain = 'solana' AND to_address = ? AND direction = 'DEPOSIT';
-- 이 경우 address 길이, signature 길이 등이 EVM과 혼재
```

## 대안 검토 (Alternatives Considered)

### 대안 1: 공유 테이블 + nullable 컬럼

```sql
-- blocks 테이블에 Solana 컬럼 추가
ALTER TABLE blocks ADD COLUMN slot BIGINT;
ALTER TABLE blocks ADD COLUMN chain VARCHAR(20);
ALTER TABLE blocks ALTER COLUMN block_hash TYPE VARCHAR(88);  -- 길이 확장
-- ... 다수의 ALTER

문제:
- 50%+ NULL 컬럼 → 저장 공간 낭비, 쿼리 복잡
- VARCHAR(42) → VARCHAR(88) 변경 시 기존 인덱스 재구축
- chain 컬럼 추가로 모든 기존 쿼리에 WHERE chain = 'ethereum' 필요
- 기존 서비스 regression 리스크

폐기 이유: 기존 EVM 테이블에 대한 변경 리스크가 너무 큼.
```

### 대안 2: 다형성 단일 테이블 (Polymorphic)

```sql
-- 모든 체인의 블록을 하나의 테이블에
CREATE TABLE unified_blocks (
  id         BIGSERIAL PRIMARY KEY,
  chain      VARCHAR(20) NOT NULL,
  identifier VARCHAR(128) NOT NULL,  -- block_number 또는 slot
  hash       VARCHAR(128) NOT NULL,  -- block_hash 또는 blockhash
  metadata   JSONB NOT NULL,         -- 체인별 다른 필드를 JSON으로
  ...
);

문제:
- JSONB 컬럼은 인덱싱 비효율적
- 타입 안전성 상실 (체인별 필수 필드를 DB 레벨에서 강제할 수 없음)
- ORM/DTO 매핑이 복잡해짐
- 디버깅 어려움 (데이터가 JSON 안에 숨겨짐)

폐기 이유: 유지보수성, 타입 안전성, 쿼리 성능 모두 열화.
```

## 결과 (Consequences)

### 긍정적 결과

- **기존 EVM 무영향:** 새 테이블 추가만으로 마이그레이션 완료
- **깨끗한 스키마:** 각 체인에 최적화된 컬럼 타입과 제약 조건
- **독립적 인덱싱:** Solana 쿼리 패턴에 맞는 인덱스 설계
- **안전한 롤백:** 문제 시 Solana 테이블만 DROP
- **쿼리 명확성:** 테이블 이름만으로 체인 구분

### 부정적 결과 (수용한 trade-off)

- **테이블 수 증가:** 5-6개의 `solana_*` 테이블 추가
- **크로스 체인 쿼리 복잡:** "전체 입금 조회"에 UNION 또는 application-level 병합 필요
- **코드 중복 가능성:** EVM/Solana DAO 레이어에서 유사한 CRUD 로직 중복 → 공통 인터페이스로 완화
- **마이그레이션 관리:** 체인별 마이그레이션 파일 분리 필요

## 참고 자료

- [Solana RPC getBlock 응답 구조](https://solana.com/docs/rpc/http/getblock)
- [Solana RPC getTransaction 응답 구조](https://solana.com/docs/rpc/http/gettransaction)
- [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange)
