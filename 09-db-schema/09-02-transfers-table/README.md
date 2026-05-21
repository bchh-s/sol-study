# 9.2 solana_transfers 테이블

상위 섹션: [9. DB 스키마 영향](../README.md)

## 전체 DDL

```sql
CREATE TABLE solana_transfers (
  id                       BIGINT       AUTO_INCREMENT PRIMARY KEY,
  chain_id                 BIGINT       NOT NULL COMMENT 'Solana 네트워크 식별',
  slot_number              BIGINT       NOT NULL COMMENT '블록(슬롯) 번호',
  tx_signature             VARCHAR(88)  NOT NULL COMMENT 'base58 인코딩된 Ed25519 서명 (트랜잭션 식별자)',
  instruction_index        INT          NOT NULL COMMENT '트랜잭션 내 instruction 위치 (0-based)',
  inner_instruction_index  INT          NOT NULL DEFAULT -1 COMMENT 'inner instruction 위치 (-1이면 top-level)',
  transfer_type            TINYINT      NOT NULL COMMENT '1=native(SOL), 2=spl_token, 3=nft',
  mint_address             VARCHAR(44)  NULL     COMMENT 'SPL token mint 주소 (native이면 NULL)',
  from_address             VARCHAR(44)  NOT NULL COMMENT '송신자 주소 (base58)',
  to_address               VARCHAR(44)  NOT NULL COMMENT '수신자 주소 (base58)',
  amount                   VARCHAR(100) NOT NULL COMMENT '전송 수량 (정수 문자열, lamports/raw amount)',
  decimals                 TINYINT      NULL     COMMENT 'SPL 토큰 decimal (native SOL이면 NULL, UI 표시용)',
  status                   TINYINT      NOT NULL DEFAULT 1 COMMENT '1=active',
  created_at               TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uk_transfer (chain_id, slot_number, tx_signature, instruction_index, inner_instruction_index, transfer_type),
  INDEX idx_to_address (chain_id, to_address, slot_number),
  INDEX idx_from_address (chain_id, from_address, slot_number),
  INDEX idx_slot (chain_id, slot_number),
  INDEX idx_mint (chain_id, mint_address, slot_number)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  COMMENT='Solana 입출금 전송 내역 - Block Consumer가 블록 파싱 후 적재';
```

## 컬럼별 상세 비교: EVM transfers vs solana_transfers

### tx_signature (VARCHAR(88)) vs tx_hash (VARCHAR(66))

| 항목 | EVM `tx_hash` | Solana `tx_signature` |
|------|--------------|----------------------|
| 인코딩 | hex (0x + 64자 = 66자) | base58 (최대 88자) |
| 원본 크기 | 32 bytes (keccak256 해시) | 64 bytes (Ed25519 서명) |
| 성격 | 트랜잭션의 해시 | 첫 번째 서명자의 서명 자체 |
| 고유성 | 해시이므로 항상 유일 | 서명이므로 항상 유일 |

Solana에서 TX를 식별하는 값은 "첫 번째 서명(signature)"이다. 이 값은 RPC에서 `"signatures": ["5xYz..."]`로 반환되며, `getTransaction`의 입력 파라미터로도 사용된다.

base58 인코딩 최대 길이 계산:
```
64 bytes -> base58 인코딩 -> 최대 88자
(base58는 byte당 약 1.37자, ceil(64 * log(256)/log(58)) = 88)
실제 대부분 87~88자
```

### instruction_index + inner_instruction_index vs log_index + trace_address

```
EVM 트랜잭션:
  - 하나의 함수 호출 (call)
  - 이벤트 로그로 전송 식별: Transfer(from, to, value) event
  - log_index: 블록 내 로그의 순서 번호 (전역)
  - trace_address: internal transaction의 경로 (예: "0.1.2")

Solana 트랜잭션:
  - 여러 instruction을 하나의 TX에 번들 가능
  - 각 instruction이 추가 instruction을 호출 가능 (CPI = Cross-Program Invocation)
  - instruction_index: TX 내 top-level instruction의 순서 (0-based)
  - inner_instruction_index: CPI로 호출된 내부 instruction의 순서 (-1이면 top-level)
```

예시: 하나의 Solana TX에서 발생하는 전송들

```
TX (signature: 5xYz...)
  instruction[0]: SystemProgram.transfer (SOL 전송)
    -> instruction_index=0, inner_instruction_index=-1
  instruction[1]: TokenProgram.transfer (SPL 토큰 전송)
    -> instruction_index=1, inner_instruction_index=-1
  instruction[2]: 커스텀 프로그램 호출
    -> CPI: TokenProgram.transfer (내부에서 SPL 전송)
       -> instruction_index=2, inner_instruction_index=0
    -> CPI: SystemProgram.transfer (내부에서 SOL 전송)
       -> instruction_index=2, inner_instruction_index=1
```

### mint_address vs contract_address

| 항목 | EVM `contract_address` | Solana `mint_address` |
|------|----------------------|---------------------|
| 의미 | ERC20 토큰 컨트랙트 주소 | SPL Token의 Mint 주소 |
| native인 경우 | NULL | NULL |
| 길이 | VARCHAR(42) | VARCHAR(44) |
| 식별 대상 | "어떤 토큰인지" | "어떤 토큰인지" (동일 개념) |

SPL Token에서 "mint"는 토큰의 발행 주소로, ERC20의 컨트랙트 주소와 동일한 역할이다.

```
USDC (EVM):  contract_address = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48
USDC (Solana): mint_address = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v
```

### UNIQUE KEY 구성 차이

```sql
-- EVM
UNIQUE KEY uk_transfer (
  chain_id,
  block_hash,      -- 블록 식별
  tx_hash,         -- TX 식별
  transfer_type,   -- 전송 유형
  log_index,       -- 이벤트 로그 위치
  trace_address,   -- internal TX 경로
  nft_token_id     -- NFT 토큰 ID
);

-- Solana
UNIQUE KEY uk_transfer (
  chain_id,
  slot_number,               -- 블록(슬롯) 식별
  tx_signature,              -- TX 식별
  instruction_index,         -- instruction 위치
  inner_instruction_index,   -- inner instruction 위치
  transfer_type              -- 전송 유형
);
```

차이점:
1. `block_hash` 대신 `slot_number` -- Solana에서는 slot이 블록의 유일한 식별자
2. `log_index` + `trace_address` 대신 `instruction_index` + `inner_instruction_index`
3. `nft_token_id` 불필요 -- Solana NFT는 mint_address 자체가 고유 (1 mint = 1 NFT)

### transfer_type: native(SOL) / spl_token / nft

```
값  | 의미        | EVM 대응      | 식별 방법
----|------------|--------------|-------------------------------------------
1   | native(SOL)| native(ETH)  | SystemProgram.transfer 또는 pre/postBalances diff
2   | spl_token  | erc20        | TokenProgram.transfer/transferChecked instruction
3   | nft        | erc721       | TokenProgram.transfer with amount=1 and supply=1
```

Solana에서 전송 식별 방법:

```
1. Native SOL 전송:
   - programId = "11111111111111111111111111111111" (System Program)
   - instruction type = Transfer (2)
   - 또는 pre/postBalances 차이로 추출

2. SPL Token 전송:
   - programId = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" (Token Program)
   - instruction type = Transfer (3) 또는 TransferChecked (12)
   - mint_address = token account의 mint 필드

3. NFT 전송:
   - SPL Token 전송과 동일하지만:
   - amount = 1 (raw, decimals = 0)
   - mint의 supply = 1, decimals = 0
```

## 인덱스 전략

### idx_to_address: (chain_id, to_address, slot_number)

```sql
-- 입금 감지: 감시 지갑에 들어온 전송 조회
SELECT * FROM solana_transfers
WHERE chain_id = 900 AND to_address = 'DRpbCBMxVnDK7maPMoKsdTdEC...'
AND slot_number > ?
ORDER BY slot_number;
```

이것이 Block Consumer의 핵심 쿼리 패턴이다. 감시 대상 지갑에 입금된 건을 빠르게 찾아야 한다.

### idx_from_address: (chain_id, from_address, slot_number)

```sql
-- 출금 확인: 특정 주소에서 나간 전송 조회
SELECT * FROM solana_transfers
WHERE chain_id = 900 AND from_address = 'HotWalletAddress...'
AND slot_number > ?;
```

### idx_mint: (chain_id, mint_address, slot_number)

```sql
-- 특정 토큰의 전체 전송 내역 (토큰별 분석)
SELECT * FROM solana_transfers
WHERE chain_id = 900 AND mint_address = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
ORDER BY slot_number DESC
LIMIT 100;
```

## Transfer 추출 파이프라인 (Block Consumer)

```
getBlock(slot, encoding="jsonParsed") 응답
  |
  +-- transactions[] 순회
       |
       +-- transaction.message.instructions[] 순회 (instruction_index)
       |    |
       |    +-- programId == SystemProgram? -> SOL transfer 추출 (type=1)
       |    +-- programId == TokenProgram? -> SPL transfer 추출 (type=2 or 3)
       |
       +-- meta.innerInstructions[] 순회
            |
            +-- instructions[] 순회 (inner_instruction_index)
                 |
                 +-- 동일한 프로그램 ID 체크 후 transfer 추출
```

## 실습/검증 과제

### 검증 항목

- [ ] tx_signature 최대 길이가 88자 이내인지 devnet에서 확인
- [ ] instruction_index가 0부터 시작하는지 확인
- [ ] inner_instruction_index가 CPI 호출 순서와 일치하는지 확인
- [ ] 중복 insert가 UNIQUE KEY로 거부되는지 확인
- [ ] amount가 lamports 단위 정수 문자열로 저장되는지 확인

### 중복 방지 테스트

```sql
-- 같은 transfer를 두 번 insert하면 에러
INSERT INTO solana_transfers (chain_id, slot_number, tx_signature, instruction_index,
  inner_instruction_index, transfer_type, from_address, to_address, amount)
VALUES (901, 250000000, '5xYzAbcDef...', 0, -1, 1, 'From...', 'To...', '1000000');

-- 두 번째 insert -> ERROR 1062 (23000): Duplicate entry
INSERT INTO solana_transfers (chain_id, slot_number, tx_signature, instruction_index,
  inner_instruction_index, transfer_type, from_address, to_address, amount)
VALUES (901, 250000000, '5xYzAbcDef...', 0, -1, 1, 'From...', 'To...', '1000000');
```
