# 9.3 solana_wallets 테이블

상위 섹션: [9. DB 스키마 영향](../README.md)

## 전체 DDL

```sql
CREATE TABLE solana_wallets (
  id          BIGINT       AUTO_INCREMENT PRIMARY KEY,
  chain_id    BIGINT       NOT NULL COMMENT 'Solana 네트워크 식별',
  key_id      VARCHAR(64)  NOT NULL COMMENT 'KMS key ID (AWS KMS Ed25519 키 식별자)',
  address     VARCHAR(44)  NOT NULL COMMENT 'Solana 주소 (base58 인코딩, 32바이트 공개키)',
  type        TINYINT      NOT NULL COMMENT '지갑 유형 비트 플래그: 0=cold, 1=withdrawal, 2=deposit, 4=fee_payer',
  status      TINYINT      NOT NULL DEFAULT 1 COMMENT '1=active, 2=disabled',
  label       VARCHAR(100) NULL     COMMENT '관리용 레이블 (예: "mainnet-hot-1")',
  created_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uk_chain_address (chain_id, address),
  INDEX idx_key_id (key_id),
  INDEX idx_type_status (chain_id, type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Solana 지갑 관리 - KMS Ed25519 키와 매핑';
```

## EVM wallets 테이블과의 비교

### 주소 길이: VARCHAR(44) vs VARCHAR(42)

```
EVM:
  0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045
  ^^ ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  0x   40자 hex = 42자 총 길이
  = 20 bytes (160 bit)

Solana:
  DRpbCBMxVnDK7maPMoKsdTdEC1a4NoLc8cmm7RFJ3quP
  ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  base58 인코딩 = 최대 44자
  = 32 bytes (256 bit, Ed25519 공개키)
```

Solana 주소는 Ed25519 공개키를 base58로 인코딩한 것이다. 32바이트의 base58 인코딩은 32~44자 범위이며, 대부분 43~44자이다.

### key_id: KMS Ed25519 키 연결

```
EVM:
  key_id -> AWS KMS asymmetric key (ECC_SECG_P256K1, secp256k1)
  용도: ECDSA 서명 -> keccak256(pubkey) -> 주소 유도

Solana:
  key_id -> AWS KMS asymmetric key (ECC_EDWARDS_ED25519, Ed25519)
  용도: EdDSA 서명 -> pubkey 자체가 주소
```

AWS KMS는 2023년부터 Ed25519 키를 지원한다 (`ECC_EDWARDS_ED25519` 키 스펙).

| KMS 파라미터 | EVM | Solana |
|-------------|-----|--------|
| KeySpec | ECC_SECG_P256K1 | ECC_EDWARDS_ED25519 |
| KeyUsage | SIGN_VERIFY | SIGN_VERIFY |
| SigningAlgorithm | ECDSA_SHA_256 | EDDSA_ED25519 |
| 주소 유도 | keccak256(pubkey)[12:] | pubkey 그 자체 |

### current_nonce가 없는 이유

```
EVM wallets 테이블:
  current_nonce BIGINT NOT NULL DEFAULT 0
  -- sender별 순차 정수 nonce
  -- tx-ticketer가 atomic increment로 할당
  -- 같은 nonce로 replacement TX 전송 가능

Solana wallets 테이블:
  -- current_nonce 컬럼 없음
  -- Solana에는 sender별 순차 nonce 개념 자체가 없음
```

Solana TX의 유일성은 다음 두 가지 방식으로 보장된다:

1. **Recent Blockhash**: 최근 블록의 해시를 TX에 포함 -> 60~90초 내 만료
2. **Durable Nonce**: 전용 nonce 계정의 저장된 값 -> 수동으로 advance할 때까지 유효

두 방식 모두 "현재 nonce 값"이 지갑이 아닌 **별도의 소스**(블록체인 또는 nonce 계정)에 있다.

```
EVM: nonce = 지갑 상태의 일부 -> wallets 테이블에 저장 자연스러움
Solana: nonce = 지갑 외부의 데이터 -> wallets 테이블에 저장할 것이 없음
         durable nonce 사용 시 -> solana_durable_nonce_accounts 테이블에서 관리
```

### wallet type 비트 플래그

EVM과 동일한 비트 플래그를 사용한다:

```
값  | 비트  | 의미          | 설명
----|------|--------------|-------------------------------------
0   | 0000 | cold         | 콜드 월렛 (대량 자산 보관)
1   | 0001 | withdrawal   | 출금용 핫월렛 (from_address)
2   | 0010 | deposit      | 입금 감시 지갑
4   | 0100 | fee_payer    | 수수료 납부 전용 (Solana의 fee payer)
```

Solana에서 `fee_payer` (type=4)가 특별히 중요하다:
- EVM에서는 sender = gas 지불자 (같은 주소)
- Solana에서는 fee_payer와 실제 자산 sender가 다를 수 있음
- fee delegation이 네이티브로 지원되므로, fee_payer 전용 지갑을 별도로 운영하는 것이 일반적

```
EVM 출금:
  from_address = gas 지불자 = withdrawal 지갑 (type=1)

Solana 출금:
  from_address = withdrawal 지갑 (type=1) -> 자산 보유
  fee_payer    = fee_payer 지갑 (type=4) -> SOL 보유 (수수료 납부)
```

## 지갑 생성 흐름 (Dagaon Core)

```
1. Admin API: "새 Solana 지갑 생성" 요청
2. KMS: CreateKey(KeySpec=ECC_EDWARDS_ED25519) -> key_id, public_key
3. 주소 유도: address = base58encode(public_key)  (해시 불필요, 공개키 = 주소)
4. DB: INSERT INTO solana_wallets (chain_id, key_id, address, type, status) VALUES (...)
5. Deposit 지갑인 경우: 감시 목록에 address 등록
6. Fee payer 지갑인 경우: SOL 충전 필요 (rent-exempt + 수수료 예산)
```

### Deposit 지갑의 특수 사항

```
EVM:
  - 빈 주소에도 ETH/토큰 수신 가능
  - 계정 생성 비용 없음

Solana:
  - SOL은 빈 주소에도 수신 가능 (SystemProgram.transfer로 계정 자동 생성)
  - SPL Token은 수신 전에 Associated Token Account(ATA) 생성 필요
  - ATA 생성 비용: ~0.00203928 SOL (rent-exempt)
  - ATA 생성은 첫 입금 시 fee_payer가 부담하거나, 송금자가 부담하도록 설계
```

## 조회 쿼리 패턴

```sql
-- 특정 체인의 활성 fee_payer 지갑 목록
SELECT * FROM solana_wallets
WHERE chain_id = 900 AND type = 4 AND status = 1;

-- 주소로 지갑 조회 (입금 감지 시)
SELECT * FROM solana_wallets
WHERE chain_id = 900 AND address = 'DRpbCBMx...';

-- KMS key_id로 역조회
SELECT * FROM solana_wallets
WHERE key_id = 'arn:aws:kms:ap-northeast-2:123456:key/abc-def';
```

## 실습/검증 과제

- [ ] devnet에서 Ed25519 키페어 생성 후 주소 길이 확인 (32~44자)
- [ ] base58 인코딩 결과가 항상 44자 이하인지 여러 공개키로 검증
- [ ] AWS KMS ECC_EDWARDS_ED25519 키 생성 가능 여부 확인 (리전별 지원)
- [ ] type 비트 플래그가 EVM wallets와 동일한 값 체계인지 코드에서 확인
