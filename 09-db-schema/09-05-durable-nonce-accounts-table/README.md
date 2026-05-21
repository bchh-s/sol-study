# 9.5 solana_durable_nonce_accounts 테이블 (신규)

상위 섹션: [9. DB 스키마 영향](../README.md)

## 개요

이 테이블은 EVM에 대응하는 것이 없는 완전히 새로운 테이블이다.

Solana에서 출금 TX의 유일성을 보장하기 위해 "durable nonce" 메커니즘을 사용하는데, 이를 위해 온체인에 nonce 계정을 미리 생성하고 풀(pool)로 관리해야 한다.

```
EVM:
  nonce = wallet.current_nonce++ (DB에서 atomic increment)
  -> 별도 테이블 불필요

Solana:
  nonce = 온체인 nonce 계정의 stored_nonce 값
  -> 계정 풀 관리가 필요 -> 별도 테이블 필요
```

## 전체 DDL

```sql
CREATE TABLE solana_durable_nonce_accounts (
  id                    BIGINT      AUTO_INCREMENT PRIMARY KEY,
  chain_id              BIGINT      NOT NULL COMMENT 'Solana 네트워크 식별',
  wallet_id             BIGINT      NOT NULL COMMENT '소유 핫월렛 (solana_wallets.id)',
  nonce_account_address VARCHAR(44) NOT NULL COMMENT 'nonce 계정의 온체인 주소 (base58)',
  authority_address     VARCHAR(44) NOT NULL COMMENT 'nonce authority 주소 (= 핫월렛 주소)',
  stored_nonce          VARCHAR(44) NULL     COMMENT '현재 저장된 nonce 값 (base58, 마지막 동기화 시점)',
  status                TINYINT     NOT NULL DEFAULT 1 COMMENT '1=FREE, 2=IN_USE, 3=DISABLED',
  in_use_by_tx_id       BIGINT      NULL     COMMENT '사용 중인 TX의 solana_withdrawal_transactions.id',
  last_synced_at        TIMESTAMP   NULL     COMMENT 'stored_nonce를 마지막으로 온체인에서 동기화한 시점',
  created_at            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_nonce (chain_id, nonce_account_address),
  INDEX idx_wallet_status (wallet_id, status),
  INDEX idx_status (chain_id, status),
  INDEX idx_in_use (in_use_by_tx_id),
  FOREIGN KEY (wallet_id) REFERENCES solana_wallets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Solana durable nonce 계정 풀 관리 - 출금 TX 유일성 보장';
```

## 컬럼 상세

### status: FREE / IN_USE / DISABLED

```
1=FREE:
  - 어떤 TX에도 할당되지 않은 상태
  - tx-ticketer가 할당 가능
  - in_use_by_tx_id = NULL

2=IN_USE:
  - 특정 TX에 할당됨
  - 해당 TX가 COMPLETED 또는 DROPPED될 때까지 다른 TX에 할당 불가
  - in_use_by_tx_id = 사용 중인 TX의 ID

3=DISABLED:
  - 비활성화됨 (온체인 계정 손상, 수동 제외 등)
  - 할당 대상에서 제외
  - 관리자가 수동으로 복구하거나 새 계정으로 대체
```

### in_use_by_tx_id: TX 추적

```
FREE 상태:
  in_use_by_tx_id = NULL

IN_USE 상태:
  in_use_by_tx_id = 42  (solana_withdrawal_transactions.id = 42에서 사용 중)

TX 완료 시:
  UPDATE solana_durable_nonce_accounts
  SET status = 1, in_use_by_tx_id = NULL, stored_nonce = ?, updated_at = NOW()
  WHERE id = ? AND in_use_by_tx_id = 42;
```

### stored_nonce: 온체인 값 캐시

Durable nonce 계정의 온체인 데이터 구조:

```
NonceAccount {
  authority: Pubkey,       // nonce advance 권한자
  nonce: Hash,             // 현재 저장된 nonce 값 (blockhash 형태)
  feeCalculator: {...}     // 수수료 정보 (deprecated)
}
```

- `stored_nonce`는 이 온체인 `nonce` 값을 DB에 캐시한 것
- TX 생성 시 이 값을 `recentBlockhash` 필드에 사용
- AdvanceNonceAccount instruction이 실행되면 온체인 값이 변경됨
- `last_synced_at`으로 마지막 동기화 시점 추적

### authority_address: Nonce 조작 권한

```
authority_address = 핫월렛 주소

이 주소만 다음 작업을 수행할 수 있음:
1. AdvanceNonce: nonce 값을 새 blockhash로 갱신
2. WithdrawNonce: nonce 계정에서 SOL 인출 (계정 폐쇄)
3. AuthorizeNonce: authority를 다른 주소로 변경

보안 중요:
- authority = KMS로 관리되는 핫월렛
- authority가 유출되면 nonce 계정을 조작당할 수 있음
- solana_wallets.address와 동일한 값이지만, 명시적으로 기록
```

## 풀 할당 쿼리 패턴: SELECT ... FOR UPDATE SKIP LOCKED

출금 TX를 생성할 때, FREE 상태의 nonce 계정을 하나 할당해야 한다. 동시성 문제를 방지하기 위해 행 잠금이 필요하다.

### 할당 (tx-ticketer)

```sql
-- Step 1: FREE nonce 계정 하나를 잠금과 함께 조회
START TRANSACTION;

SELECT id, nonce_account_address, stored_nonce
FROM solana_durable_nonce_accounts
WHERE chain_id = 900
  AND wallet_id = ?        -- 이 핫월렛이 소유한 nonce 계정 중
  AND status = 1           -- FREE 상태인 것
ORDER BY id
LIMIT 1
FOR UPDATE SKIP LOCKED;   -- 이미 다른 트랜잭션이 잠근 행은 건너뜀

-- Step 2: IN_USE로 상태 변경
UPDATE solana_durable_nonce_accounts
SET status = 2,
    in_use_by_tx_id = ?,   -- 새로 생성할 TX의 ID
    updated_at = NOW()
WHERE id = ?;              -- Step 1에서 조회한 ID

COMMIT;
```

### FOR UPDATE SKIP LOCKED의 동작

```
동시에 3개의 tx-ticketer가 nonce 할당을 요청하는 경우:

FREE nonce 계정: [A, B, C, D, E]

Thread 1: SELECT ... FOR UPDATE SKIP LOCKED -> A 획득 (A 잠금)
Thread 2: SELECT ... FOR UPDATE SKIP LOCKED -> B 획득 (A 잠김 -> 건너뜀, B 잠금)
Thread 3: SELECT ... FOR UPDATE SKIP LOCKED -> C 획득 (A,B 잠김 -> 건너뜀, C 잠금)

FOR UPDATE (SKIP LOCKED 없이):
  Thread 2: A의 잠금 해제를 기다림 (blocking) -> 성능 저하

FOR UPDATE SKIP LOCKED:
  Thread 2: A를 건너뛰고 B를 즉시 획득 -> non-blocking
```

MySQL 8.0+, PostgreSQL 9.5+에서 지원한다.

### 반환 (TX 완료/드롭 후)

```sql
-- TX가 COMPLETED 또는 DROPPED된 후
START TRANSACTION;

-- nonce 계정을 FREE로 복구
UPDATE solana_durable_nonce_accounts
SET status = 1,
    in_use_by_tx_id = NULL,
    stored_nonce = ?,          -- 온체인에서 최신 nonce 값 조회하여 갱신
    last_synced_at = NOW(),
    updated_at = NOW()
WHERE id = ?
  AND in_use_by_tx_id = ?;    -- 안전장치: 해당 TX가 사용 중인 경우만

COMMIT;
```

### 풀 부족 시 처리

```sql
-- FREE 계정이 0개인 경우 SELECT 결과가 빈 행
-- 이 경우 tx-ticketer는:
-- 1. 출금 요청을 PENDING 상태로 대기 큐에 유지
-- 2. 알림/메트릭 발생: "nonce pool exhausted"
-- 3. 운영팀이 새 nonce 계정을 온체인에 생성하고 DB에 등록

-- 풀 상태 모니터링 쿼리
SELECT
  wallet_id,
  SUM(CASE WHEN status = 1 THEN 1 ELSE 0 END) AS free_count,
  SUM(CASE WHEN status = 2 THEN 1 ELSE 0 END) AS in_use_count,
  SUM(CASE WHEN status = 3 THEN 1 ELSE 0 END) AS disabled_count,
  COUNT(*) AS total
FROM solana_durable_nonce_accounts
WHERE chain_id = 900
GROUP BY wallet_id;
```

## Durable Nonce 생명주기

### 1. 온체인 Nonce 계정 생성

```
# SystemProgram.createAccount + NonceProgram.initializeNonce를 하나의 TX로 실행

Instructions:
  [0] SystemProgram.createAccount(
        from: fee_payer,
        newAccount: nonce_keypair.publicKey,
        lamports: rent_exempt_balance,  -- ~0.00144768 SOL
        space: 80,                       -- NonceAccount 데이터 크기
        owner: NonceProgram
      )
  [1] NonceProgram.initializeNonce(
        nonceAccount: nonce_keypair.publicKey,
        authority: hot_wallet_address
      )
```

### 2. DB에 등록

```sql
INSERT INTO solana_durable_nonce_accounts
  (chain_id, wallet_id, nonce_account_address, authority_address, stored_nonce, status)
VALUES
  (900, 1, 'NonceAccAddr123...', 'HotWalletAddr...', 'InitialNonce...', 1);
```

### 3. TX 생성 시 사용

```
TX Instructions (durable nonce 사용 시):
  [0] NonceProgram.advanceNonce(
        nonceAccount: nonce_account_address,
        authority: hot_wallet_address
      )
  [1] ComputeBudgetProgram.setComputeUnitLimit(units: 200000)
  [2] ComputeBudgetProgram.setComputeUnitPrice(microLamports: 50000)
  [3] SystemProgram.transfer(from: from_address, to: to_address, lamports: amount)
      -- 또는 TokenProgram.transfer for SPL tokens

TX.recentBlockhash = stored_nonce  (durable nonce 모드에서는 blockhash 대신 nonce 값 사용)
TX.feePayer = fee_payer_address
```

### 4. TX 완료 후 nonce 갱신

```
AdvanceNonce가 실행되면 온체인 nonce 값이 새로 변경됨
-> getAccountInfo로 nonce 계정 조회
-> 새 stored_nonce를 DB에 업데이트
-> status를 FREE로 복구
```

## 풀 사이징 가이드

```
필요한 nonce 계정 수 = 동시 출금 TX 최대 수 + 여유분

예시:
  - 동시 출금 처리 능력: 10 TPS
  - TX 평균 처리 시간: 30초 (서명~확인)
  - 동시 IN_USE: 10 * 30 = 300개
  - 여유분: 20%
  - 필요 풀 크기: 360개

초기 비용:
  360 * 0.00144768 SOL = 0.52 SOL (rent-exempt deposit)
  매우 저렴하므로 넉넉하게 생성하는 것을 권장
```

## 실습/검증 과제

- [ ] devnet에서 nonce 계정 생성 후 getAccountInfo로 NonceAccount 데이터 확인
- [ ] AdvanceNonce 후 stored_nonce가 변경되는지 확인
- [ ] SELECT ... FOR UPDATE SKIP LOCKED가 MySQL 8.0에서 정상 동작하는지 확인
- [ ] 풀에 FREE 계정이 없을 때 tx-ticketer의 동작 설계 검토
- [ ] nonce 계정의 rent-exempt balance가 ~0.00144768 SOL인지 확인
- [ ] authority가 다른 주소인 nonce 계정에서 AdvanceNonce가 실패하는지 확인
