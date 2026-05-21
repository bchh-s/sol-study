# 결론: 가능하다. 스캐닝 방식만 변경 필요.

상위 섹션: [3. Q1: Block Sync 아키텍처 호환성](../README.md)

## Executive Summary

Dagaon Core의 입금 파이프라인은 5단계로 구성된다:
**Blockchain Node -> Block Publisher -> Kafka/S3 -> Block Consumer -> Event Confirmer**

Solana 통합 시 이 중 **Block Publisher의 스캐닝 로직**과 **Block Consumer의 Transfer 추출 로직**만 새로 구현하면 된다.
Kafka/S3 메시지 파이프라인, etcd 기반 HA, Plugin Registry는 그대로 재사용할 수 있다.
Event Confirmer는 `finalized` commitment 사용 시 **제거 가능**하여, 파이프라인이 오히려 단순해진다.

## 변경 판정 매트릭스

| 컴포넌트 | 판정 | 변경 설명 | 난이도 | 리스크 |
|----------|------|----------|--------|--------|
| **Block Publisher - 스캐닝** | **새로 구현** | `getBlockByNumber(n++)` -> `getBlocks(start,end)` + `getBlock(slot)` | 중 | 낮음 |
| **Block Publisher - Reorg** | **단순화** | parentHash RingBuffer -> previousBlockhash 방어적 검증 (트리거 안 됨) | 하 | 낮음 |
| **Block Publisher - Checkpoint** | **필드 변경** | etcd key: `block_number` -> `slot_number` | 하 | 낮음 |
| **Kafka 발행** | **재사용** | 메시지 포맷만 변경 (JSON schema) | 하 | 낮음 |
| **S3 백업** | **재사용** | object key naming만 변경 | 하 | 낮음 |
| **Block Consumer - Transfer 추출** | **새로 구현** | Event log 파싱 -> `preBalances`/`postBalances` diff | 중 | **중** |
| **Block Consumer - 실패 TX** | **새로 구현** | receipt.status 확인 -> `meta.err` 확인 (실패TX가 블록에 포함!) | 중 | **높음** |
| **Event Confirmer** | **제거** | `finalized` commitment = 이미 확정 | - | 낮음 |
| **etcd HA** | **재사용** | 변경 없음 | - | - |
| **Plugin Registry** | **재사용** | `"solana"` 타입 등록만 추가 | 하 | 낮음 |

### 판정 기준

- **재사용**: 코드 변경 없이 그대로 사용 가능
- **필드 변경**: 기존 로직은 유지, 데이터 필드명/포맷만 변경
- **단순화**: 기존보다 더 간단해짐
- **새로 구현**: Solana 전용 로직을 작성해야 함
- **제거**: 더 이상 필요 없음

## 재사용 가능 vs 새로 구현 비율

```
재사용/단순화/제거 (인프라 레이어):
  ████████████████████████████████  80%
  - Kafka 발행/소비 메커니즘
  - S3 블록 백업
  - etcd distributed lock
  - etcd checkpoint (필드만 변경)
  - Plugin registry
  - Reorg 방어 (단순화)
  - Event Confirmer (제거)

새로 구현 (체인 레이어):
  ████████  20%
  - 슬롯 기반 스캐닝 (Block Publisher)
  - Balance diff Transfer 추출 (Block Consumer)
  - 실패 TX 필터링 (meta.err)
```

## 핵심 위험 요소

### 1. 실패 TX가 블록에 포함되는 문제 (리스크: 높음)

EVM에서는 실패한 TX의 receipt가 `status: 0`이지만, 해당 TX에서 토큰 전송은 발생하지 않는다.
Solana에서는 **실패한 TX도 블록에 포함**되며, `preBalances`/`postBalances`에 변화가 나타날 수 있다 (base fee 차감).

```
핵심 방어: meta.err !== null 인 TX는 transfer 추출에서 반드시 제외
```

이것을 놓치면 **존재하지 않는 입금을 인식하는 치명적 버그**가 발생한다.

### 2. 블록 데이터 볼륨 (리스크: 중)

Solana mainnet은 초당 수천 건의 TX를 처리한다. EVM 대비 100배 이상의 데이터 볼륨이 발생할 수 있다.

| 체인 | 블록 간격 | 블록당 TX | 초당 TX | 1시간 데이터 |
|------|----------|----------|--------|-------------|
| Ethereum | 12s | ~200 | ~17 | ~60,000 TX |
| Solana | 0.4s | ~2,000 | ~5,000 | ~18,000,000 TX |

**대응:** 초기에는 HTTP RPC로 시작하되, mainnet 부하 테스트 후 gRPC(Yellowstone) 전환을 검토한다.

### 3. 빈 슬롯 처리 (리스크: 낮음)

mainnet에서 약 5%의 슬롯이 비어있다. `getBlocks()`가 빈 슬롯을 자동으로 제외하므로,
`getBlockByNumber(n++)`처럼 매 번호를 순회하는 대신 `getBlocks()`로 한번에 유효한 슬롯 목록을 가져온다.

## 구현 우선순위

```
Phase 1 (필수, 1-2주):
  ├── Block Publisher: slot 기반 스캐닝 로직
  ├── Block Consumer: SOL balance diff 추출
  ├── Block Consumer: meta.err 체크
  └── etcd checkpoint: slot_number 기반

Phase 2 (필수, 1주):
  ├── Block Consumer: SPL token balance diff 추출
  ├── Kafka 메시지 포맷 정의
  └── S3 object key naming

Phase 3 (선택):
  ├── gRPC/Yellowstone 대량 싱크 검토
  └── previousBlockhash 방어적 RingBuffer
```

## Acceptance Criteria

- [ ] devnet에서 100개 finalized slot을 스캔하여 SOL transfer를 올바르게 추출할 수 있다.
- [ ] 실패 TX (meta.err != null)가 transfer 추출에서 제외되는 것을 확인했다.
- [ ] 빈 슬롯이 정상적으로 건너뛰어지는 것을 확인했다.
