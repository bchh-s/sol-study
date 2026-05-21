# 현재 시스템 (Dagaon Core)

상위 섹션: [1. 배경](../README.md)
원문: ../../solana-integration-research.md

---

## 원문 핵심 발췌

Dagaon Core는 EVM 호환 체인(Ethereum, Kaia, BSC, Tron)을 지원하는 커스터디얼 지갑 시스템이다. 블록체인 노드에서 데이터를 수집하여 Kafka/S3를 경유해 MySQL에 적재하는 **입금 파이프라인**과, API 요청을 받아 nonce 할당 -> KMS 서명 -> 브로드캐스트 -> 모니터링으로 이어지는 **출금 파이프라인**으로 구성된다.

### 전체 아키텍처 다이어그램

```
                          Dagaon Core - 전체 아키텍처
  ┌─────────────────────────────────────────────────────────────────────────────┐
  │                                                                             │
  │  ┌─── 입금 파이프라인 (Deposit Pipeline) ──────────────────────────────┐    │
  │  │                                                                     │    │
  │  │   ┌──────────┐    ┌─────────────┐    ┌──────────┐    ┌──────────┐  │    │
  │  │   │Blockchain│───>│   Block      │───>│  Kafka   │───>│  Block   │  │    │
  │  │   │  Node    │    │  Publisher   │    │  + S3    │    │ Consumer │  │    │
  │  │   │(geth 등) │    │             │    │          │    │          │  │    │
  │  │   └──────────┘    └──────┬──────┘    └──────────┘    └─────┬────┘  │    │
  │  │                          │                                  │       │    │
  │  │                   RingBuffer로                         MySQL에      │    │
  │  │                   parentHash 검증                    transfer 저장  │    │
  │  │                   (reorg 감지)                              │       │    │
  │  │                                                             ▼       │    │
  │  │                                                     ┌──────────┐   │    │
  │  │                                                     │  Event   │   │    │
  │  │                                                     │Confirmer │   │    │
  │  │                                                     │          │   │    │
  │  │                                                     └──────────┘   │    │
  │  │                                                     confirmation   │    │
  │  │                                                     blocks 대기    │    │
  │  └─────────────────────────────────────────────────────────────────────┘    │
  │                                                                             │
  │  ┌─── 출금 파이프라인 (Withdrawal Pipeline) ──────────────────────────┐    │
  │  │                                                                     │    │
  │  │   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐       │    │
  │  │   │   API    │──>│    tx-   │──>│    tx-   │──>│    tx-   │       │    │
  │  │   │ Request  │   │ ticketer │   │  signer  │   │  sender  │       │    │
  │  │   └──────────┘   └──────────┘   └──────────┘   └──────────┘       │    │
  │  │                   nonce 할당      KMS 서명       브로드캐스트       │    │
  │  │                   2-phase atomic  RLP 인코딩     eth_sendRaw       │    │
  │  │                                                       │            │    │
  │  │                                                       ▼            │    │
  │  │                                                 ┌──────────┐       │    │
  │  │                                                 │    tx-   │       │    │
  │  │                                                 │ monitor  │       │    │
  │  │                                                 └──────────┘       │    │
  │  │                                                 stuck 감지         │    │
  │  │                                                 gas bump/재전송    │    │
  │  └─────────────────────────────────────────────────────────────────────┘    │
  │                                                                             │
  │  ┌─── 공통 인프라 ────────────────────────────────────────────────────┐    │
  │  │                                                                     │    │
  │  │   ┌──────────┐   ┌──────────────────┐   ┌──────────────────────┐   │    │
  │  │   │ AWS KMS  │   │ ReplicationMgr   │   │   Plugin Registry    │   │    │
  │  │   │(secp256k1│   │ (etcd lease HA)  │   │ (blockchain/         │   │    │
  │  │   │ 키 관리) │   │                  │   │  registry.go)        │   │    │
  │  │   └──────────┘   └──────────────────┘   └──────────────────────┘   │    │
  │  └─────────────────────────────────────────────────────────────────────┘    │
  └─────────────────────────────────────────────────────────────────────────────┘
```

### 핵심 컴포넌트 상세

| 컴포넌트 | 역할 |
|----------|------|
| Block Publisher | 블록 데이터 수집, Kafka/S3 적재, reorg 감지 (RingBuffer + parentHash) |
| Block Consumer | Kafka에서 블록 소비, transfer 추출 (native/ERC20/ERC721), 감시 지갑 매칭 |
| Event Confirmer | `last_block - confirmation_blocks` 기반 finality 확정 |
| tx-ticketer | 출금 요청 수신, 순차 nonce 할당 (2-phase atomic) |
| tx-signer | AWS KMS로 secp256k1 서명, RLP 인코딩 |
| tx-sender | `eth_sendRawTransaction` 브로드캐스트 |
| tx-monitor | stuck TX 감지, gas bump, 재전송 |
| KMS | AWS KMS 기반 키 관리 (secp256k1) |
| ReplicationManager | etcd lease 기반 distributed lock (HA) |

---

## 공부할 내용

### 1. Block Publisher - 블록 수집과 Reorg 감지의 핵심

Block Publisher는 블록체인 노드에서 블록 데이터를 순차적으로 수집하여 Kafka 토픽과 S3 버킷에 적재하는 컴포넌트다. 단순한 데이터 수집기가 아니라, 체인의 무결성을 보장하는 첫 번째 방어선이다.

**블록 수집 루프:**
```
lastProcessed = DB에서 마지막 처리 블록 번호 조회
for n = lastProcessed + 1; ; n++ {
    block = eth_getBlockByNumber(n, true)  // full transactions
    if block == nil { sleep; continue }    // 아직 채굴 안 됨

    // reorg 감지: RingBuffer에 저장된 이전 블록의 hash와 현재 블록의 parentHash 비교
    if ringBuffer[n-1].hash != block.parentHash {
        // reorg 발생! fork point까지 되돌림
        forkPoint = findForkPoint(ringBuffer, block)
        rewindTo(forkPoint)
        n = forkPoint + 1
        continue
    }

    ringBuffer.push(block)
    kafka.produce(topic, block)
    s3.upload(key=block.number, body=block)
}
```

**RingBuffer 구조:**
RingBuffer는 최근 N개(보통 128-256개) 블록의 `(blockNumber, blockHash, parentHash)` 튜플을 메모리에 유지한다. 새 블록이 도착할 때마다 `block.parentHash == ringBuffer[lastIndex].hash`를 검증한다. 불일치가 발견되면 RingBuffer를 역순으로 탐색하여 fork point(체인이 분기된 지점)를 찾고, 해당 지점 이후의 모든 블록을 무효화(status=reorged)한 뒤 올바른 체인에서 재수집한다.

**Kafka/S3 듀얼 적재:**
Kafka는 실시간 스트리밍 소비를 위한 채널이고, S3는 재처리(replay)를 위한 영구 저장소다. Block Consumer가 일시적으로 다운되더라도 S3에서 블록을 재조회할 수 있으므로 데이터 유실이 없다. 이 패턴은 체인 종류와 무관하므로 Solana에서도 완전 재사용이 가능하다.

### 2. Block Consumer - Transfer 추출과 지갑 매칭

Block Consumer는 Kafka에서 블록 메시지를 소비하여 의미 있는 transfer 이벤트를 추출하고, 감시 대상 지갑(deposit 주소)과 매칭하여 MySQL에 저장하는 컴포넌트다.

**Transfer 추출 방식 (EVM):**
- **Native 전송 (ETH/KAIA/BNB):** `tx.value > 0`인 트랜잭션과 internal transaction traces에서 value transfer를 추출한다.
- **ERC20 토큰 전송:** receipt의 logs에서 `Transfer(address indexed from, address indexed to, uint256 value)` 이벤트를 탐지한다. `topic[0] = keccak256("Transfer(address,address,uint256)")` 매칭으로 식별한다.
- **ERC721 NFT 전송:** 동일한 Transfer event signature를 사용하되, `topic[3]`에 tokenId가 포함된다.

**감시 지갑 매칭:**
추출된 모든 transfer에서 `to_address`가 시스템에 등록된 deposit 지갑 주소인지 확인한다. 매칭되면 `transfers` 테이블에 `status=PENDING` 상태로 저장되며, 이후 Event Confirmer가 finality를 확정한다.

**Transfer 고유 식별자:**
```
(chain_id, block_hash, tx_hash, transfer_type, log_index, trace_address)
```
이 복합키로 동일 transfer의 중복 삽입을 방지한다 (idempotent upsert).

### 3. Event Confirmer - Finality 확정

EVM 체인에서는 블록이 채굴된 직후에는 reorg로 인해 무효화될 가능성이 있다. Event Confirmer는 `last_confirmed_block = current_block - confirmation_blocks` 공식을 적용하여 충분한 후속 블록이 쌓인 transfer만 `CONFIRMED` 상태로 전환한다.

**체인별 confirmation 요구 사항:**
| 체인 | confirmation_blocks | 예상 대기 시간 |
|------|---------------------|---------------|
| Ethereum | 15-64 | 3-13분 |
| Kaia | 1 (즉시 finality BFT) | ~1초 |
| BSC | 15 | ~45초 |

**처리 루프:**
```
confirmer_cursor = DB에서 마지막 확정 블록 번호 조회
current_block = DB에서 최신 블록 번호 조회
safe_block = current_block - confirmation_blocks

for block_num = confirmer_cursor + 1; block_num <= safe_block; block_num++ {
    UPDATE transfers SET status = 'CONFIRMED'
    WHERE block_number = block_num AND status = 'PENDING'
}
```

이 컴포넌트는 Solana에서는 불필요하다. `finalized` commitment으로 블록을 조회하면 추출 시점에 이미 최종성이 보장되기 때문이다.

### 4. tx-ticketer - Nonce 할당과 2-Phase Atomicity

tx-ticketer는 출금 파이프라인의 시작점으로, API에서 수신된 출금 요청을 순차적으로 처리하여 unsigned transaction을 생성한다.

**2-Phase Atomic 처리:**
```
Phase 1 (DB Transaction):
  1. SELECT * FROM withdrawal_requests WHERE status='QUEUED'
     ORDER BY id ASC FOR UPDATE SKIP LOCKED   ← 동시성 제어
  2. UPDATE withdrawal_requests SET status='PROCESSING'
  3. INSERT INTO withdrawal_transactions (request_id, ..., status='PENDING')
  COMMIT

Phase 2 (DB Transaction):
  1. SELECT current_nonce FROM wallets WHERE id=hot_wallet_id FOR UPDATE
  2. UPDATE wallets SET current_nonce = current_nonce + 1
  3. gas_price = eth_gasPrice() 또는 eth_maxPriorityFeePerGas()
  4. UPDATE withdrawal_transactions SET nonce=?, gas_price=?, status='NONCE_ASSIGNED'
  COMMIT
```

2-phase로 나누는 이유는, Phase 1에서 요청 상태를 먼저 잠그고, Phase 2에서 nonce를 할당함으로써 nonce 간격(gap)이 발생하지 않도록 보장하기 위함이다. Phase 1 이후 Phase 2 전에 프로세스가 죽으면, 요청은 `PROCESSING` 상태에 머물며 재시작 시 복구 로직이 이를 감지하여 재처리한다.

**`FOR UPDATE SKIP LOCKED` 패턴:**
여러 인스턴스가 동시에 출금 요청을 처리할 때, 이미 잠긴 행을 건너뛰고 다음 요청을 가져간다. 이를 통해 lock contention 없이 수평 확장이 가능하다.

### 5. tx-signer - KMS 서명과 RLP 인코딩

tx-signer는 unsigned transaction을 AWS KMS로 서명하여 signed transaction을 생성한다.

**서명 흐름:**
```
1. unsigned TX 필드 조합 (nonce, gasPrice, gasLimit, to, value, data, chainId)
2. RLP 인코딩 → 바이트 배열
3. keccak256(RLP bytes) → 32바이트 해시
4. AWS KMS Sign API 호출:
   - KeyId: CMK-xxx (secp256k1)
   - Message: 32바이트 해시
   - MessageType: DIGEST
   - SigningAlgorithm: ECDSA_SHA_256
5. DER 인코딩된 서명 응답 → (r, s) 추출
6. v 값 계산 (recovery id + chainId * 2 + 35, EIP-155)
7. signed TX = RLP(nonce, gasPrice, gasLimit, to, value, data, v, r, s)
8. tx_hash = keccak256(signed TX)
9. DB 저장: tx_hash, signed_tx_hex, status='SIGNED'
```

**핵심 원칙 - DB-before-network:**
서명 결과를 반드시 DB에 먼저 저장한 뒤 브로드캐스트한다. 서명 후 DB 저장 전에 프로세스가 죽으면, nonce가 소비되지 않았으므로 동일 nonce로 재서명하면 된다. 반대로 브로드캐스트 후 DB 저장 전에 죽으면, tx가 온체인에 이미 존재하는데 시스템은 이를 모르는 상태가 되어 nonce 충돌이 발생한다.

### 6. tx-sender - 트랜잭션 브로드캐스트

tx-sender는 서명 완료된 트랜잭션을 블록체인 노드에 전송한다.

**브로드캐스트 흐름:**
```
1. SELECT * FROM withdrawal_transactions WHERE status='SIGNED'
2. eth_sendRawTransaction(signed_tx_hex) 호출
3. 응답 처리:
   - 성공 (tx_hash 반환) → status='BROADCASTED', broadcasted_at=NOW()
   - "already known" → 이미 전송됨, status='BROADCASTED'
   - "nonce too low" → 이미 채굴됨, status='BROADCASTED'
   - "replacement underpriced" → gas가 너무 낮음, tx-monitor에서 bump 필요
   - 타임아웃 → retry_at 설정, 다음 폴링에서 재시도
```

**멱등성 보장:**
`eth_sendRawTransaction`은 이미 mempool에 존재하는 동일 TX를 재전송해도 에러가 아니라 "already known"을 반환한다. 따라서 tx-sender는 안전하게 재시도할 수 있다.

### 7. tx-monitor - Stuck TX 감지와 Gas Bump

tx-monitor는 브로드캐스트된 TX가 합리적 시간 내에 채굴되지 않을 때 이를 감지하고, gas price를 인상하여 재전송하는 컴포넌트다.

**모니터링 루프:**
```
1. SELECT * FROM withdrawal_transactions
   WHERE status='BROADCASTED' AND retry_at <= NOW()
2. eth_getTransactionReceipt(tx_hash) 호출
3. 분기:
   A) receipt 존재 + status=1 → COMPLETED (성공)
   B) receipt 존재 + status=0 → FAILED (실패, 수동 확인 필요)
   C) receipt 없음 + 오래됨 → stuck으로 판단
      - 새 gas price = 기존 * 1.1 (10% bump)
      - 동일 nonce로 새 TX 생성 → 새 TX row (status=PENDING)
      - 기존 TX row: status=RETRIED
      - tx-signer → tx-sender 파이프라인 재진입
```

**Gas Bump 전략:**
EVM에서는 동일 nonce로 더 높은 gas price의 TX를 전송하면 mempool에서 기존 TX를 대체(replacement)한다. 최소 10% 이상 높아야 노드가 수용한다. 이 메커니즘은 Solana에서는 존재하지 않는다 (mempool 자체가 없으므로).

### 8. KMS - 키 관리 서비스

AWS KMS를 사용하여 개인키를 HSM(Hardware Security Module) 내부에서 관리한다. 개인키는 절대 외부로 노출되지 않으며, 서명 작업은 KMS API를 통해서만 수행된다.

**현재 설정:**
- Key Spec: `ECC_SECG_P256K1` (secp256k1 곡선)
- Key Usage: `SIGN_VERIFY`
- Signing Algorithm: `ECDSA_SHA_256`
- Message Type: `DIGEST` (keccak256 해시를 전달)

**주소 도출:**
```
KMS GetPublicKey → DER 인코딩된 공개키
→ ASN.1 헤더 제거 → 64바이트 비압축 공개키
→ keccak256(pubkey) → 하위 20바이트 → "0x" + hex = 주소
```

Solana 통합 시 Ed25519 키 타입을 추가해야 하며, 동일 KMS 인스턴스에서 두 키 타입을 동시에 관리할 수 있다.

### 9. ReplicationManager - 고가용성

etcd의 lease 기반 distributed lock을 사용하여 각 컴포넌트의 active/standby 전환을 관리한다. 하나의 인스턴스만 active로 작동하고, active가 죽으면 standby가 lease를 획득하여 인계받는다.

**동작 원리:**
```
1. 인스턴스 시작 시 etcd에 lease 획득 시도 (TTL=10s)
2. lease 획득 성공 → active 모드로 전환, 주기적 lease 갱신
3. lease 획득 실패 → standby 모드, lease 감시
4. active 인스턴스의 lease 만료 감지 → standby가 lease 획득 → active 전환
```

이 컴포넌트는 완전히 체인 무관(chain-agnostic)하므로 Solana에서도 변경 없이 재사용된다.

---

## 개발할 내용

### 1. Solana용 Block Publisher 플러그인 구현

**컴포넌트:** `block-publisher/plugins/solana/`
**입력:** Solana RPC 노드 (HTTP + WebSocket)
**출력:** Kafka 토픽 (`solana.blocks.{chain_id}`) + S3 (`solana/blocks/{slot_number}.json`)

구현 범위:
- `getBlocks(startSlot, endSlot, "finalized")` 로 확인된 슬롯 목록 조회 (빈 슬롯 자동 제외)
- `getBlock(slot, {encoding: "jsonParsed", transactionDetails: "full", commitment: "finalized"})` 로 블록 데이터 수집
- previousBlockhash 기반 RingBuffer 검증 (방어적 구현, 실제 발동 가능성 극히 낮음)
- Kafka/S3 적재 포맷을 Solana 메시지 스키마로 정의

**실패 케이스와 재시도:**
- RPC 타임아웃: 지수 백오프로 재시도 (최대 3회), 이후 알림
- 빈 슬롯 구간이 너무 많은 경우: `getBlocks`의 endSlot 범위를 조절하여 응답 크기 제한
- RPC 노드 장애: 다중 RPC 엔드포인트 round-robin

**Idempotency:**
Kafka 프로듀서에 `enable.idempotence=true` 설정. S3는 동일 키 덮어쓰기로 자연스럽게 멱등.

**모니터링 포인트:**
- `solana_publisher_last_processed_slot` (게이지): 마지막 처리 슬롯
- `solana_publisher_lag_slots` (게이지): 현재 슬롯과의 차이
- `solana_publisher_blocks_per_second` (카운터): 초당 처리 블록 수
- `solana_publisher_rpc_error_total` (카운터): RPC 에러 횟수

### 2. Solana용 Block Consumer (Transfer 추출) 구현

**컴포넌트:** `block-consumer/plugins/solana/`
**입력:** Kafka 토픽 (`solana.blocks.{chain_id}`)
**출력:** MySQL `solana_transfers` 테이블

구현 범위:
- SOL native transfer 추출: `preBalances` vs `postBalances` 배열 비교
- SPL Token transfer 추출: `preTokenBalances` vs `postTokenBalances` 비교 (mint, owner, amount)
- 실패 TX 필터링: `meta.err != null` 인 트랜잭션은 반드시 제외
- 감시 지갑 매칭: base58 주소 형식으로 to_address 매칭

**Transfer 고유 식별자 (Solana):**
```
(chain_id, slot_number, tx_signature, instruction_index, inner_instruction_index)
```

**실패 케이스:**
- 실패 TX를 입금으로 잘못 인식: `meta.err` 체크를 transfer 추출 전에 반드시 수행
- balance diff 계산 오류: fee 차감분을 고려해야 함 (fee payer의 잔액 변동에서 fee 분리)

### 3. Event Confirmer - Solana에서 제거

**결정:** Solana 파이프라인에서 Event Confirmer 단계를 제거한다.
**근거:** `finalized` commitment으로 폴링하면 추출 시점에 이미 최종성이 보장된다. 추가 confirmation 대기는 지연만 추가하고 안전성 이득이 없다.
**feature flag:** `chain_config.solana.skip_event_confirmer = true` 로 체인별 분기

### 4. tx-ticketer를 tx-preparer로 대체 (Solana용)

**컴포넌트:** `tx-preparer/solana/`
**입력:** MySQL `withdrawal_requests` (status=QUEUED)
**출력:** MySQL `solana_withdrawal_transactions` (status=PENDING)

구현 범위:
- 순차 nonce 할당 대신 durable nonce 풀에서 free nonce 계정 할당 (`status=FREE` -> `IN_USE`)
- nonce 계정의 storedNonce 값 RPC 조회 (`getAccountInfo`)
- compute unit limit/price 조회 (`getRecentPrioritizationFees`)
- `AdvanceNonceAccount` instruction을 첫 번째로 배치한 unsigned TX 빌드

**2-Phase Atomic 유지:**
```
Phase 1: 요청 상태 PROCESSING + TX row 생성 (동일)
Phase 2: nonce 풀에서 free 계정 할당 + compute unit 조회 + unsigned TX 필드 완성
```

**실패 케이스:**
- nonce 풀 고갈: `pool_utilization_rate` 알림, 동적 nonce 계정 생성 트리거
- storedNonce 조회 실패: RPC 재시도 후에도 실패 시 다른 nonce 계정으로 전환

### 5. tx-signer Solana 확장

**컴포넌트:** `tx-signer/solana/`
**입력:** `solana_withdrawal_transactions` (status=PENDING)
**출력:** `solana_withdrawal_transactions` (status=SIGNED, tx_signature, signed_tx)

구현 범위:
- Solana TX message serialize (해싱 불필요, Ed25519가 내부적으로 SHA-512 사용)
- KMS Sign (KeySpec=`ECC_NIST_EDWARDS25519`, Algorithm=`EDDSA_ED25519_SHA_512`, MessageType=`RAW`)
- tx_signature = base58(서명의 처음 64바이트)
- **DB 저장 후 반환 (DB-before-network 원칙 유지)**

### 6. tx-sender Solana 구현

**컴포넌트:** `tx-sender/solana/`
**입력:** `solana_withdrawal_transactions` (status=SIGNED)
**출력:** `solana_withdrawal_transactions` (status=BROADCASTED)

구현 범위:
- `sendTransaction(signed_tx, {maxRetries: 0, skipPreflight: false})` 호출
- mempool이 없으므로 2초 간격 적극적 재전송 루프 시작
- `signatureSubscribe` WebSocket으로 확인 대기 (또는 폴링 fallback)
- 재전송은 동일 signed TX를 반복 전송 (서명이 같으므로 멱등)

**실패 케이스:**
- TX 드롭 (리더가 수신 못함): 2초 간격 재전송으로 자연스럽게 커버
- blockhash 만료: durable nonce 사용 시 만료 없으므로 해당 없음
- preflight 시뮬레이션 실패: 에러 로그 + 알림, 수동 확인 필요

### 7. tx-monitor Solana 구현

**컴포넌트:** `tx-monitor/solana/`
**입력:** `solana_withdrawal_transactions` (status=BROADCASTED)
**출력:** `solana_withdrawal_transactions` (status=COMPLETED 또는 DROPPED 후 재시도)

구현 범위:
- `getSignatureStatuses([signature])` 배치 조회
- `confirmationStatus == "finalized"` → COMPLETED, nonce 계정 반환 (`status=FREE`)
- `err != null` → 실패 TX, nonce advance로 취소 후 새 nonce로 재시도
- 장기 미확인 → priority fee bump + 새 TX 생성 (새 signature)

**Gas bump 대신 priority fee bump:**
EVM에서는 동일 nonce로 gas를 올려 replacement TX를 보내지만, Solana에서는 기존 TX를 취소(nonce advance)하고 더 높은 priority fee로 완전히 새 TX를 생성해야 한다.

---

## 실습/검증 과제

### 과제 1: 현재 EVM 파이프라인 코드 리딩

- [ ] `block-publisher/` 디렉토리에서 RingBuffer 구현체를 찾아 parentHash 검증 로직 확인
- [ ] `block-consumer/` 디렉토리에서 ERC20 Transfer event 파싱 로직 확인 (topic0 매칭)
- [ ] `tx-ticketer/` 디렉토리에서 2-phase atomic nonce 할당 로직 확인 (FOR UPDATE SKIP LOCKED)
- [ ] `tx-signer/` 디렉토리에서 KMS Sign 호출부와 RLP 인코딩 확인
- [ ] `blockchain/registry.go`에서 plugin registry 패턴 확인 (현재 "eth" 타입만 등록)

### 과제 2: Solana RPC 응답 비교

- [ ] devnet에서 `getBlock` 응답 JSON을 저장하여 EVM `eth_getBlockByNumber` 응답과 구조 비교
- [ ] devnet에서 SOL transfer TX와 SPL token transfer TX의 `preBalances`/`postBalances` 확인
- [ ] `getSignatureStatuses` 응답에서 commitment level 필드 확인

### 과제 3: Acceptance Criteria

- [ ] Block Publisher의 RingBuffer 로직을 다이어그램으로 그려 reorg 시나리오 시뮬레이션 완료
- [ ] 출금 파이프라인의 각 단계별 DB 상태 전이를 state machine으로 정리 완료
- [ ] 각 컴포넌트의 Solana 변경 사항을 입력/출력 DTO 수준까지 명세 완료

---

## 완료 기준

- 9개 핵심 컴포넌트 각각의 역할, 입력, 출력, 상태 전이, 실패 케이스가 문서화되어 있다.
- 입금 파이프라인(Block Publisher -> Kafka/S3 -> Block Consumer -> Event Confirmer)의 전체 데이터 흐름을 시퀀스 다이어그램으로 설명할 수 있다.
- 출금 파이프라인(tx-ticketer -> tx-signer -> tx-sender -> tx-monitor)의 2-phase atomicity와 DB-before-network 원칙을 코드 레벨에서 추적 완료했다.
- 각 컴포넌트의 Solana 대응 변경 사항(재사용/수정/신규)이 구체적 DTO와 함께 정리되어 있다.
- Plugin registry 패턴의 확장 지점을 파악하여 "solana" 타입 등록 방법을 설명할 수 있다.
