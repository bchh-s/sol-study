# 9. DB 스키마 영향

원문: ../solana-integration-research.md

## 개요: 왜 Solana 전용 테이블인가

Dagaon Core는 현재 EVM 체인(Ethereum, Kaia, BSC, Tron)을 위한 단일 테이블 세트(`blocks`, `transfers`, `wallets`, `withdrawal_transactions`)를 사용한다. Solana를 지원할 때 두 가지 접근이 가능하다.

### 접근 1: 기존 테이블에 nullable 컬럼 추가 (비권장)

```
ALTER TABLE blocks ADD slot_number BIGINT NULL;
ALTER TABLE blocks ADD block_height BIGINT NULL;
ALTER TABLE blocks ADD parent_slot BIGINT NULL;
-- ... 수십 개의 nullable 컬럼 추가
```

**문제점:**
- EVM 행에서 Solana 전용 컬럼이 전부 NULL (50%+ NULL 비율)
- Solana 행에서 EVM 전용 컬럼이 전부 NULL (`block_number`, `parent_hash` 등)
- UNIQUE KEY 구성이 체인 타입에 따라 달라져야 함 -> 복잡한 partial unique index 필요
- 인덱스 효율 저하 (NULL이 많은 컬럼의 B-Tree는 sparse)
- ORM/DTO 코드에서 체인 타입별 분기가 모든 곳에 퍼짐
- 기존 EVM 테이블에 DDL 변경 -> 운영 중 마이그레이션 리스크

### 접근 2: Solana 전용 테이블 분리 (권장)

```
CREATE TABLE solana_blocks (...);
CREATE TABLE solana_transfers (...);
CREATE TABLE solana_wallets (...);
CREATE TABLE solana_withdrawal_transactions (...);
CREATE TABLE solana_durable_nonce_accounts (...);  -- 완전 신규
```

**장점:**
- 기존 EVM 테이블을 전혀 변경하지 않음 (zero-risk migration)
- 각 테이블이 해당 체인의 데이터 모델에 최적화됨
- UNIQUE KEY, 인덱스, 컬럼 타입이 Solana 특성에 맞게 설계 가능
- ORM/DTO 코드가 체인별로 명확히 분리됨
- 향후 다른 non-EVM 체인(Cosmos, Aptos 등) 추가 시에도 동일 패턴 적용 가능

## 스키마 설계 원칙

### 1. chain_id는 모든 테이블에 유지

Solana도 mainnet-beta, devnet, testnet이 존재한다. `chain_id`를 PK 또는 UNIQUE KEY의 첫 번째 컬럼으로 유지하여 동일 DB에서 멀티 네트워크를 지원한다.

| 네트워크 | chain_id (예시) |
|----------|----------------|
| Solana mainnet-beta | 900 |
| Solana devnet | 901 |
| Solana testnet | 902 |

### 2. base58 주소/서명 길이

| 항목 | EVM | Solana |
|------|-----|--------|
| 주소 길이 | 42자 (`0x` + 40 hex) | 32~44자 (base58 encoded 32 bytes) |
| TX 식별자 | 66자 (`0x` + 64 hex) | 최대 88자 (base58 encoded 64 bytes Ed25519 서명) |
| 해시 | 66자 (`0x` + 64 hex) | 최대 44자 (base58 encoded 32 bytes) |

### 3. logical_wallet_id 패턴

크로스체인 조회가 필요한 경우, 별도의 `logical_wallets` 매핑 테이블을 사용한다:

```sql
CREATE TABLE logical_wallets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  label VARCHAR(100),
  UNIQUE KEY uk_user (user_id)
);

CREATE TABLE logical_wallet_chains (
  logical_wallet_id BIGINT NOT NULL,
  chain_type VARCHAR(10) NOT NULL,   -- 'evm' or 'solana'
  chain_wallet_id BIGINT NOT NULL,   -- EVM wallets.id 또는 solana_wallets.id
  UNIQUE KEY uk_chain (logical_wallet_id, chain_type)
);
```

이 패턴으로 "사용자 X의 모든 체인 잔액 조회" 같은 크로스체인 쿼리를 JOIN으로 처리 가능하다.

### 4. 마이그레이션 전략

```
Phase 1: CREATE TABLE solana_* (신규 테이블 5개)
Phase 2: INSERT seed data (wallet 초기 생성)
Phase 3: 애플리케이션 코드에 Solana 플러그인 등록
Phase 4: Block sync 시작 -> solana_blocks/solana_transfers에 데이터 적재

기존 EVM 테이블에 대한 ALTER는 0건.
```

## 테이블 요약

| 테이블 | EVM 대응 | 주요 차이점 |
|--------|---------|------------|
| `solana_blocks` | `blocks` | slot_number/block_height 이중 식별, parent_slot |
| `solana_transfers` | `transfers` | instruction_index 기반 위치 식별, mint_address |
| `solana_wallets` | `wallets` | current_nonce 없음, Ed25519 key |
| `solana_withdrawal_transactions` | `withdrawal_transactions` | durable nonce 필드, compute unit 필드, fee_payer 분리 |
| `solana_durable_nonce_accounts` | (대응 없음) | 완전 신규 - nonce 계정 풀 관리 |

## 하위 문서

- [권장: Solana 전용 테이블 생성](./01-dedicated-tables/README.md) -- 전용 테이블 vs 공유 테이블 상세 비교
- [9.1 blocks 테이블](./09-01-blocks-table/README.md) -- solana_blocks DDL 및 컬럼 상세
- [9.2 transfers 테이블](./09-02-transfers-table/README.md) -- solana_transfers DDL 및 컬럼 상세
- [9.3 wallets 테이블](./09-03-wallets-table/README.md) -- solana_wallets DDL 및 컬럼 상세
- [9.4 withdrawal_transactions 테이블](./09-04-withdrawal-transactions-table/README.md) -- 출금 TX DDL 및 상태 머신
- [9.5 durable_nonce_accounts 테이블 (신규)](./09-05-durable-nonce-accounts-table/README.md) -- nonce 풀 관리

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
