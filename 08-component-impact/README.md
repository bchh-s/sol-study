# 8. 컴포넌트별 영향도 분석

원문: ../solana-integration-research.md

## 이 폴더의 목표

컴포넌트별 작업 범위와 우선순위를 **실행 가능한 backlog**로 변환한다. 각 컴포넌트의 재사용 수준, 담당자, 리스크, 의존성, 테스트 전략을 매트릭스로 정리하고, 점진적 롤아웃을 위한 feature flag 전략과 의존성 그래프를 포함한다.

---

## 원문 핵심 발췌

### 전체 컴포넌트 매트릭스

| # | 컴포넌트 | 재사용 수준 | Owner | Risk | 의존성 | 테스트 전략 | 복잡도 |
|---|----------|------------|-------|------|--------|------------|--------|
| 1 | **Kafka + S3 전송** | 완전 재사용 | Infra | 낮음 | 없음 | 메시지 포맷 변경에 대한 schema validation 테스트 | S |
| 2 | **ReplicationManager (etcd)** | 완전 재사용 | Infra | 낮음 | 없음 | 기존 HA failover 테스트로 충분. Solana 경로에서 regression 확인 | S |
| 3 | **Plugin Registry** (`blockchain/registry.go`) | 완전 재사용 | Core | 낮음 | 없음 | "solana" 타입 등록 + 초기화 테스트, 기존 "eth" 타입 regression | S |
| 4 | **KMS AWS 통합** (`services/kms/`) | 높은 재사용 | Security | 중간 | AWS KMS Ed25519 GA | Ed25519 키 생성, 서명/검증 round-trip 테스트, base58 주소 도출 | M |
| 5 | **Append-only TX 로그** | 높은 재사용 | Core | 낮음 | DB 스키마 | 필드 변경 후 INSERT/SELECT 정합성 테스트 | S |
| 6 | **지갑 주소 매칭** | 중간 재사용 | Core | 중간 | 주소 validator | base58 주소 형식 매칭 정확도 테스트. 대소문자 구분, 길이 범위(32-44자) | M |
| 7 | **Block Publisher 스캐닝** | 새로 구현 | Data | 높음 | Solana RPC, Kafka | slot 기반 스캐닝 PoC, 빈 슬롯 처리, previousBlockhash RingBuffer 검증 | L |
| 8 | **Transfer 추출** (Block Consumer) | 새로 구현 | Data | 높음 | Block Publisher | balance diff 기반 추출 정확도, 실패 TX 필터링, fee 분리 | XL |
| 9 | **Event Confirmer** | **제거** | Data | 낮음 | Block Consumer | Solana 경로에서 스킵되는지 확인. EVM 경로 regression | S |
| 10 | **Nonce 관리** (Durable Nonce Pool) | 새로 구현 | Core | 높음 | KMS, Solana RPC | 풀 할당/반환 동시성, 고갈 시 동적 생성, advance 취소 | XL |
| 11 | **TX 빌딩 + 서명** | 새로 구현 | Core | 높음 | KMS, Nonce Pool | 다중 instruction 조합, Ed25519 서명, 직렬화 정확성 | L |
| 12 | **TX 전송 + 재시도** | 새로 구현 | Core | 높음 | TX 서명 | 2초 재전송 루프, signatureSubscribe, 드롭 복구 | L |
| 13 | **Fee 추정** | 새로 구현 | Core | 중간 | Solana RPC | getRecentPrioritizationFees 기반 추정 정확도, compute unit 시뮬레이션 | M |
| 14 | **ATA 관리** | 완전 신규 | Core | 중간 | KMS, Solana RPC | ATA 생성 idempotent, 존재 확인 로직, close 시 SOL 반환 | M |
| 15 | **Durable Nonce 풀** | 완전 신규 | Ops | 높음 | KMS, Solana RPC | 풀 크기 관리, utilization 모니터링, 동적 확장/축소 | L |

---

### 재사용 수준별 분류 요약

**완전 재사용 (변경 없음 또는 최소 설정):**
- Kafka + S3 전송 인프라: 메시지 포맷만 다르고 전송 메커니즘은 동일
- ReplicationManager (etcd): 완전히 체인 무관한 distributed lock
- Plugin Registry: "solana" 타입 등록만 추가

**높은 재사용 (기존 코드에 확장 추가):**
- KMS AWS 통합: Ed25519 KeySpec과 EDDSA SigningAlgorithm 추가
- Append-only TX 로그: 필드명 변경 (nonce→nonceValue, gas→computeUnits)

**중간 재사용 (로직 수정 필요):**
- 지갑 주소 매칭: hex→base58 변환, VARCHAR 길이 변경

**새로 구현 (EVM 대응 컴포넌트가 있으나 로직이 완전히 다름):**
- Block Publisher 스캐닝: slot 기반 + 빈 슬롯 처리
- Transfer 추출: event log → balance diff 방식 전환
- Nonce 관리: 순차 정수 → durable nonce 풀
- TX 빌딩/서명: RLP/ECDSA → Solana 바이너리/Ed25519
- TX 전송/재시도: mempool 기반 → 적극적 재전송 기반
- Fee 추정: gas price → compute unit price

**완전 신규 (EVM에 없는 개념):**
- ATA 관리: SPL Token 수신을 위한 계정 생성/관리
- Durable Nonce 풀: 온체인 nonce 계정의 생명주기 관리

**제거:**
- Event Confirmer: finalized commitment에서 불필요

---

## 개발할 내용

### 1. 컴포넌트별 상세 마이그레이션 계획

#### #1 Kafka + S3 전송 (완전 재사용, S)

**현재 상태:** EVM 블록을 JSON으로 직렬화하여 Kafka 토픽과 S3 버킷에 적재
**변경 내용:** 없음. Solana 메시지도 JSON이므로 전송 메커니즘은 동일
**작업 항목:**
- Kafka 토픽 네이밍: `solana.blocks.{chain_id}` (기존: `evm.blocks.{chain_id}`)
- S3 키 패턴: `solana/blocks/{slot_number}.json`
- Avro/Protobuf schema 사용 시 Solana 메시지 스키마 등록

#### #2 ReplicationManager (완전 재사용, S)

**현재 상태:** etcd lease 기반 distributed lock으로 HA 보장
**변경 내용:** 없음
**작업 항목:**
- Solana 컴포넌트(Publisher, Consumer 등)에서 동일 ReplicationManager 사용 확인
- lock key 네이밍: `/dagaon/solana/{component}/{chain_id}` (기존: `/dagaon/evm/...`)

#### #3 Plugin Registry (완전 재사용, S)

**현재 상태:** `blockchain/registry.go`에 "eth" 타입만 등록
**변경 내용:** "solana" 타입 등록
**작업 항목:**
- `Registry.Register("solana", SolanaPlugin{})` 호출 추가
- SolanaPlugin이 구현해야 할 인터페이스 메서드 정의
- 기존 인터페이스에 EVM 전용 메서드가 포함되어 있으면 체인 무관한 추상 인터페이스로 리팩토링

**주의사항:**
```go
// 현재 인터페이스가 이런 형태라면:
type BlockchainPlugin interface {
    GetBlockByNumber(n int64) (*Block, error)
    GetNonce(addr string) (int64, error)       // ← EVM 전용
    SendRawTransaction(hex string) error       // ← EVM 전용
}

// 이렇게 분리해야 함:
type BlockchainPlugin interface {
    Name() string
    ScanBlocks(ctx context.Context, from, to int64) ([]RawBlock, error)
    ExtractTransfers(block RawBlock) ([]Transfer, error)
}
// 체인별 세부 메서드는 구현체 내부에서 처리
```

#### #4 KMS AWS 통합 (높은 재사용, M)

**현재 상태:** secp256k1 키 생성, ECDSA 서명, hex 주소 도출
**변경 내용:** Ed25519 키/서명 추가, base58 주소 도출

**작업 항목:**
1. `CreateKey` 함수에 Ed25519 분기 추가
   - KeySpec: `ECC_NIST_EDWARDS25519`
   - KeyUsage: `SIGN_VERIFY`
2. `Sign` 함수에 Ed25519 분기 추가
   - SigningAlgorithm: `EDDSA_ED25519_SHA_512`
   - MessageType: `RAW` (DIGEST 대신)
3. `DeriveAddress` 함수에 Solana 분기 추가
   - DER 헤더 제거 (12바이트 고정) → 32바이트 raw 공개키
   - base58 인코딩 = 주소
4. 단위 테스트: 키 생성 → 서명 → 검증 round-trip

**리스크:** AWS KMS Ed25519가 2025.11 GA이므로 상대적으로 새로운 기능. SDK 버전 호환성 확인 필요.

#### #5 Append-only TX 로그 (높은 재사용, S)

**현재 상태:** EVM 필드 기반 TX 로그 (nonce, gasPrice, gasLimit, txHash)
**변경 내용:** Solana 전용 필드로 별도 테이블 생성

**DB 스키마:**
```sql
-- 기존 EVM 테이블은 수정 없음
-- 새 Solana 테이블 생성
CREATE TABLE solana_withdrawal_transactions (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id BIGINT NOT NULL,
  chain_id BIGINT NOT NULL,
  fee_payer_address VARCHAR(44),
  from_address VARCHAR(44),
  to_address VARCHAR(44),
  mint_address VARCHAR(44),
  amount VARCHAR(100),
  durable_nonce_account VARCHAR(44),
  nonce_value VARCHAR(44),
  compute_unit_limit INT,
  compute_unit_price BIGINT,
  tx_signature VARCHAR(88),
  signed_tx TEXT,
  status TINYINT DEFAULT 1,
  retry_at TIMESTAMP,
  signed_at TIMESTAMP,
  broadcasted_at TIMESTAMP,
  -- indexes...
);
```

#### #6 지갑 주소 매칭 (중간 재사용, M)

**현재 상태:** hex 주소 기반 매칭 (case-insensitive)
**변경 내용:** base58 주소 매칭 (case-sensitive)

**작업 항목:**
1. `AddressValidator` 인터페이스 도입 (Validate, Normalize)
2. Solana 주소 validator: base58 디코딩 + 32바이트 길이 검증
3. DB 조회 시 주소 비교가 case-sensitive인지 확인 (MySQL collation)
4. 기존 EVM 코드에서 주소를 lowercase로 정규화하는 부분이 Solana에 영향 주지 않는지 확인

**주의사항:** EVM에서는 `strings.ToLower(address)`로 정규화하는 코드가 흔한데, Solana base58 주소에 이를 적용하면 잘못된 주소가 된다. 체인별 정규화 함수를 반드시 분리해야 한다.

#### #7 Block Publisher 스캐닝 (새로 구현, L)

**변경 내용:** slot 기반 스캐닝, 빈 슬롯 처리, finalized commitment 사용

**작업 항목:**
1. `SolanaBlockScanner` 구현
   - `getSlot("finalized")` → 현재 finalized 슬롯 조회
   - `getBlocks(lastProcessed+1, currentSlot, "finalized")` → 존재하는 슬롯 목록
   - `getBlock(slot, opts)` → 블록 데이터 수집
2. RingBuffer 연동 (previousBlockhash 검증)
3. 체크포인트 관리 (마지막 처리 슬롯을 DB에 저장)
4. 에러 핸들링: RPC 타임아웃, 빈 응답, rate limit

**PoC 우선순위:** devnet에서 100개 슬롯 스캐닝 PoC → Kafka 적재 확인

#### #8 Transfer 추출 (새로 구현, XL)

**변경 내용:** event log 파싱 → balance diff 기반 추출

**작업 항목:**
1. SOL native transfer 추출
   - `preBalances[i]` vs `postBalances[i]` 비교
   - `accountKeys[i]`로 주소 매핑
   - fee payer 잔액에서 fee(5,000 lamports) 분리
2. SPL Token transfer 추출
   - `preTokenBalances` vs `postTokenBalances` 비교
   - mint, owner, amount 매핑
   - ATA 주소 → owner 주소 역매핑
3. 실패 TX 필터링 (`meta.err != null`)
4. 감시 지갑 매칭 (to_address가 deposit 주소인지)
5. Transfer 고유 식별자: `(chain_id, slot_number, tx_signature, instruction_index, inner_instruction_index)`

**핵심 주의사항:**
- balance diff에서 fee를 분리하지 않으면 fee payer의 "잔액 감소분"이 전송으로 오인될 수 있다
- 하나의 TX에 여러 instruction이 있으면 여러 transfer가 추출될 수 있다
- inner instruction(CPI)도 balance 변동을 일으킬 수 있다

**복잡도 XL 이유:** EVM의 event log 파싱은 명시적이고 단순하지만, Solana의 balance diff는 모든 잔액 변동의 원인을 분석해야 하므로 엣지 케이스가 많다.

#### #9 Event Confirmer 제거 (S)

**변경 내용:** Solana 경로에서 Event Confirmer 스킵

**작업 항목:**
1. chain config에 `skip_event_confirmer: true` 추가
2. Block Consumer가 Solana 블록 처리 시 transfer를 CONFIRMED 상태로 직접 저장
3. EVM 경로는 기존과 동일하게 PENDING → CONFIRMED 전환 유지

```yaml
# chain_config.yaml
chains:
  ethereum:
    type: evm
    confirmation_blocks: 15
    skip_event_confirmer: false
  solana:
    type: solana
    commitment: finalized
    skip_event_confirmer: true
```

#### #10 Durable Nonce 풀 관리 (새로 구현, XL)

**변경 내용:** EVM의 순차 nonce → Solana의 durable nonce 풀

**작업 항목:**
1. `solana_durable_nonce_accounts` 테이블 생성
2. Nonce 계정 일괄 생성 스크립트 (핫월렛당 100개)
   - `CreateAccount` + `InitializeNonceAccount` TX
3. 풀 관리 로직
   - `Acquire(walletID)`: status=FREE인 계정을 IN_USE로 변경, storedNonce 조회
   - `Release(nonceAccount)`: IN_USE → FREE (TX 확인 후)
   - `Cancel(nonceAccount)`: nonce advance TX 전송 → storedNonce 갱신
4. 동적 확장: pool utilization > 80% 시 추가 계정 생성
5. 모니터링: `nonce_pool_free_count`, `nonce_pool_utilization_rate`

**동시성 제어:**
```sql
-- Acquire: 동시에 같은 nonce 계정을 할당받지 않도록
SELECT * FROM solana_durable_nonce_accounts
WHERE wallet_id = ? AND status = 1  -- FREE
ORDER BY id ASC
LIMIT 1
FOR UPDATE SKIP LOCKED
```

#### #11 TX 빌딩 + 서명 (새로 구현, L)

**변경 내용:** RLP/ECDSA → Solana 바이너리/Ed25519

**작업 항목:**
1. Solana TX 빌더
   - instruction 목록 조합 (AdvanceNonce + Transfer 또는 CreateATA + Transfer)
   - account keys 배열 구성 (순서 중요: fee payer 첫 번째)
   - message header 구성 (서명 필요 계정 수, read-only 계정 수)
2. message serialize
3. KMS Sign (Ed25519, RAW)
4. signed TX 조합: `[서명 배열] + [message bytes]`
5. tx_signature 계산: `base58(signature[0:64])`

#### #12 TX 전송 + 재시도 (새로 구현, L)

**변경 내용:** mempool 기반 전송 → 적극적 재전송

**작업 항목:**
1. `sendTransaction(signed_tx, {maxRetries: 0, skipPreflight: false})` 호출
2. 2초 간격 재전송 goroutine 시작
3. `signatureSubscribe` WebSocket 구독 (확인 알림)
4. 확인 시 재전송 goroutine 종료
5. 타임아웃 (예: 30초) 시 priority fee bump → 새 TX 생성

**재전송 멱등성:** 동일 signed TX를 여러 번 전송해도 `sendTransaction`은 에러 없이 수용한다. 서명이 같으므로 동일 TX로 인식된다.

#### #13 Fee 추정 (새로 구현, M)

**변경 내용:** gas price → compute unit price

**작업 항목:**
1. `getRecentPrioritizationFees` 호출로 최근 priority fee 분포 조회
2. p50-p75 범위를 기본 compute_unit_price로 설정
3. `simulateTransaction`으로 실제 compute unit 소비량 측정 (compute_unit_limit 최적화)
4. Fee 추정 결과를 `solana_withdrawal_transactions`에 저장

#### #14 ATA 관리 (완전 신규, M)

**변경 내용:** EVM에 없는 완전 새로운 개념

**작업 항목:**
1. ATA 주소 도출: `findProgramAddress([wallet, TOKEN_PROGRAM_ID, mint], ATA_PROGRAM_ID)`
2. ATA 존재 확인: `getAccountInfo(ata_address)`
3. ATA 생성: `createAssociatedTokenAccountIdempotent` instruction (이미 존재하면 무시)
4. ATA 생성 비용 관리: fee payer(핫월렛)가 부담, ~0.00204 SOL
5. ATA close: 더 이상 사용하지 않는 ATA를 close하여 rent 반환

**생성 전략:**
- Deposit 지갑: 지원 토큰의 ATA를 lazy 생성 (첫 입금 감지 시)
- 출금 수신자: TX에 createATA instruction을 조건부 포함

#### #15 Durable Nonce 풀 운영 (완전 신규, L)

**변경 내용:** EVM에 없는 운영 개념

**작업 항목:**
1. 초기 프로비저닝 스크립트: 핫월렛당 N개 nonce 계정 생성
2. 모니터링 대시보드: pool size, free count, utilization rate
3. 알림 규칙: utilization > 80% → 자동 확장, utilization > 95% → 긴급 알림
4. 비용 관리: 계정당 ~0.0015 SOL, 100개 = 0.15 SOL
5. 장기 미사용 nonce 계정 정리 (close → SOL 반환)
6. Nonce 계정 상태 동기화: 온체인 storedNonce와 DB 값 일치 검증

---

### 2. 의존성 그래프

```
Phase 1: Foundation (주 1-3)
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐  │
│   │ #3 Plugin    │   │ #4 KMS       │   │ #5 DB Schema │  │
│   │   Registry   │   │   Ed25519    │   │  Migration   │  │
│   │   (S)        │   │   (M)        │   │  (S)         │  │
│   └──────┬───────┘   └──────┬───────┘   └──────┬───────┘  │
│          │                  │                   │           │
└──────────┼──────────────────┼───────────────────┼───────────┘
           │                  │                   │
           ▼                  ▼                   ▼
Phase 2: Deposit (주 4-6)
┌──────────┼──────────────────┼───────────────────┼───────────┐
│          │                  │                   │           │
│   ┌──────▼───────┐   ┌─────▼────────┐   ┌─────▼────────┐  │
│   │ #7 Block     │──>│ #8 Transfer  │──>│ #9 Event     │  │
│   │  Publisher   │   │  Extractor   │   │  Confirmer   │  │
│   │  (L)         │   │  (XL)        │   │  제거 (S)    │  │
│   └──────────────┘   └──────┬───────┘   └──────────────┘  │
│                             │                              │
│                      ┌──────▼───────┐                      │
│                      │ #6 주소 매칭  │                      │
│                      │ (M)          │                      │
│                      └──────────────┘                      │
└────────────────────────────────────────────────────────────┘
                              │
                              ▼
Phase 3: Withdrawal (주 7-10)
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   ┌──────────────┐   ┌──────────────┐                      │
│   │ #10 Nonce    │   │ #14 ATA      │                      │
│   │  Pool (XL)   │   │  관리 (M)    │                      │
│   └──────┬───────┘   └──────┬───────┘                      │
│          │                  │                               │
│          ▼                  ▼                               │
│   ┌──────────────┐   ┌──────────────┐                      │
│   │ #13 Fee      │   │ #11 TX Build │                      │
│   │  추정 (M)    │──>│  + Sign (L)  │                      │
│   └──────────────┘   └──────┬───────┘                      │
│                             │                               │
│                      ┌──────▼───────┐                      │
│                      │ #12 TX Send  │                      │
│                      │  + Retry (L) │                      │
│                      └──────┬───────┘                      │
│                             │                               │
│                      ┌──────▼───────┐                      │
│                      │ #15 Nonce    │                      │
│                      │  Pool Ops(L) │                      │
│                      └──────────────┘                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
Phase 4: Hardening (주 11-12)
┌─────────────────────────────────────────────────────────────┐
│   Mainnet 볼륨 부하 테스트                                    │
│   모니터링/알림 구축                                          │
│   운영 런북 작성                                              │
│   EVM regression 테스트                                      │
└─────────────────────────────────────────────────────────────┘
```

**크리티컬 패스:**
```
KMS Ed25519 (#4) → Nonce Pool (#10) → TX Build (#11) → TX Send (#12)
```
KMS가 가장 먼저 준비되어야 모든 출금 관련 컴포넌트가 진행 가능하다.

**병렬 작업 가능:**
- Phase 1: #3, #4, #5 동시 진행
- Phase 2: #7과 #14 동시 시작 (Block Publisher와 ATA 관리는 독립적)
- Phase 3: #10(Nonce Pool)과 #13(Fee 추정) 동시 시작

---

### 3. Feature Flag 전략

체인별 분기를 feature flag로 관리하여 점진적 롤아웃을 수행한다.

```yaml
# feature_flags.yaml
solana:
  enabled: false                    # 마스터 스위치
  
  deposit:
    enabled: false                  # 입금 파이프라인 활성화
    publisher_enabled: false        # Block Publisher만 활성화 (Consumer 없이 테스트)
    consumer_enabled: false         # Block Consumer 활성화
    supported_tokens:               # 지원 토큰 점진적 추가
      - "SOL"                       # Phase 2 초기: SOL만
      # - "EPjFW..."               # Phase 2 후기: USDC 추가
  
  withdrawal:
    enabled: false                  # 출금 파이프라인 활성화
    max_concurrent: 10              # 초기: 동시 출금 10건 제한
    nonce_pool_size: 100            # nonce 풀 크기
    max_withdrawal_amount: "10"     # 초기: 최대 10 SOL/건
  
  chain_config:
    commitment: "finalized"
    skip_event_confirmer: true
    rpc_endpoints:
      - "https://api.devnet.solana.com"  # devnet에서 시작
```

**롤아웃 단계:**

| 단계 | 활성화 플래그 | 검증 내용 |
|------|------------|----------|
| 1. Devnet 입금 | `deposit.publisher_enabled: true` | Block Publisher가 devnet 슬롯을 정상 스캐닝하는지 |
| 2. Devnet 입금 E2E | `deposit.consumer_enabled: true` | SOL transfer가 감지되어 DB에 저장되는지 |
| 3. Devnet 출금 | `withdrawal.enabled: true` | Devnet에서 출금 E2E 성공 |
| 4. Mainnet 입금 | RPC를 mainnet으로 전환 | Mainnet 볼륨 처리 가능한지 |
| 5. Mainnet 출금 (제한) | `max_concurrent: 10`, `max_withdrawal_amount: "10"` | 소규모 실제 출금 |
| 6. Mainnet 출금 (확장) | 제한 완화 | 정상 운영 확인 후 제한 해제 |

---

## 공부할 내용

### 1. Plugin Registry 패턴의 확장 지점과 EVM 가정 누수

`blockchain/registry.go`를 읽고 다음을 확인해야 한다:

1. **인터페이스 메서드 목록:** EVM 전용 메서드(`GetNonce`, `GetGasPrice`, `SendRawTransaction`)가 인터페이스 레벨에 노출되어 있는가?
2. **DTO 구조:** `Block`, `Transaction`, `Transfer` 등의 DTO에 EVM 전용 필드(`parentHash`, `nonce`, `gasPrice`)가 포함되어 있는가?
3. **타입 스위칭:** `switch chainType { case "eth": ... }` 패턴이 상위 레이어까지 퍼져 있는가?

이상적인 구조는 Plugin이 체인별 세부사항을 캡슐화하고, 상위 레이어는 체인 무관한 도메인 모델만 다루는 것이다:

```
상위 레이어: Transfer{From, To, Amount, TokenRef}
            ↓ 추상화 경계
Plugin 레이어: EVMTransferExtractor / SolanaTransferExtractor
            ↓ 구체적 구현
RPC 레이어: eth_getBlockByNumber / getBlock
```

### 2. HA/Lock/Checkpoint 설계의 체인 무관성 검토

ReplicationManager의 etcd lease, Block Publisher의 checkpoint(마지막 처리 블록/슬롯), tx-ticketer의 `FOR UPDATE SKIP LOCKED` 패턴이 체인 타입에 의존하는지 확인한다.

**예상 결과:**
- ReplicationManager: 완전 체인 무관 (lock key만 다름)
- Checkpoint: 필드명만 다름 (`block_number` → `slot_number`), 로직은 동일
- FOR UPDATE SKIP LOCKED: 완전 체인 무관 (테이블만 다름)

**확인 필요:**
- checkpoint 테이블에 `block_number BIGINT` 컬럼이 하드코딩되어 있다면, `cursor BIGINT`로 일반화하거나 Solana 전용 테이블 추가

---

## 실습/검증 과제

### 과제 1: 컴포넌트별 "첫 번째 테스트" 정의

| 컴포넌트 | 첫 번째 테스트 | 통과 기준 |
|----------|-------------|----------|
| KMS Ed25519 | devnet에서 Ed25519 키 생성 → 서명 → 검증 | round-trip 성공 |
| Block Publisher | devnet에서 10개 슬롯 스캐닝 | 빈 슬롯 건너뛰기 + 블록 JSON 출력 |
| Transfer 추출 | devnet SOL transfer TX에서 balance diff 추출 | from/to/amount 정확히 매핑 |
| Nonce Pool | devnet에서 nonce 계정 3개 생성 + Acquire/Release | 동시성 제어 정상 |
| TX Build + Sign | devnet에서 SOL transfer TX 빌드 → 서명 → 전송 | 온체인 확인 |
| ATA 관리 | devnet에서 SPL Token ATA 생성 → 토큰 전송 | ATA에 토큰 도착 |

### 과제 2: EVM Regression Smoke Test 목록

Solana 경로를 추가한 뒤 기존 EVM 파이프라인이 깨지지 않았는지 확인하는 최소 테스트:

- [ ] EVM Block Publisher가 여전히 정상 스캐닝하는가?
- [ ] EVM Block Consumer가 ERC20 Transfer를 정상 추출하는가?
- [ ] EVM Event Confirmer가 confirmation_blocks 기반으로 정상 확정하는가?
- [ ] EVM tx-ticketer가 nonce를 정상 할당하는가?
- [ ] EVM tx-signer가 secp256k1 서명을 정상 생성하는가?
- [ ] EVM tx-sender가 eth_sendRawTransaction을 정상 호출하는가?
- [ ] EVM tx-monitor가 stuck TX를 정상 감지하고 gas bump하는가?
- [ ] Plugin Registry에서 "eth" 타입 조회가 여전히 정상 동작하는가?

### 과제 3: Acceptance Criteria

- [ ] 15개 컴포넌트 전체에 대해 owner, risk, dependency, test strategy가 매트릭스로 정리됨
- [ ] 의존성 그래프에서 크리티컬 패스를 식별하고 Phase별 일정에 반영됨
- [ ] Feature flag 전략이 6단계 롤아웃으로 구체화됨
- [ ] EVM regression smoke test 목록이 8건 이상 정의됨

---

## 완료 기준

- 15개 컴포넌트 전체에 대해 재사용 수준, 담당자, 리스크, 의존성, 테스트 전략, 복잡도가 매트릭스로 정리되어 있다.
- 각 컴포넌트의 상세 마이그레이션 계획(작업 항목, 코드 예시, 주의사항)이 작성되어 있다.
- 의존성 그래프가 ASCII art로 그려져 있고, 크리티컬 패스와 병렬 작업 가능 항목이 식별되어 있다.
- Feature flag 전략이 devnet → mainnet 점진적 롤아웃 단계로 구체화되어 있다.
- EVM regression smoke test 목록이 정의되어 있다.
- 컴포넌트별 "첫 번째 테스트"가 정의되어 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
