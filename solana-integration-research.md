# Dagaon Core - Solana 통합 리서치 보고서

> 작성일: 2026-05-20
> 목적: Solana 체인을 기존 EVM 기반 Dagaon Core 커스터디얼 지갑 시스템에 통합하기 위한 기술 리서치

---

## 목차

1. [배경](#1-배경)
2. [EVM vs Solana 핵심 차이 요약](#2-evm-vs-solana-핵심-차이-요약)
3. [Q1: Block Sync 아키텍처 호환성](#3-q1-block-sync-아키텍처-호환성)
4. [Q2: KMS Solana 지원 가능 여부](#4-q2-kms-solana-지원-가능-여부)
5. [Q3: TX 전송 및 재전송 방식](#5-q3-tx-전송-및-재전송-방식)
6. [Q4: Fee Delegation](#6-q4-fee-delegation)
7. [Solana 기초 개념 상세](#7-solana-기초-개념-상세)
8. [컴포넌트별 영향도 분석](#8-컴포넌트별-영향도-분석)
9. [DB 스키마 영향](#9-db-스키마-영향)
10. [RPC API 레퍼런스](#10-rpc-api-레퍼런스)
11. [리스크 평가](#11-리스크-평가)
12. [Architecture Decision Records](#12-architecture-decision-records)
13. [구현 페이즈](#13-구현-페이즈)
14. [결론](#14-결론)
15. [참고자료](#15-참고자료)

---

## 1. 배경

### 현재 시스템 (Dagaon Core)

Dagaon Core는 EVM 호환 체인(Ethereum, Kaia, BSC, Tron)을 지원하는 커스터디얼 지갑 시스템이다.

**입금 파이프라인:**
```
Blockchain Node → Block Publisher → Kafka + S3 → Block Consumer → MySQL → Event Confirmer
```

**출금 파이프라인:**
```
API Request → tx-ticketer → tx-signer (KMS) → tx-sender → tx-monitor
```

**핵심 컴포넌트:**

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

### 현재 EVM 전제 조건들

- 모든 블록에 parentHash 존재 → RingBuffer로 reorg 감지
- sender별 순차 정수 nonce → atomic increment로 관리
- EIP-1559 가스 모델 (maxFeePerGas, maxPriorityFeePerGas)
- 42자 hex 주소 (0x prefix)
- ERC20 Transfer event log 파싱
- 고정 21,000 gas (native transfer)
- mempool에 TX 대기 → 언젠가 채굴되거나 replacement
- RLP 인코딩/디코딩
- Plugin registry 패턴 (`blockchain/registry.go`) → 현재 "eth" 타입만 구현

---

## 2. EVM vs Solana 핵심 차이 요약

| 구분 | EVM (현재) | Solana |
|------|-----------|--------|
| **블록 단위** | Block (12s/block) | Slot (400ms/slot), 빈 슬롯 존재 |
| **Finality** | confirmation_blocks 카운트 (15~64블록) | Commitment level: processed/confirmed/finalized (~13s) |
| **Reorg** | 발생함 → parentHash RingBuffer로 감지 | finalized 레벨에서 관측된 적 없음 |
| **Nonce** | 순차 정수 (sender별) | 없음 → recent blockhash (60-90초 만료) 또는 durable nonce |
| **Mempool** | 있음 (pending tx 체류) | 없음 → 현재 리더에게 직접 전달, 드롭 가능 |
| **서명 알고리즘** | secp256k1 (ECDSA) | Ed25519 (EdDSA) |
| **주소 형식** | 0x + 40자 hex (42자) | base58, 32-44자 |
| **토큰 표준** | ERC20 (event log 기반) | SPL Token (balance diff 기반) |
| **Fee** | Gas (baseFee + priorityFee, 글로벌 시장) | Base 5,000 lamports + priority fee (로컬 시장) |
| **Fee Delegation** | 복잡 (meta-tx, EIP-2771, Paymaster) | 네이티브 지원 (fee payer = 첫 번째 서명자) |
| **계정 모델** | 잔액만 있으면 수신 가능 | 계정 생성 필요 (rent-exempt deposit ~0.002 SOL) |
| **TX 크기** | Gas limit으로 제한 | 1,232 bytes 하드 리밋 |
| **실패 TX** | 블록에 포함되나 gas만 소비 | 블록에 포함되며 base fee 소비 (5,000 lamports) |
| **TX 구조** | 단일 함수 호출 | 다중 instruction 번들 (atomic batch) |
| **병렬 실행** | 순차 실행 (EVM) | 병렬 실행 (Sealevel, 충돌 없는 TX끼리) |

---

## 3. Q1: Block Sync 아키텍처 호환성

### 결론: 가능하다. 스캐닝 방식만 변경 필요.

### 3.1 Slot/Block 모델 이해

Solana의 시간 단위는 **Slot** (약 400ms)이다.

```
Epoch (~2-3일)
└── 432,000 Slots
    ├── Slot 100: Block 생성됨 (리더가 TX 처리)
    ├── Slot 101: 빈 슬롯 (리더 오프라인 or 포크 폐기)
    ├── Slot 102: Block 생성됨
    └── ...
```

- 모든 슬롯이 블록을 생성하지는 않음 (빈 슬롯 존재)
- `slot_number ≠ block_height` (block_height는 빈 슬롯을 건너뜀)
- 각 슬롯은 단일 validator(리더)에게 배정됨

### 3.2 블록 스캐닝 방식 비교

**EVM (현재):**
```
for n = lastProcessed+1; getBlockByNumber(n); n++
// 모든 블록 번호에 블록이 존재하므로 단순 순차 증가
```

**Solana (변경):**
```
// 1. 확인된 슬롯 목록 조회 (빈 슬롯 자동 제외)
slots = getBlocks(lastProcessedSlot+1, currentSlot, "finalized")

// 2. 각 슬롯의 블록 데이터 조회
for each slot in slots:
    block = getBlock(slot, {
        encoding: "jsonParsed",
        transactionDetails: "full",
        maxSupportedTransactionVersion: 0,
        commitment: "finalized"
    })
```

### 3.3 Reorg 처리

**EVM:** parentHash를 RingBuffer에 저장하여 체인 연속성 검증. 불일치 시 fork point까지 되돌림.

**Solana:**
- `finalized` commitment에서 reorg가 관측된 적 없음
- 블록에 `previousBlockhash` 필드가 있어 RingBuffer 검증은 기술적으로 가능
- **방어적 구현:** RingBuffer를 유지하되, 실제로 트리거될 일은 없음

**Commitment Level별 reorg 리스크:**

| Level | 지연 시간 | Reorg 리스크 | 용도 |
|-------|----------|-------------|------|
| `processed` | ~400ms | 있음 (약 5% fork rate) | 개발/테스트용. **입금에 절대 사용 금지** |
| `confirmed` | ~600ms | 이론적으로 가능, 실제 관측된 적 없음 | 잔액 표시, 비핵심 UI |
| `finalized` | ~13s | 불가능 (경제적으로 비실현적) | **입금 확정에 사용** |

### 3.4 Kafka/S3 적재

완전 재사용 가능. 메시지 포맷만 변경:

**EVM 메시지 포맷:**
```json
{
  "blockNumber": 12345678,
  "blockHash": "0xabc...",
  "parentHash": "0xdef...",
  "timestamp": "0x5f5e100",
  "transactions": [
    {
      "index": 0,
      "transaction": { "..." },
      "receipt": { "..." },
      "traces": [ "..." ]
    }
  ]
}
```

**Solana 메시지 포맷 (제안):**
```json
{
  "slotNumber": 289567890,
  "blockHeight": 267890123,
  "blockhash": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp...",
  "previousBlockhash": "4sGjMW1sUnHzSxGspuhSqoGX4i...",
  "parentSlot": 289567889,
  "blockTime": 1716230400,
  "transactions": [
    {
      "signature": "5UfDuX7WXY4J3...",
      "slot": 289567890,
      "err": null,
      "fee": 5000,
      "preBalances": [1000000, 500000],
      "postBalances": [995000, 505000],
      "preTokenBalances": [],
      "postTokenBalances": [],
      "instructions": [ "..." ]
    }
  ]
}
```

### 3.5 Transfer 추출 방식 비교

**EVM (현재):**
- Native 전송: `tx.value > 0` 확인 + internal transaction traces
- ERC20: `Transfer(address,address,uint256)` event log 파싱 (topic0 매칭)
- ERC721: 같은 Transfer event이나 token ID 포함

**Solana (변경):**
- Native SOL 전송: `preBalances` vs `postBalances` 배열 비교
- SPL Token 전송: `preTokenBalances` vs `postTokenBalances` 비교
  - mint address, owner, amount 정보 포함
- NFT: SPL Token과 동일 메커니즘 (supply=1인 mint)
- **실패한 TX는 반드시 `meta.err` 확인 후 제외** (EVM과 달리 실패 TX도 블록에 포함됨)

Transfer 고유 식별자 변경:
```
EVM:   (chain_id, block_hash, tx_hash, transfer_type, log_index, trace_address)
Solana: (chain_id, slot_number, tx_signature, instruction_index, inner_instruction_index)
```

### 3.6 Event Confirmer

**Solana에서 불필요.** `finalized` commitment으로 폴링하면 추출 시점에 이미 최종성이 보장된다.

EVM에서는 `last_block - confirmation_blocks` 임계값으로 확정하지만, Solana에서는 commitment level 자체가 finality를 보장하므로 별도 confirmer 단계가 필요 없다.

---

## 4. Q2: KMS Solana 지원 가능 여부

### 결론: 가능하다. AWS KMS가 Ed25519를 네이티브 지원한다 (2025.11~).

### 4.1 키/서명 알고리즘 비교

| 항목 | EVM | Solana |
|------|-----|--------|
| 곡선 | secp256k1 (Koblitz) | Ed25519 (Edwards) |
| 서명 방식 | ECDSA (랜덤 nonce 사용) | EdDSA (결정적, 동일 입력 = 동일 서명) |
| 개인키 크기 | 32 bytes | 32 bytes (seed) 또는 64 bytes (seed+pubkey) |
| 공개키 크기 | 64 bytes (비압축) / 33 bytes (압축) | 32 bytes |
| 서명 크기 | 65 bytes (r, s, v) | 64 bytes |
| 주소 길이 | 20 bytes → 42자 hex | 32 bytes → 32-44자 base58 |
| 주소 = 공개키? | 아니요 (keccak256 해시) | 예 (공개키 = 주소) |
| BIP-44 경로 | m/44'/60'/0'/0/0 | m/44'/501'/0'/0' |

### 4.2 AWS KMS 설정 비교

| 항목 | EVM | Solana |
|------|-----|--------|
| Key Spec | `ECC_SECG_P256K1` | `ECC_NIST_EDWARDS25519` |
| Key Usage | `SIGN_VERIFY` | `SIGN_VERIFY` |
| Signing Algorithm | `ECDSA_SHA_256` | `EDDSA_ED25519_SHA_512` |
| Message Type | `DIGEST` (keccak256 해시 전달) | `RAW` (원본 메시지 바이트 전달) |

### 4.3 공개키 추출 및 주소 도출

**EVM:**
```
1. KMS GetPublicKey → DER 인코딩된 secp256k1 공개키
2. ASN.1 헤더 제거 → 64바이트 비압축 공개키
3. keccak256(pubkey) → 32바이트 해시
4. 하위 20바이트 추출 → "0x" + hex 인코딩 = 주소
```

**Solana:**
```
1. KMS GetPublicKey → DER 인코딩된 Ed25519 공개키
2. ASN.1 헤더 제거 (12바이트 고정 헤더) → 32바이트 raw 공개키
3. base58 인코딩 = 주소 (해싱 불필요)
```

### 4.4 서명 워크플로우 비교

**EVM:**
```
1. unsigned TX → RLP 인코딩
2. RLP bytes → keccak256 해시 (32 bytes)
3. KMS Sign(해시, ECDSA_SHA_256) → 65바이트 서명 (r, s, v)
4. TX + 서명 → RLP 인코딩 = signed TX
```

**Solana:**
```
1. Transaction message 빌드 (instructions, accounts, blockhash/nonce)
2. message를 직접 serialize (해싱 불필요 - Ed25519가 내부적으로 SHA-512 사용)
3. KMS Sign(serialized message, EDDSA_ED25519_SHA_512) → 64바이트 서명
4. [서명 배열] + [message] = signed TX (Solana 바이너리 포맷)
```

### 4.5 듀얼 체인 KMS 아키텍처

```
                AWS KMS Instance
                ┌──────────────────────┐
                │  CMK-1 (secp256k1)   │ ← EVM chains
                │  CMK-2 (secp256k1)   │ ← EVM chains
                │  CMK-3 (Ed25519)     │ ← Solana
                │  CMK-4 (Ed25519)     │ ← Solana
                └──────────────────────┘
                         │
            ┌────────────┴────────────┐
            ▼                         ▼
    EVM Signer Module         Solana Signer Module
    - RLP 인코딩               - Solana TX 빌드
    - keccak256 해시            - raw message 전달
    - ECDSA_SHA_256            - EDDSA_ED25519_SHA_512
    - hex 주소 도출             - base58 주소 도출
```

동일 인스턴스에서 두 키 타입을 동시에 관리 가능. 인프라 중복 불필요.

---

## 5. Q3: TX 전송 및 재전송 방식

### 결론: Durable Nonce를 사용해야 한다. Mempool이 없으므로 적극적 재전송 필수.

### 5.1 왜 Durable Nonce인가?

**Recent Blockhash 방식의 문제:**
```
1. getLatestBlockhash() → blockhash + lastValidBlockHeight
2. TX 빌드 → KMS 서명 (수 초 소요)
3. TX 브로드캐스트
4. 60-90초 내에 미확인 시 → 만료, 처음부터 다시

문제: KMS 라운드트립 + 정책 승인 + 큐 대기 = 60초 초과 가능
     만료 직전 제출 시 → 온체인 확인 + 리트라이 중복 위험
```

**Durable Nonce 방식:**
```
1. 사전 생성된 nonce 계정에서 nonce 값 조회
2. TX 빌드 (AdvanceNonceAccount 명령어를 첫 번째로 배치)
3. KMS 서명 (시간 제약 없음)
4. TX 브로드캐스트 → 확인될 때까지 무기한 재전송 가능
5. 취소 시: nonce advance만 실행 → 기존 TX 자동 무효화

장점: 만료 없음, 결정적 취소 가능, 서명 후 임의 시간 대기 가능
```

### 5.2 Durable Nonce 상세

**Nonce 계정이란?**
- 온체인에 생성되는 특수 System Program 계정
- 내부에 `storedNonce` 값 (32바이트 blockhash 형태) 저장
- `AdvanceNonce` 명령어가 실행되면 값이 갱신됨
- TX의 blockhash 필드에 이 storedNonce를 넣으면 만료되지 않음

**Nonce 계정 생성:**
```
1. CreateAccount (rent-exempt ~0.0015 SOL)
2. InitializeNonceAccount(nonce_authority: hot_wallet_pubkey)
→ nonce 계정 준비 완료
```

**TX에서의 사용:**
```
Transaction:
  Instruction[0]: AdvanceNonceAccount(nonce_account, authority)  ← 반드시 첫 번째
  Instruction[1]: Transfer(from, to, amount)                    ← 실제 작업
  ...
  recentBlockhash: <nonce 계정의 storedNonce 값>               ← 일반 blockhash 대신
```

**취소 방법:**
```
// nonce만 advance하고 다른 명령어 없이 실행
Transaction:
  Instruction[0]: AdvanceNonceAccount(nonce_account, authority)
→ storedNonce가 바뀌므로 이전 서명된 TX는 자동 무효화
```

### 5.3 출금 파이프라인 비교 (EVM vs Solana)

**EVM (현재):**
```
tx-ticketer:
  1. 요청 획득 (FOR UPDATE SKIP LOCKED)
  2. Phase 1: 요청 상태 PROCESSING, TX row 생성
  3. Phase 2: nonce 할당 (current_nonce++ atomic), gas 조회
  → unsigned TX 생성

tx-signer:
  1. RLP 인코딩 → keccak256 해시
  2. KMS Sign (ECDSA)
  3. DB 저장 (tx_hash, signed_tx, status=SIGNED) ← 반드시 브로드캐스트 전

tx-sender:
  1. eth_sendRawTransaction
  2. "already known" / "nonce too low" → BROADCASTED
  3. "replacement underpriced" → gas bump 필요
  4. timeout → retry_at 설정

tx-monitor:
  1. stuck TX 폴링 (retry_at <= NOW())
  2. BROADCASTED + stuck → gas bump (+10%), 새 TX row (RETRIED → PENDING)
  3. receipt 확인 → COMPLETED
```

**Solana (변경):**
```
tx-preparer (tx-ticketer 대체):
  1. 요청 획득 (동일)
  2. nonce 풀에서 free nonce 계정 할당 (status=in_use)
  3. nonce 계정의 storedNonce 값 조회 (getNonce RPC)
  4. compute unit limit/price 조회 (getRecentPrioritizationFees)
  → unsigned TX 생성 (AdvanceNonce + Transfer)

tx-signer:
  1. Solana TX message serialize
  2. KMS Sign (Ed25519, raw message)
  3. DB 저장 (tx_signature, signed_tx, status=SIGNED) ← 반드시 브로드캐스트 전

tx-sender:
  1. sendTransaction(signed_tx, {maxRetries: 0, skipPreflight: false})
  2. 2초 간격 재전송 루프 시작 (mempool이 없으므로 필수)
  3. signatureSubscribe WebSocket으로 확인 대기

tx-monitor:
  1. 미확인 TX 폴링
  2. signatureStatuses 조회
     - confirmed/finalized → COMPLETED, nonce 계정 반환 (status=free)
     - 실패 (err != null) → nonce advance로 취소, 새 nonce로 재시도
     - 장기 미확인 → priority fee bump 후 재시도 (새 TX signature 생성)
```

### 5.4 EVM과의 핵심 차이

| 항목 | EVM | Solana |
|------|-----|--------|
| 재전송 | gas bump으로 같은 nonce 덮어쓰기 | 불가능. 새 TX 생성 필요 |
| TX 대기 | mempool에서 대기 | 리더가 안 받으면 드롭 |
| 재전송 주기 | gas bump 시에만 | **2초마다 적극적 재전송** |
| 취소 | 같은 nonce로 self-transfer | durable nonce advance |
| 동시 출금 | nonce 순서대로 자동 직렬화 | nonce 계정 풀 크기 = 동시 처리 한도 |
| stuck 판단 | receipt 미확인 + 시간 경과 | signatureStatus 조회 결과 없음 |

### 5.5 Nonce 계정 풀 관리

```
Nonce Account Pool (per hot wallet)
┌─────────────────────────────────────────┐
│ nonce_account_1: FREE    (storedNonce: abc123...)  │
│ nonce_account_2: IN_USE  (storedNonce: def456...)  │ ← 출금 TX #42에 사용 중
│ nonce_account_3: FREE    (storedNonce: ghi789...)  │
│ nonce_account_4: IN_USE  (storedNonce: jkl012...)  │ ← 출금 TX #43에 사용 중
│ ...                                                 │
│ nonce_account_N: FREE    (storedNonce: xyz999...)  │
└─────────────────────────────────────────┘

관리 규칙:
- 사전 할당: 핫월렛당 100개 (peak 동시 출금 수 기준)
- 비용: 100 * 0.0015 SOL = 0.15 SOL (반환 가능)
- 부족 시: 동적 생성 + 알림
- 모니터링: pool utilization rate 추적
```

---

## 6. Q4: Fee Delegation

### 결론: Solana가 EVM보다 훨씬 간단하게 네이티브 지원한다.

### 6.1 Solana의 Fee Payer 모델

Solana에서 TX의 **첫 번째 서명자**가 자동으로 fee payer가 된다.

```
Transaction:
  Signatures: [hot_wallet_sig, ...]  ← 첫 번째 = fee payer
  Message:
    Account Keys: [hot_wallet, user_wallet, token_program, ...]
    Instructions: [...]
```

- 스마트 컨트랙트 불필요
- Relay 인프라 불필요
- 추가 gas 오버헤드 0%

### 6.2 EVM과의 비교

| 항목 | EVM | Solana |
|------|-----|--------|
| 방식 | Meta-tx (EIP-2771), Forwarder 컨트랙트, Paymaster (EIP-4337) | fee payer = 첫 번째 서명자 |
| 컨트랙트 배포 | 필요 (Forwarder, Paymaster) | 불필요 |
| Relay 서버 | 필요 | 불필요 |
| 추가 Gas 오버헤드 | 30-50% | 0% |
| 구현 복잡도 | 높음 | 최소 |
| 유저 서명 필요? | 필요 (meta-tx에 서명) | 커스터디얼이면 불필요 |

### 6.3 Dagaon Core 커스터디얼 모델에서의 적용

```
커스터디얼 출금 흐름:
1. 핫월렛(출금 지갑)이 fee payer이자 authority
2. 유저 deposit 지갑은 SOL 없이 SPL 토큰만 보유 가능
3. collect(sweep) 시에도 핫월렛이 fee 부담
4. 유저는 가스비 개념을 알 필요 없음

→ EVM에서 fee delegation을 위해 구축한 인프라가 Solana에서는 기본 기능으로 제공됨
```

### 6.4 Fee 구조 상세

**기본 수수료:**
- TX당 5,000 lamports (서명 1개당) ≈ $0.001 (@$200/SOL)
- 50% 소각, 50% validator에게 지급

**Priority Fee (선택):**
```
prioritization_fee = ceil(compute_unit_price * compute_unit_limit / 1,000,000) lamports

예시:
  compute_unit_price = 1,000 micro-lamports
  compute_unit_limit = 200,000 CU
  priority_fee = ceil(1000 * 200000 / 1000000) = 200 lamports ≈ $0.00004
```

**Compute Unit 한도:**
- 명령어당 기본: 200,000 CU
- TX당 최대: 1,400,000 CU
- 빌트인 명령어: 3,000 CU

**로컬 Fee 시장:**
- EVM과 달리 Solana는 프로그램별 독립적 fee 시장
- 관련 없는 프로그램의 트래픽이 우리 TX의 fee에 영향 없음

---

## 7. Solana 기초 개념 상세

### 7.1 합의 메커니즘

**Tower BFT + Proof of History (PoH)**

- PoH: SHA-256 해시 체인으로 글로벌 시계 역할. 합의 전에 이벤트 순서를 결정
- Tower BFT: PBFT 변형. validator들이 포크에 투표
- 지수적 lockout: 깊은 reorg일수록 기하급수적으로 비용 증가 (스테이킹 슬래싱)
- 66% supermajority 투표 → `confirmed`
- 31+ 후속 블록 → `finalized` (최대 lockout 도달)

### 7.2 계정 모델

Solana는 **모든 것이 계정**이다.

```
Account {
  lamports: u64,          // SOL 잔액
  data: Vec<u8>,          // 임의 데이터 (프로그램이 해석)
  owner: Pubkey,          // 이 계정을 소유한 프로그램
  executable: bool,       // 프로그램 코드인가?
  rent_epoch: u64         // 렌트 관련
}
```

**Rent (임대료):**
- 모든 계정은 rent-exempt 최소 잔액을 유지해야 함
- 공식: `(128 + data_size) * 6,960 lamports`
- 미달 시 garbage collection (계정 삭제)
- **Rent는 보증금** - 계정 close 시 반환됨

**주요 계정 비용:**
| 계정 유형 | 데이터 크기 | Rent-exempt 비용 |
|----------|-----------|----------------|
| 기본 SOL 계정 | 0 bytes | ~0.00089 SOL |
| SPL Token 계정 | 165 bytes | ~0.00204 SOL |
| Nonce 계정 | 80 bytes | ~0.00145 SOL |

### 7.3 Associated Token Account (ATA)

EVM에서는 어떤 주소든 ERC20 토큰을 받을 수 있지만, Solana에서는 **토큰별로 전용 계정이 필요**하다.

```
ATA 주소 도출:
PDA = findProgramAddress(
  [wallet_address, TOKEN_PROGRAM_ID, mint_address],
  ASSOCIATED_TOKEN_PROGRAM_ID
)

예시:
  유저 지갑: 7Np41...
  USDC mint: EPjFW...
  → ATA: 3xnB7... (결정적 도출, 유니크)
```

**ATA 생성 시점:**
- 최초 토큰 수신 전에 생성 필요
- `createAssociatedTokenAccountIdempotent` 사용 (이미 존재하면 무시)
- 생성 비용: ~0.00204 SOL (fee payer가 부담)
- Lazy 생성 권장: 해당 토큰을 처음 사용할 때 생성

### 7.4 Transaction 구조

```
Transaction (Legacy) {
  signatures: [Signature],        // Ed25519 서명 배열 (64 bytes each)
  message: {
    header: {
      numRequiredSignatures: u8,
      numReadonlySignedAccounts: u8,
      numReadonlyUnsignedAccounts: u8
    },
    accountKeys: [Pubkey],        // 참여 계정 목록 (순서 중요)
    recentBlockhash: Hash,        // 또는 durable nonce 값
    instructions: [
      {
        programIdIndex: u8,       // accountKeys 내 인덱스
        accounts: [u8],           // accountKeys 내 인덱스 배열
        data: [u8]                // 프로그램별 인코딩된 데이터
      }
    ]
  }
}
```

**Versioned Transaction (v0):**
- Address Lookup Tables (ALT) 지원
- 더 많은 계정을 참조 가능 (1,232 byte 제한 완화)
- `maxSupportedTransactionVersion: 0` 설정 필요

### 7.5 프로그램 (스마트 컨트랙트)

| EVM 용어 | Solana 용어 | 설명 |
|----------|------------|------|
| Smart Contract | Program | 실행 가능한 코드 |
| Contract Storage | Account Data | 프로그램이 소유한 계정의 data 필드 |
| msg.sender | Signer | TX에 서명한 계정 |
| ETH transfer | SOL transfer (System Program) | 네이티브 토큰 전송 |
| ERC20 | SPL Token | 대체 가능 토큰 |
| ERC721 | Metaplex NFT (SPL Token, supply=1) | NFT |

---

## 8. 컴포넌트별 영향도 분석

| 컴포넌트 | 재사용 수준 | 변경 내용 |
|----------|------------|----------|
| **Kafka + S3 전송** | 완전 재사용 | 메시지 포맷만 변경 |
| **ReplicationManager (etcd)** | 완전 재사용 | 변경 없음 |
| **Plugin registry** (`blockchain/registry.go`) | 완전 재사용 | "solana" 타입 등록 |
| **KMS AWS 통합** (`services/kms/kms.go`) | 높은 재사용 | Ed25519 KeySpec/SigningAlgo 추가, base58 주소 도출 |
| **Append-only TX 로그** | 높은 재사용 | 필드 변경 (nonce→blockhash, gas→compute units) |
| **지갑 주소 매칭** | 중간 재사용 | base58 주소 포맷 대응 |
| **Block Publisher 스캐닝** | 새로 구현 | slot 기반 스캐닝, getBlocks+getBlock |
| **Transfer 추출** (Block Consumer) | 새로 구현 | event log → preBalances/postBalances diff 방식 |
| **Event Confirmer** | **제거** | finalized commitment에서 불필요 |
| **Nonce 관리** | 새로 구현 | 순차 nonce → durable nonce 풀 |
| **TX 빌딩 + 서명** | 새로 구현 | RLP → Solana 바이너리 포맷, Ed25519 |
| **TX 전송 + 재시도** | 새로 구현 | mempool 없음, 2초 간격 적극적 재전송 |
| **Fee 추정** | 새로 구현 | gas → compute units + priority fee |
| **ATA 관리** | 완전 신규 | SPL 토큰 수신을 위한 계정 생성 |
| **Durable Nonce 풀** | 완전 신규 | EVM에 없는 개념 |

---

## 9. DB 스키마 영향

### 권장: Solana 전용 테이블 생성

EVM 테이블에 nullable 컬럼을 추가하는 것보다 Solana 전용 테이블을 분리하는 것이 낫다.
데이터 모델 차이가 너무 크기 때문에 공유 테이블은 50% 이상 NULL 컬럼이 되며, 유지보수가 어려워진다.

### 9.1 blocks 테이블

**EVM (현재):**
```sql
CREATE TABLE blocks (
  chain_id BIGINT NOT NULL,
  block_number BIGINT NOT NULL,
  block_hash VARCHAR(66) NOT NULL,
  parent_hash VARCHAR(66) NOT NULL,
  block_timestamp BIGINT NOT NULL,
  status TINYINT DEFAULT 1,  -- 1=active, 2=reorged
  PRIMARY KEY (chain_id, block_number)
);
```

**Solana (제안):**
```sql
CREATE TABLE solana_blocks (
  chain_id BIGINT NOT NULL,
  slot_number BIGINT NOT NULL,
  block_height BIGINT NOT NULL,
  blockhash VARCHAR(44) NOT NULL,
  previous_blockhash VARCHAR(44) NOT NULL,
  parent_slot BIGINT NOT NULL,
  block_time BIGINT NOT NULL,
  status TINYINT DEFAULT 1,  -- 1=active (reorg 사실상 없음)
  PRIMARY KEY (chain_id, slot_number),
  INDEX idx_block_height (chain_id, block_height),
  INDEX idx_blockhash (chain_id, blockhash)
);
```

### 9.2 transfers 테이블

**EVM (현재):**
```sql
CREATE TABLE transfers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  block_number BIGINT NOT NULL,
  tx_hash VARCHAR(66) NOT NULL,
  transfer_type TINYINT NOT NULL,  -- 1=native, 2=erc20, 3=nft
  log_index INT DEFAULT -1,
  trace_address VARCHAR(255),
  contract_address VARCHAR(42),
  from_address VARCHAR(42) NOT NULL,
  to_address VARCHAR(42) NOT NULL,
  amount VARCHAR(100) NOT NULL,
  status TINYINT DEFAULT 1,
  UNIQUE KEY uk_transfer (chain_id, block_hash, tx_hash, transfer_type, log_index, trace_address, nft_token_id)
);
```

**Solana (제안):**
```sql
CREATE TABLE solana_transfers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  slot_number BIGINT NOT NULL,
  tx_signature VARCHAR(88) NOT NULL,       -- base58 Ed25519 서명
  instruction_index INT NOT NULL,
  inner_instruction_index INT DEFAULT -1,
  transfer_type TINYINT NOT NULL,          -- 1=native(SOL), 2=spl_token, 3=nft
  mint_address VARCHAR(44),                -- SPL token mint (native이면 NULL)
  from_address VARCHAR(44) NOT NULL,
  to_address VARCHAR(44) NOT NULL,
  amount VARCHAR(100) NOT NULL,
  status TINYINT DEFAULT 1,
  UNIQUE KEY uk_transfer (chain_id, slot_number, tx_signature, instruction_index, inner_instruction_index, transfer_type),
  INDEX idx_to (chain_id, to_address, slot_number),
  INDEX idx_from (chain_id, from_address, slot_number)
);
```

### 9.3 wallets 테이블

**Solana (제안):**
```sql
CREATE TABLE solana_wallets (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  key_id VARCHAR(64) NOT NULL,             -- KMS key ID
  address VARCHAR(44) NOT NULL,            -- base58
  type TINYINT NOT NULL,                   -- 0=cold, 1=withdrawal, 2=deposit, 4=gas_feeder
  status TINYINT DEFAULT 1,
  -- current_nonce 없음 (Solana에는 순차 nonce 없음)
  UNIQUE KEY idx_chain_address (chain_id, address)
);
```

### 9.4 withdrawal_transactions 테이블

**Solana (제안):**
```sql
CREATE TABLE solana_withdrawal_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  chain_id BIGINT NOT NULL,
  fee_payer_address VARCHAR(44) NOT NULL,   -- 핫월렛 (fee payer)
  from_address VARCHAR(44) NOT NULL,
  to_address VARCHAR(44) NOT NULL,
  mint_address VARCHAR(44),                 -- SPL token이면 설정
  amount VARCHAR(100) NOT NULL,
  -- Solana 고유 필드
  durable_nonce_account VARCHAR(44),        -- 사용 중인 nonce 계정
  nonce_value VARCHAR(44),                  -- storedNonce 값
  compute_unit_limit INT,
  compute_unit_price BIGINT,                -- micro-lamports
  tx_signature VARCHAR(88),                 -- 서명 후 설정
  signed_tx TEXT,                           -- serialized signed TX
  -- 상태 관리
  status TINYINT DEFAULT 1,                 -- 1=PENDING, 2=SIGNED, 3=BROADCASTED, 4=RETRIED, 5=COMPLETED, 6=DROPPED
  retry_at TIMESTAMP,
  signed_at TIMESTAMP,
  broadcasted_at TIMESTAMP,
  INDEX idx_request_id (request_id),
  INDEX idx_fee_payer (fee_payer_address),
  INDEX idx_tx_signature (tx_signature),
  INDEX idx_status_retry (status, retry_at)
);
```

### 9.5 durable_nonce_accounts 테이블 (신규)

```sql
CREATE TABLE solana_durable_nonce_accounts (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  chain_id BIGINT NOT NULL,
  wallet_id BIGINT NOT NULL,               -- 소유 핫월렛
  nonce_account_address VARCHAR(44) NOT NULL,
  authority_address VARCHAR(44) NOT NULL,   -- nonce authority (= 핫월렛)
  stored_nonce VARCHAR(44),                 -- 현재 저장된 nonce 값
  status TINYINT DEFAULT 1,                 -- 1=FREE, 2=IN_USE, 3=DISABLED
  in_use_by_tx_id BIGINT,                  -- 사용 중인 TX ID
  UNIQUE KEY uk_nonce (chain_id, nonce_account_address),
  INDEX idx_wallet_status (wallet_id, status),
  FOREIGN KEY (wallet_id) REFERENCES solana_wallets(id)
);
```

---

## 10. RPC API 레퍼런스

### 10.1 블록 싱크용 HTTP RPC

| 메서드 | 용도 | 주요 파라미터 |
|--------|------|-------------|
| `getSlot` | 현재 슬롯 번호 | commitment |
| `getBlockHeight` | 현재 블록 높이 | commitment |
| `getBlocks` | 두 슬롯 사이의 확인된 블록 목록 | startSlot, endSlot, commitment |
| `getBlock` | 슬롯 번호로 블록 전체 조회 | slot, encoding, transactionDetails, commitment |
| `getBlockTime` | 블록 생성 시간 | slot |
| `getTransaction` | 서명으로 TX 조회 | signature, encoding, commitment |
| `getSignaturesForAddress` | 주소의 TX 서명 목록 | address, limit, before, until |

### 10.2 잔액/계정 조회

| 메서드 | 용도 |
|--------|------|
| `getBalance` | SOL 잔액 |
| `getAccountInfo` | 계정 전체 정보 |
| `getTokenAccountsByOwner` | 소유자의 모든 SPL 토큰 계정 |
| `getTokenAccountBalance` | 특정 토큰 계정 잔액 |
| `getMinimumBalanceForRentExemption` | rent-exempt 최소 잔액 계산 |

### 10.3 TX 전송/확인

| 메서드 | 용도 |
|--------|------|
| `sendTransaction` | TX 브로드캐스트 |
| `simulateTransaction` | TX 시뮬레이션 (온체인 제출 없이) |
| `getSignatureStatuses` | TX 서명의 확인 상태 |
| `getLatestBlockhash` | 최신 blockhash + lastValidBlockHeight |
| `getFeeForMessage` | 메시지의 예상 수수료 |
| `getRecentPrioritizationFees` | 최근 priority fee 통계 |

### 10.4 WebSocket 구독

| 구독 | 용도 | 비고 |
|------|------|------|
| `slotSubscribe` | 새 슬롯 알림 | 가벼움, 블록 높이 추적 |
| `blockSubscribe` | 새 블록 전체 알림 | 모든 RPC에서 지원하지 않을 수 있음 |
| `signatureSubscribe` | 특정 TX 확인 알림 | 확인 후 자동 구독 해제 |
| `accountSubscribe` | 계정 변경 알림 | 잔액 모니터링 |
| `logsSubscribe` | TX 로그 알림 | 주소 필터 가능 |
| `rootSubscribe` | 새 finalized 슬롯 알림 | finality 추적 |

### 10.5 RPC 프로바이더 비교

| 항목 | Alchemy | Helius | QuickNode |
|------|---------|--------|-----------|
| Solana RPC | 50+ 메서드 | Solana 특화, DAS API | 범용 |
| Rate limit | 최대 300 RPS (shared) | 더 높은 한도 | 플랜별 |
| gRPC (Geyser) | 미지원 | 지원 | 지원 |
| Enhanced API | getPriorityFeeEstimate | Webhook, 향상된 TX API | - |
| 가격 | 무료 30M CU/월 | 무료 50K credits/일 | 유료 |

**대량 블록 싱크에는 gRPC/Geyser 플러그인(Yellowstone)이 HTTP RPC보다 효율적.**

---

## 11. 리스크 평가

### 높은 리스크

| # | 리스크 | 영향 | 대응 |
|---|--------|------|------|
| 1 | **TX 랜딩 안정성** | mempool 없음 → TX 드롭 → 출금 멈춤 | durable nonce + 2초 간격 재전송 + signatureSubscribe 모니터링 |
| 2 | **Durable Nonce 풀 고갈** | 동시 출금 병목 | 사전 할당 (핫월렛당 100개), 동적 확장, pool utilization 알림 |
| 3 | **블록 데이터 볼륨** | EVM 대비 100배+ TX → Publisher/Consumer 과부하 | mainnet 볼륨 부하 테스트, gRPC 검토, 필터링 전략 |

### 중간 리스크

| # | 리스크 | 영향 | 대응 |
|---|--------|------|------|
| 4 | **ATA 라이프사이클** | 토큰별 계정 생성 비용 (~0.002 SOL) | Lazy 생성, 핫월렛이 비용 부담, close 시 반환 |
| 5 | **실패 TX 비용 회계** | 실패해도 5,000 lamports 소비 | 회계 로직에 실패 TX fee 추적 추가 |
| 6 | **주소 포맷 전환** | VARCHAR(42) → VARCHAR(44), hex → base58 | Solana 전용 테이블 분리로 해결 |

### 낮은 리스크

| # | 리스크 | 영향 | 대응 |
|---|--------|------|------|
| 7 | **KMS 통합** | 새 키 타입 추가 | AWS KMS Ed25519 GA, 라이브러리 존재 |
| 8 | **Reorg** | finalized에서 관측된 적 없음 | 방어적 RingBuffer 유지하되 실질적 리스크 없음 |

---

## 12. Architecture Decision Records

### ADR-1: 입금 Commitment Level

**결정:** `finalized` commitment만 사용하여 입금 확정

**근거:**
- Reorg 리스크 완전 제거
- ~13초 지연은 EVM의 15 confirmation (3-5분)보다 오히려 빠름
- Event Confirmer 단계 제거로 파이프라인 단순화

**Trade-off:** `confirmed` 대비 약 12초 추가 지연. 수용 가능.

### ADR-2: 출금 Durable Nonce

**결정:** 출금 파이프라인에 durable nonce 사용

**근거:**
- Recent blockhash 60-90초 만료는 KMS 서명 + 정책 승인 파이프라인에 부적합
- Durable nonce는 만료 없음, 결정적 취소 가능
- 서명 후 임의 시간 대기 가능

**Trade-off:** Nonce 계정 풀 관리 운영 복잡성 추가. 각 계정 ~0.0015 SOL 비용.

### ADR-3: DB 테이블 분리

**결정:** Solana 전용 테이블 생성 (EVM 테이블과 분리)

**근거:**
- 데이터 모델 차이 과대 (nonce vs blockhash, log_index vs instruction_index, gas vs compute units)
- 공유 테이블은 50%+ NULL 컬럼 발생
- 쿼리 명확성 및 유지보수성 향상

**Trade-off:** 테이블 수 증가. 크로스 체인 조회 시 JOIN/UNION 필요.

### ADR-4: Event Confirmer 생략

**결정:** Solana에서 Event Confirmer 단계 생략

**근거:**
- `finalized` commitment에서 이미 최종성 보장
- 추가 확인 단계는 지연만 추가하고 안전성 이득 없음

**Trade-off:** EVM과 Solana의 파이프라인 구조가 다름. 체인별 분리 이미 전제이므로 문제 없음.

---

## 13. 구현 페이즈

| Phase | 기간 | 내용 | 산출물 |
|-------|------|------|--------|
| **Phase 1: Foundation** | 1-3주 | KMS Ed25519 확장, base58 유틸, Solana DB 스키마, Solana RPC 클라이언트 래퍼 | KMS 서명 PoC, devnet 연결 확인 |
| **Phase 2: Deposit** | 4-6주 | Block Publisher solana 플러그인, Block Consumer (SOL + SPL transfer 추출), finalized 직접 확정 | devnet 입금 E2E 테스트 |
| **Phase 3: Withdrawal** | 7-10주 | Durable nonce 풀 관리, tx-preparer/signer/sender/monitor, ATA 자동 생성 | devnet 출금 E2E 테스트 |
| **Phase 4: Hardening** | 11-12주 | mainnet 볼륨 부하 테스트, 모니터링/알림 구축, 운영 런북 작성 | 프로덕션 준비 완료 |

---

## 14. 결론

Solana 통합은 기존 Dagaon Core의 플러그인 아키텍처 위에서 **가능하다.**

### 재사용 가능한 것:
- Kafka/S3 메시지 파이프라인 (체인 무관)
- etcd 기반 HA (체인 무관)
- AWS KMS 통합 레이어 (키 타입만 추가)
- Append-only TX 로그 패턴 (필드만 변경)
- Plugin registry 구조 ("solana" 등록)

### 새로 구현해야 하는 것:
1. **블록 스캐닝:** slot 기반 + 빈 슬롯 처리 + balance diff 방식 transfer 추출
2. **출금 파이프라인:** durable nonce 풀 + mempool 없는 환경의 적극적 재전송
3. **계정 모델:** ATA 생성/관리 + rent-exempt 비용 관리

### 오히려 좋아지는 것:
- **Fee delegation:** EVM의 meta-tx/Paymaster보다 훨씬 간단 (네이티브 fee payer)
- **Finality 속도:** ~13초 (EVM의 3-5분 대비)
- **Reorg 리스크:** finalized에서 사실상 0

---

## 15. 참고자료

### Solana 공식 문서
- [Solana Docs - Transactions](https://solana.com/docs/core/transactions)
- [Solana Docs - Fees](https://solana.com/docs/core/fees)
- [Solana Docs - Durable Nonces](https://solana.com/docs/core/transactions/durable-nonces)
- [Solana RPC HTTP Methods](https://solana.com/docs/rpc/http)
- [Solana RPC WebSocket Methods](https://solana.com/docs/rpc/websocket)
- [EVM to SVM Complete Guide](https://solana.com/developers/evm-to-svm/complete-guide)
- [Transaction Confirmation & Expiration](https://solana.com/developers/guides/advanced/confirmation)
- [Transaction Retry Guide](https://solana.com/developers/guides/advanced/retry)
- [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange)

### 기술 블로그
- [Understanding Slots, Blocks, and Epochs - Helius](https://www.helius.dev/blog/solana-slots-blocks-and-epochs)
- [Solana Commitment Levels - Helius](https://www.helius.dev/blog/solana-commitment-levels)
- [How to Land Transactions on Solana - Helius](https://www.helius.dev/blog/how-to-land-transactions-on-solana)
- [How to manage a million dollars on Solana with Cloud KMS](https://www.turfemon.com/solana-kms-signing)
- [Fee Payers and Gasless Transactions - Circle](https://www.circle.com/blog/how-circles-gas-station-uses-fee-payers-to-enable-gasless-transactions-on-solana)

### AWS KMS
- [AWS KMS Ed25519 Support (2025.11)](https://aws.amazon.com/about-aws/whats-new/2025/11/aws-kms-edwards-curve-digital-signature-algorithm/)
- [AWS KMS Key Spec Reference](https://docs.aws.amazon.com/kms/latest/developerguide/symm-asymm-choose-key-spec.html)

### 라이브러리
- [solana-kms-signer (GitHub)](https://github.com/gtg7784/solana-kms-signer) - AWS KMS 기반 Solana 서명
