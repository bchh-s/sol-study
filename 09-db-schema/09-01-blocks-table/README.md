# 9.1 solana_blocks 테이블

상위 섹션: [9. DB 스키마 영향](../README.md)

## 전체 DDL

```sql
CREATE TABLE solana_blocks (
  chain_id          BIGINT       NOT NULL COMMENT 'Solana 네트워크 식별 (900=mainnet, 901=devnet, 902=testnet)',
  slot_number       BIGINT       NOT NULL COMMENT '슬롯 번호 (Solana의 기본 시간 단위)',
  block_height      BIGINT       NOT NULL COMMENT '블록 높이 (빈 슬롯 제외한 순차 번호)',
  blockhash         VARCHAR(44)  NOT NULL COMMENT 'base58 인코딩된 블록 해시 (32바이트)',
  previous_blockhash VARCHAR(44) NOT NULL COMMENT '이전 블록의 해시 (연결성 검증용)',
  parent_slot       BIGINT       NOT NULL COMMENT '부모 슬롯 번호 (빈 슬롯 건너뛰기 추적)',
  block_time        BIGINT       NOT NULL COMMENT 'Unix timestamp (초 단위, getBlockTime RPC 결과)',
  tx_count          INT          NOT NULL DEFAULT 0 COMMENT '블록 내 트랜잭션 수',
  status            TINYINT      NOT NULL DEFAULT 1 COMMENT '1=active (finalized 레벨에서 reorg 사실상 없음)',
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  PRIMARY KEY (chain_id, slot_number),
  INDEX idx_block_height (chain_id, block_height),
  INDEX idx_blockhash (chain_id, blockhash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Solana 블록(슬롯) 정보 - finalized commitment 레벨 데이터만 저장';
```

## 컬럼별 상세 비교: EVM blocks vs solana_blocks

### slot_number vs block_number

| 항목 | EVM `block_number` | Solana `slot_number` |
|------|-------------------|---------------------|
| 의미 | 블록 높이 (= 순차 번호) | 시간 슬롯 번호 (빈 슬롯 포함) |
| 연속성 | 항상 연속 (N, N+1, N+2, ...) | 비연속 (빈 슬롯 건너뜀) |
| 예시 | 18000000, 18000001, 18000002 | 250000000, 250000003, 250000004 (1,2 빈 슬롯) |
| PK 적합성 | block_number = 유일한 식별자 | slot_number = 유일한 식별자 (블록이 있는 슬롯만 저장) |

Solana에서 모든 슬롯이 블록을 생성하는 것은 아니다. 리더가 블록을 생산하지 못하면 빈 슬롯(skipped slot)이 된다. 따라서 `slot_number`는 비연속적이며, `getBlocks` RPC가 "실제 블록이 있는 슬롯 번호 목록"을 반환한다.

### block_height vs block_number (별도 컬럼인 이유)

EVM에서는 `block_number`가 곧 블록 높이다. Solana에서는:

```
slot_number:  100   101(빈)   102   103(빈)  104
block_height:  50    -         51    -        52
```

- `slot_number`: 시간축 (타임라인에서의 위치)
- `block_height`: 순차 높이 (빈 슬롯 제외)
- 두 값이 다르므로 별도 컬럼이 필요

`block_height`는 `getBlockHeight` RPC와 대응되며, "현재까지 생성된 블록 수"를 나타낸다.

### blockhash vs block_hash

| 항목 | EVM `block_hash` | Solana `blockhash` |
|------|-----------------|-------------------|
| 인코딩 | hex (0x 접두어, 66자) | base58 (최대 44자) |
| 바이트 크기 | 32 bytes (keccak256) | 32 bytes (SHA-256 기반) |
| 용도 | 블록 식별 | 블록 식별 + TX의 recent_blockhash로 사용 |
| VARCHAR 크기 | VARCHAR(66) | VARCHAR(44) |

Solana의 blockhash는 TX 생성 시 `recentBlockhash` 필드에 사용된다. 따라서 블록 식별 외에도 TX 만료 판단에 핵심적인 역할을 한다.

### parent_slot이 previous_blockhash와 별도로 필요한 이유

```
EVM:
  Block N: parentHash -> Block N-1의 해시
  연속이므로 parentHash만으로 체인 연결 검증 가능

Solana:
  Slot 250000004의 parent_slot = 250000002 (250000003은 빈 슬롯)
  previous_blockhash = Slot 250000002의 blockhash

  parent_slot이 없으면:
  - "이전 블록이 무엇인지"를 알기 위해 previous_blockhash로 역방향 검색해야 함
  - 빈 슬롯이 몇 개인지 알 수 없음
```

`parent_slot`이 있으면:
1. 이전 블록을 `WHERE slot_number = parent_slot`로 즉시 조회 가능
2. 빈 슬롯 수 계산: `slot_number - parent_slot - 1`
3. 체인 연결 검증: `parent_slot`의 blockhash가 현재 블록의 `previous_blockhash`와 일치하는지

### status 필드 (reorg 고려)

```
EVM:
  status = 1 (active) 또는 2 (reorged)
  confirmation_blocks만큼 기다린 후 finalize
  reorg 감지: parentHash RingBuffer로 체인 분기 탐지

Solana:
  status = 1 (active) 만 사실상 사용
  finalized commitment에서 조회한 블록은 reorg가 관측된 적 없음
  Solana의 finalized = 32개 이상의 supermajority confirmation
```

DDL에 `status` 컬럼을 유지하는 이유:
- EVM과 동일한 인터페이스 유지 (코드 호환성)
- 방어적 설계: 이론적으로 불가능은 아니므로 컬럼은 남겨둠
- 실제로는 항상 1(active)일 것으로 예상

## 인덱스 전략

### PRIMARY KEY: (chain_id, slot_number)

```sql
-- 블록 동기화의 핵심 쿼리
SELECT * FROM solana_blocks WHERE chain_id = 900 AND slot_number = 250000000;
-- PK로 O(1) 조회

-- 범위 스캔 (sync catch-up)
SELECT * FROM solana_blocks
WHERE chain_id = 900 AND slot_number BETWEEN 250000000 AND 250001000
ORDER BY slot_number;
-- PK range scan
```

### idx_block_height: (chain_id, block_height)

```sql
-- "현재 동기화된 최신 높이" 조회
SELECT MAX(block_height) FROM solana_blocks WHERE chain_id = 900;

-- block_height 기준 조회 (API에서 height로 블록 검색)
SELECT * FROM solana_blocks WHERE chain_id = 900 AND block_height = 230000000;
```

### idx_blockhash: (chain_id, blockhash)

```sql
-- TX의 recentBlockhash로 블록 역조회
SELECT * FROM solana_blocks WHERE chain_id = 900 AND blockhash = '7xKJpQx...';

-- 체인 연결성 검증
SELECT slot_number FROM solana_blocks
WHERE chain_id = 900 AND blockhash = (
  SELECT previous_blockhash FROM solana_blocks WHERE chain_id = 900 AND slot_number = 250000004
);
```

## getBlock RPC 응답과의 매핑

```json
{
  "result": {
    "blockhash": "7xKJpQx5GBQ4Z2uSyZxVcUjPMFcH2kLdhQKpNdZsqp5",
    "previousBlockhash": "9mNPqJzCpZ8fEpFXGdx1PJrEUb9kCn2eMYptBbMHZHaW",
    "parentSlot": 249999998,
    "blockHeight": 229999999,
    "blockTime": 1700000000,
    "transactions": [...]
  }
}
```

매핑:
| RPC 응답 필드 | DB 컬럼 | 비고 |
|--------------|---------|------|
| (요청 파라미터) | slot_number | getBlock의 첫 번째 파라미터가 slot |
| blockhash | blockhash | 그대로 |
| previousBlockhash | previous_blockhash | 그대로 |
| parentSlot | parent_slot | 그대로 |
| blockHeight | block_height | 그대로 |
| blockTime | block_time | Unix timestamp (초 단위) |
| transactions.length | tx_count | 코드에서 계산하여 저장 |

## 실습/검증 과제

### 1. devnet에서 실제 블록 조회

```bash
curl -s https://api.devnet.solana.com -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getSlot","params":[{"commitment":"finalized"}]}'

# 반환된 slot으로 getBlock 호출
curl -s https://api.devnet.solana.com -X POST \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"getBlock","params":[SLOT_NUMBER,{"encoding":"json","transactionDetails":"signatures","rewards":false,"commitment":"finalized","maxSupportedTransactionVersion":0}]}'
```

### 2. 검증 항목

- [ ] blockhash 길이가 44자 이내인지 확인
- [ ] parentSlot이 항상 slot_number보다 작은지 확인
- [ ] blockHeight가 순차적으로 증가하는지 확인
- [ ] blockTime이 NULL인 경우가 있는지 확인 (매우 오래된 블록에서 가능)
