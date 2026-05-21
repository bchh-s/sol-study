# 3.6 Event Confirmer

상위 섹션: [3. Q1: Block Sync 아키텍처 호환성](../README.md)

## 핵심 결론

**Solana에서 Event Confirmer는 불필요하다.**

`finalized` commitment으로 블록을 조회하면, 해당 블록의 TX는 **조회 시점에 이미 최종 확정**된 상태다.
EVM에서 필수적이었던 "N블록 대기 후 확정" 로직이 Solana에서는 commitment level에 내장되어 있다.

## EVM에서 Event Confirmer가 필요한 이유

### 문제: 아직 확정되지 않은 블록의 TX를 처리하고 있다

```
EVM Block Sync 흐름:

  Block Publisher                      Block Consumer
  ┌──────────────┐                    ┌──────────────┐
  │ getBlock(n)  │ ──── Kafka ────►  │ Transfer 추출 │
  │ (latest)     │                    │ DB 저장       │
  │              │                    │ status=PENDING│
  └──────────────┘                    └──────────────┘
                                             │
                                             ▼
                                      Event Confirmer
                                      ┌──────────────┐
                                      │ current=19500100│
                                      │ confirm=64   │
                                      │              │
                                      │ 확정 기준:   │
                                      │ block <= 100-64│
                                      │ = block <= 36│
                                      │              │
                                      │ block 19500036│
                                      │ 이하 → CONFIRMED│
                                      └──────────────┘

  문제:
  Block Publisher가 "최신" 블록을 가져오는데, 이 블록은 아직 reorg될 수 있다.
  Block Consumer가 transfer를 추출하고 DB에 저장하지만, 이것은 "미확정" 상태.
  
  Event Confirmer가 일정 블록 수만큼 뒤에서 "이 블록은 이제 안전하다"고 판정한다.
  
  EVM 확정 대기 시간:
    Ethereum: 64 blocks * 12s = ~13분
    Kaia: 0 blocks (즉시 확정, BFT)
    BSC: 15 blocks * 3s = ~45초
```

### Event Confirmer 핵심 로직 (EVM)

```go
// Dagaon Core Event Confirmer (EVM)
func (c *EventConfirmer) Run() {
    for {
        currentBlock := c.rpc.GetBlockNumber()
        confirmThreshold := currentBlock - c.confirmationBlocks  // 예: 19500100 - 64
        
        // PENDING 상태의 transfer 중 블록 번호가 threshold 이하인 것을 CONFIRMED로 변경
        c.db.Exec(`
            UPDATE transfers 
            SET status = 'CONFIRMED' 
            WHERE status = 'PENDING' 
              AND block_number <= ?
              AND chain_id = ?
        `, confirmThreshold, c.chainID)
        
        // Reorg로 무효화된 블록의 transfer를 REVERTED로 변경
        c.db.Exec(`
            UPDATE transfers
            SET status = 'REVERTED'
            WHERE block_number > ? 
              AND block_hash NOT IN (SELECT hash FROM blocks WHERE status = 'ACTIVE')
              AND chain_id = ?
        `, confirmThreshold, c.chainID)
        
        time.Sleep(5 * time.Second)
    }
}
```

### 상태 전이 (EVM)

```
                    ┌──── Reorg 감지 ────┐
                    │                     │
                    ▼                     │
  PENDING ──── N 블록 대기 ───► CONFIRMED ────► (입금 처리)
    │                                     
    │                                     
    └──── Reorg 감지 ────► REVERTED (입금 취소)
```

## Solana에서 Event Confirmer가 불필요한 이유

### 핵심: 데이터 수집 시점에 이미 확정됨

```
Solana Block Sync 흐름:

  Block Publisher                      Block Consumer
  ┌──────────────────┐                ┌──────────────┐
  │ getBlocks(       │                │ Transfer 추출 │
  │   start, end,    │ ── Kafka ──►  │ DB 저장       │
  │   "finalized"    │                │ status=       │
  │ )                │                │  CONFIRMED !  │ ← 즉시 확정!
  │                  │                │               │
  │ getBlock(slot,   │                └──────────────┘
  │   "finalized"    │
  │ )                │                 Event Confirmer
  └──────────────────┘                 ┌──────────────┐
                                       │              │
                                       │   불 필 요    │
                                       │              │
                                       │ finalized로  │
                                       │ 조회한 시점에 │
                                       │ 이미 확정됨   │
                                       │              │
                                       └──────────────┘
```

### 상태 전이 비교

```
EVM:
  Transfer 감지 → PENDING → (N블록 대기) → CONFIRMED → 입금 처리
                            ~~~~~~~~~~~~
                            Event Confirmer 담당
                            Ethereum: ~13분
                            BSC: ~45초

Solana:
  Transfer 감지 → CONFIRMED → 입금 처리
                  ~~~~~~~~~~
                  즉시! (getBlock("finalized")로 조회했으므로)
                  finalized 지연 ~13초는 이미 Publisher 단계에서 소화
```

### 왜 이것이 가능한가?

```
EVM Block Publisher:
  getBlockByNumber("latest")  ← "latest"는 최신 블록 (아직 미확정!)
  → N블록 후에야 확정 보장
  → 따라서 N블록 대기하는 Event Confirmer 필요

Solana Block Publisher:
  getBlocks(start, end, "finalized")  ← "finalized"는 이미 확정된 블록!
  getBlock(slot, { commitment: "finalized" })
  → 조회 결과 자체가 이미 31+ 후속 투표를 통과한 블록
  → 추가 대기 필요 없음
  → Event Confirmer 불필요
```

## 파이프라인 단순화 효과

### EVM 파이프라인 (5단계)

```
Node → Block Publisher → Kafka/S3 → Block Consumer → Event Confirmer → 입금 처리
                                                      ~~~~~~~~~~~~~~~
                                                      이 단계가 제거됨
```

### Solana 파이프라인 (4단계)

```
Node → Block Publisher → Kafka/S3 → Block Consumer → 입금 처리
       (finalized)                   (즉시 확정)
```

### 단순화로 얻는 이점

| 항목 | EVM | Solana | 개선 |
|------|-----|--------|------|
| 파이프라인 단계 | 5단계 | 4단계 | -1 |
| 입금 확정 지연 | ~13분 (Ethereum) | ~13초 | 60배 빠름 |
| 상태 전이 복잡도 | PENDING→CONFIRMED→REVERTED | CONFIRMED만 | 대폭 감소 |
| Reorg 되돌림 코드 | 필수 (수백 줄) | 불필요 | 제거 |
| DB 상태 정리 | REVERTED 레코드 관리 | 불필요 | 제거 |
| 모니터링 포인트 | confirmation lag, reorg count | 불필요 | 감소 |

## DB 영향

### EVM transfers 테이블의 status 필드

```sql
-- EVM: 3개 상태 필요
status TINYINT NOT NULL
  -- 1 = PENDING (아직 미확정)
  -- 2 = CONFIRMED (N블록 대기 완료)
  -- 3 = REVERTED (reorg로 무효화)
```

### Solana transfers 테이블의 status 필드

```sql
-- Solana: 사실상 1개 상태만 사용
status TINYINT NOT NULL DEFAULT 1
  -- 1 = CONFIRMED (finalized 시점에 이미 확정)
  -- (PENDING, REVERTED 상태가 필요 없음)

-- 하지만 확장성을 위해 status 필드는 유지 (다른 이유로 상태 변경 가능)
-- 예: 관리자가 수동으로 무효화, 중복 처리 감지 등
```

## ADR 참조: ADR-4 Event Confirmer 생략

> **결정:** Solana에서 Event Confirmer 단계 생략
>
> **근거:**
> - `finalized` commitment에서 이미 최종성 보장
> - 추가 확인 단계는 지연만 추가하고 안전성 이득 없음
>
> **Trade-off:** EVM과 Solana의 파이프라인 구조가 달라짐.
> 체인별 플러그인 분리가 이미 전제이므로 문제 없음.

## 만약 confirmed 레벨을 사용한다면?

`finalized` 대신 `confirmed`를 사용하면 Event Confirmer가 필요할 수 있다.
그러나 이는 **권장하지 않는다.**

```
confirmed (66% 투표):
  - 지연: ~600ms
  - Reorg 가능성: 이론적으로 존재 (실제 관측 0건)
  - 만약 사용한다면:
    Event Confirmer가 confirmed → finalized 전환을 확인해야 함
    → EVM과 유사한 복잡도 발생
    → 600ms 빠른 감지를 위해 전체 파이프라인 복잡도를 높이는 것은 비합리적

finalized (31+ 후속 블록):
  - 지연: ~13s
  - Reorg 가능성: 0
  - Event Confirmer 불필요
  - 13초는 EVM의 13분보다 이미 60배 빠름

→ 결론: finalized를 사용하고 Event Confirmer를 제거하는 것이 최적
```

## 구현 시 주의사항

### Block Consumer 변경

```go
// EVM Block Consumer
func (c *EVMConsumer) processTransfer(transfer *Transfer) {
    transfer.Status = STATUS_PENDING  // 미확정 상태로 저장
    c.db.Save(transfer)
}

// Solana Block Consumer
func (c *SolanaConsumer) processTransfer(transfer *SolanaTransfer) {
    transfer.Status = STATUS_CONFIRMED  // 즉시 확정 상태로 저장!
    c.db.Save(transfer)
    
    // 필요하면 즉시 후속 처리 트리거 (입금 알림 등)
    c.notifyDeposit(transfer)
}
```

### Event Confirmer 비활성화

```go
// Plugin Registry에서 Solana 체인은 Event Confirmer를 등록하지 않음
func (r *Registry) RegisterSolana(chainID int64) {
    r.Register(chainID, &SolanaPlugin{
        Publisher: NewSolanaPublisher(chainID),
        Consumer:  NewSolanaConsumer(chainID),
        // Confirmer: nil  ← 등록하지 않음
    })
}
```

## 참고 자료

- [ADR-1: 입금 Commitment Level](../../solana-integration-research.md#adr-1-입금-commitment-level)
- [ADR-4: Event Confirmer 생략](../../solana-integration-research.md#adr-4-event-confirmer-생략)
- [Solana Commitment Levels (Helius)](https://www.helius.dev/blog/solana-commitment-levels)
