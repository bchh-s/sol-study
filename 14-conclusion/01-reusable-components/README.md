# 재사용 가능한 것

상위 섹션: [14. 결론](../README.md)

---

## 개요

Dagaon Core의 기존 인프라 중 상당 부분은 체인에 무관하게 설계되어 있어 Solana 통합 시 그대로 재사용할 수 있다. 아래는 각 재사용 가능한 컴포넌트에 대해 무엇이 그대로 쓰이고, 무엇을 수정해야 하는지 구체적으로 분석한다.

---

## 1. Kafka / S3 메시지 파이프라인

**재사용률: 100%**

### 그대로 쓰이는 것

- Kafka 클러스터 인프라 (브로커, 파티션, 복제)
- S3 블록 데이터 저장소
- 메시지 발행/소비 프레임워크
- Dead Letter Queue(DLQ) 처리
- Consumer Group 관리
- 재시도 로직 (메시지 처리 실패 시)
- 메시지 순서 보장 (파티션 키 기반)

### 수정이 필요한 것

- **메시지 포맷만 변경:** Kafka 메시지 body에 들어가는 JSON 스키마가 Solana 블록 구조로 바뀜
- **토픽 추가:** `solana-blocks`, `solana-transfers` 등 Solana 전용 토픽 생성
- **파티션 키:** EVM의 `blockNumber` 대신 Solana의 `slot` 사용
- **메시지 크기 검토:** Solana 블록이 EVM보다 크므로 `max.message.bytes` 확인 (S3 참조 방식이면 문제없음)

```
EVM 메시지:
  { "blockNumber": 12345, "blockHash": "0x...", "transactions": [...] }

Solana 메시지:
  { "slot": 12345, "blockhash": "...", "transactions": [...] }

인프라 변경: 없음. 토픽만 추가.
```

---

## 2. etcd 기반 HA / ReplicationManager

**재사용률: 100%**

### 그대로 쓰이는 것

- etcd 클러스터 인프라
- Leader election 로직 (Block Publisher 단일 인스턴스 보장)
- ReplicationManager (active-standby 전환)
- 상태 저장 (마지막 처리 블록/슬롯 번호)
- 분산 잠금 (동시 처리 방지)
- Health check / heartbeat

### 수정이 필요한 것

- **키 네임스페이스 분리:** EVM과 Solana의 상태를 다른 etcd 키로 저장
  ```
  /dagaon/ethereum/block-publisher/last-block → 12345
  /dagaon/solana/block-publisher/last-slot → 67890
  ```
- 그 외 변경 없음. Leader election, HA 전환 로직은 완전히 동일.

---

## 3. AWS KMS 통합 레이어

**재사용률: 80%**

### 그대로 쓰이는 것

- AWS SDK 클라이언트 설정 (region, credentials, retry)
- KMS 호출 래퍼 (에러 처리, 재시도, 로깅)
- 키 메타데이터 관리 (키 ID, 상태, 태깅)
- 키 로테이션 정책
- IAM 권한 관리 패턴

### 수정이 필요한 것

- **키 타입 추가:**
  ```
  기존: ECC_SECG_P256K1 (secp256k1 for EVM)
  추가: ECC_EDWARDS_ED25519 (Ed25519 for Solana)
  ```
- **서명 알고리즘 변경:**
  ```
  기존: ECDSA_SHA_256 + MessageType: DIGEST (해시 서명)
  추가: EDDSA_SHA_512_ED25519 + MessageType: RAW (원본 서명)
  ```
- **공개키 → 주소 변환 로직 추가:**
  ```
  기존: DER → 비압축 공개키 → keccak256 → 하위 20 bytes → hex → EVM 주소
  추가: DER → raw 32 bytes → base58 → Solana 주소
  ```
- **서명 후처리:**
  ```
  기존: DER 서명 → r, s 분리 → v 계산 → RLP 인코딩
  추가: raw 64 bytes 서명 → 그대로 TX에 첨부 (후처리 단순)
  ```

### 리팩토링 방향

```
기존 KmsSignerService를 인터페이스로 추상화:

interface ChainKmsSigner {
  createKey(): KeyMetadata
  getAddress(keyId): string
  sign(keyId, message): Signature
  verify(keyId, message, signature): boolean
}

class EvmKmsSigner implements ChainKmsSigner { ... }
class SolanaKmsSigner implements ChainKmsSigner { ... }
```

---

## 4. Append-only TX 로그 패턴

**재사용률: 90%**

### 그대로 쓰이는 것

- Append-only 설계 원칙 (UPDATE/DELETE 없이 INSERT만)
- 상태 전이 추적 (각 상태 변경마다 새 행 추가)
- 감사 추적(audit trail) 패턴
- 상태 머신 로직 (유효한 상태 전이만 허용)
- 최신 상태 조회 쿼리 (MAX(id) 또는 최신 행)

### 수정이 필요한 것

- **필드 변경:**
  ```
  EVM TX 로그:
    tx_hash VARCHAR(66), nonce BIGINT, gas_price BIGINT, gas_used BIGINT

  Solana TX 로그:
    signature VARCHAR(128), nonce_account VARCHAR(44), nonce_value VARCHAR(88),
    compute_units INTEGER, fee_lamports BIGINT
  ```
- **상태 값 추가:**
  ```
  EVM: CREATED → SIGNED → BROADCASTED → MINED → CONFIRMED → FINALIZED
  Solana: CREATED → SIGNED → BROADCASTED → CONFIRMED → FINALIZED
          (MINED 단계 없음, CONFIRMED = finalized에서 확인)
          + STUCK, NONCE_ADVANCED, CANCELLED 상태 추가
  ```

---

## 5. Plugin Registry 구조

**재사용률: 100%**

### 그대로 쓰이는 것

- 플러그인 등록/조회 메커니즘
- 체인별 플러그인 로딩 (설정 기반)
- 플러그인 인터페이스 (BlockPublisher, BlockConsumer, TxSigner 등)
- 플러그인 생명주기 관리 (init, start, stop, health)
- 설정 파일 기반 활성화/비활성화

### 수정이 필요한 것

- **새 플러그인 등록만 추가:**
  ```yaml
  plugins:
    ethereum:
      block-publisher: EthBlockPublisher
      block-consumer: EthBlockConsumer
      event-confirmer: EthEventConfirmer
      tx-signer: EthKmsSigner
    solana:                              # 새로 추가
      block-publisher: SolBlockPublisher
      block-consumer: SolBlockConsumer
      # event-confirmer: 없음 (ADR-4)
      tx-signer: SolKmsSigner
  ```

---

## 재사용 요약 매트릭스

| 컴포넌트 | 재사용률 | 변경 범위 | 변경 난이도 |
|---------|---------|----------|-----------|
| Kafka/S3 파이프라인 | 100% | 토픽 추가, 메시지 포맷만 | 낮음 |
| etcd HA / ReplicationManager | 100% | 키 네임스페이스만 | 매우 낮음 |
| AWS KMS 통합 레이어 | 80% | 키 타입 + 서명 알고리즘 + 주소 변환 | 중간 |
| Append-only TX 로그 | 90% | 필드 변경 + 상태 값 추가 | 낮음 |
| Plugin Registry | 100% | 새 플러그인 등록만 | 매우 낮음 |

**총평:** 인프라 레이어는 거의 100% 재사용 가능하며, 체인별 차이는 플러그인 내부에서만 처리한다. 이는 Dagaon Core의 플러그인 아키텍처가 올바르게 설계되었음을 의미한다.
