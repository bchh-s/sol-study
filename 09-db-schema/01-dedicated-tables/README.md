# 권장: Solana 전용 테이블 생성

상위 섹션: [9. DB 스키마 영향](../README.md)

## 핵심 결론

> EVM 테이블에 nullable 컬럼을 추가하는 대신, `solana_*` 접두어를 가진 전용 테이블 세트를 만든다.

## 공유 테이블의 문제점 (50%+ NULL 컬럼)

EVM과 Solana의 데이터 모델 차이가 너무 크기 때문에, 하나의 테이블에 합치면 행마다 절반 이상의 컬럼이 NULL이 된다.

### blocks 테이블 예시

```
공유 테이블로 합친다고 가정:

| 컬럼              | EVM 행      | Solana 행   |
|-------------------|------------|------------|
| block_number      | 18000000   | NULL       |  -- Solana는 slot_number 사용
| block_hash        | 0xabc...   | NULL       |  -- Solana는 blockhash (base58)
| parent_hash       | 0xdef...   | NULL       |  -- Solana는 previous_blockhash
| slot_number       | NULL       | 250000000  |  -- EVM에는 없음
| block_height      | NULL       | 230000000  |  -- EVM에서는 block_number = height
| blockhash         | NULL       | 7xKJ...    |  -- EVM에서는 block_hash
| previous_blockhash| NULL       | 9mNP...    |  -- EVM에서는 parent_hash
| parent_slot       | NULL       | 249999999  |  -- EVM에는 없음
| block_timestamp   | 1700000000 | NULL       |  -- Solana는 block_time
| block_time        | NULL       | 1700000000 |  -- EVM에서는 block_timestamp

NULL 비율: EVM 행 5/10 = 50%, Solana 행 5/10 = 50%
```

### transfers 테이블은 더 심각

```
| 컬럼                    | EVM 행    | Solana 행 |
|-------------------------|----------|----------|
| tx_hash                 | 0xabc... | NULL     |
| log_index               | 42       | NULL     |
| trace_address           | 0.1.2    | NULL     |
| contract_address        | 0xtoken  | NULL     |
| tx_signature            | NULL     | 5xYz...  |
| instruction_index       | NULL     | 3        |
| inner_instruction_index | NULL     | 1        |
| mint_address            | NULL     | EPjF...  |

NULL 비율: 각 행에서 50%
```

### 공유 테이블의 추가 문제점

1. **UNIQUE KEY를 통합할 수 없음**
   - EVM: `(chain_id, block_hash, tx_hash, transfer_type, log_index, trace_address, nft_token_id)`
   - Solana: `(chain_id, slot_number, tx_signature, instruction_index, inner_instruction_index, transfer_type)`
   - NULL을 포함한 UNIQUE KEY는 MySQL에서 중복 허용 (NULL != NULL)
   - 체인 타입별 partial unique index 필요 -> 복잡성 폭발

2. **인덱스 효율 저하**
   - B-Tree 인덱스에서 NULL 값은 리프 노드에 포함되지만 실제 쿼리에서 거의 사용되지 않음
   - 인덱스 크기만 커지고 쿼리 성능은 떨어짐

3. **ORM/비즈니스 로직 복잡도**
   ```go
   // 공유 테이블 접근 시 모든 곳에서 분기 필요
   if block.ChainType == "solana" {
       slotNumber := block.SlotNumber.Int64  // NullableInt64
       // ...
   } else {
       blockNumber := block.BlockNumber.Int64
       // ...
   }
   ```

4. **ALTER TABLE 리스크**
   - 운영 중인 EVM 테이블에 10+ 컬럼 추가
   - 대용량 테이블(수억 행)의 DDL 변경은 MySQL에서 오래 걸림
   - pt-online-schema-change 필요하지만 여전히 리스크

## 전용 테이블의 장점

### 1. 기존 시스템 무변경 (Zero Risk)

```sql
-- 기존 EVM 테이블에 대한 ALTER: 0건
-- 신규 CREATE TABLE만 실행
CREATE TABLE solana_blocks (...);
CREATE TABLE solana_transfers (...);
CREATE TABLE solana_wallets (...);
CREATE TABLE solana_withdrawal_transactions (...);
CREATE TABLE solana_durable_nonce_accounts (...);
```

### 2. 각 체인에 최적화된 스키마

```sql
-- Solana blocks: slot_number가 PK, block_height는 보조 인덱스
PRIMARY KEY (chain_id, slot_number)
INDEX idx_block_height (chain_id, block_height)

-- EVM blocks: block_number가 PK (그대로 유지)
PRIMARY KEY (chain_id, block_number)
```

### 3. 코드 분리

```go
// 체인별 Repository가 명확히 분리됨
type SolanaBlockRepo interface {
    GetBySlot(chainID int64, slot int64) (*SolanaBlock, error)
    GetByHeight(chainID int64, height int64) (*SolanaBlock, error)
}

type EVMBlockRepo interface {
    GetByNumber(chainID int64, number int64) (*EVMBlock, error)
}
```

## 크로스체인 쿼리 전략

"사용자 X의 모든 체인 잔액을 한번에 조회"하는 경우가 필요할 수 있다.

### 방법 1: UNION 쿼리

```sql
-- 사용자의 모든 체인 입금 내역 조회
SELECT 'evm' AS chain_type, chain_id, tx_hash AS tx_id, amount, block_number AS block_ref
FROM transfers
WHERE to_address IN (SELECT address FROM wallets WHERE user_id = ?)

UNION ALL

SELECT 'solana' AS chain_type, chain_id, tx_signature AS tx_id, amount, slot_number AS block_ref
FROM solana_transfers
WHERE to_address IN (SELECT address FROM solana_wallets WHERE user_id = ?);
```

### 방법 2: logical_wallet_id JOIN

```sql
-- logical_wallet_chains를 통한 매핑
SELECT lwc.chain_type, lwc.chain_wallet_id
FROM logical_wallets lw
JOIN logical_wallet_chains lwc ON lw.id = lwc.logical_wallet_id
WHERE lw.user_id = ?;

-- 이후 chain_type별로 각 테이블 조회
```

### 권장: 방법 2 (JOIN)

- 크로스체인 쿼리가 빈번하다면 매핑 테이블을 통한 JOIN이 유지보수에 유리
- 하지만 Dagaon Core에서 크로스체인 통합 조회는 API 레이어에서 처리하는 것이 더 자연스러움
- DB 레벨에서는 체인별 독립 쿼리를 권장

## 마이그레이션 전략

### 단계별 실행 계획

```
Step 1: DDL 실행 (신규 테이블 생성)
  - 기존 테이블 변경 없음
  - 빈 테이블 생성이므로 즉시 완료
  - 운영 중 서비스 중단 불필요

Step 2: seed 데이터 삽입
  - solana_wallets: 초기 핫월렛, 피페이어 지갑 등록
  - solana_durable_nonce_accounts: 초기 nonce 계정 풀 등록

Step 3: 애플리케이션 배포
  - plugin registry에 "solana" 타입 등록
  - block sync, tx pipeline 코드 배포

Step 4: Block sync 시작
  - solana_blocks에 데이터 적재 시작
  - solana_transfers에 입금 내역 적재 시작
```

### 롤백 전략

```
-- 최악의 경우 Solana 테이블만 DROP
-- EVM 운영에는 영향 없음
DROP TABLE IF EXISTS solana_durable_nonce_accounts;
DROP TABLE IF EXISTS solana_withdrawal_transactions;
DROP TABLE IF EXISTS solana_transfers;
DROP TABLE IF EXISTS solana_blocks;
DROP TABLE IF EXISTS solana_wallets;
```

## 향후 확장성

이 "체인별 전용 테이블" 패턴은 다른 non-EVM 체인에도 동일하게 적용 가능하다:

```
cosmos_blocks, cosmos_transfers, cosmos_wallets, ...
aptos_blocks, aptos_transfers, aptos_wallets, ...
```

Plugin registry 패턴(`blockchain/registry.go`)과 결합하면, 새 체인 추가 시:
1. `{chain}_*` 테이블 DDL 작성
2. `{chain}Plugin` 구현체 작성
3. Registry에 등록

이 세 단계로 확장이 가능하다.
