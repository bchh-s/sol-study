# 3.3 Reorg 처리

상위 섹션: [3. Q1: Block Sync 아키텍처 호환성](../README.md)

## 핵심 결론

**Solana에서 `finalized` commitment을 사용하면 reorg가 발생하지 않는다.**
EVM에서 필수적인 reorg 감지/되돌림 로직이 Solana에서는 불필요하다.
다만 defense-in-depth로 `previousBlockhash` 검증을 유지하는 것을 권장한다.

## EVM의 Reorg 문제와 해결 (현재 Dagaon Core)

### 왜 Reorg가 발생하는가?

EVM(Ethereum, Kaia 등)에서는 블록이 생성된 후에도 **더 무거운 체인이 나타나면 교체**된다.

```
정상 체인:
  Block A (h=100) ← Block B (h=101) ← Block C (h=102)

Reorg 발생:
  Block A (h=100) ← Block B (h=101) ← Block C (h=102)  [폐기됨]
                  ← Block B' (h=101) ← Block C' (h=102) ← Block D' (h=103)  [채택됨]

결과: Block B, C에 있던 TX들이 사라짐 → 입금 처리 취소 필요!
```

### Dagaon Core의 EVM Reorg 처리

```go
// Block Publisher - parentHash RingBuffer 기반 reorg 감지
type RingBuffer struct {
    hashes [BUFFER_SIZE]string  // 최근 N개 블록의 해시 저장
    head   int
}

func (p *Publisher) processBlock(block *Block) error {
    // parentHash가 RingBuffer의 마지막 해시와 일치하는지 확인
    expectedParent := p.ringBuffer.Last()
    
    if block.ParentHash != expectedParent {
        // Reorg 감지!
        log.Warn("reorg detected at block", block.Number)
        
        // Fork point 찾기: RingBuffer를 거슬러 올라감
        forkPoint := p.findForkPoint(block)
        
        // forkPoint 이후의 블록을 모두 되돌림
        p.revertBlocks(forkPoint + 1, block.Number - 1)
        
        // 새 체인으로 재처리
        return p.rescanFrom(forkPoint + 1)
    }
    
    p.ringBuffer.Push(block.Hash)
    return nil
}
```

**EVM에서 reorg는 실제로 발생하며, 심각한 문제를 야기한다:**
- 확정된 줄 알았던 입금이 사라짐 → 이중 지불 위험
- 따라서 `confirmation_blocks` (보통 15~64블록)만큼 대기 필요
- Event Confirmer가 이 대기를 담당

## Solana의 Commitment Levels

Solana는 reorg 대신 **commitment level**이라는 개념으로 finality를 관리한다.

```
TX 제출
  │
  ▼
┌─────────────────────────────────────────────────────────────────────┐
│ processed (~400ms)                                                   │
│   - 현재 리더가 TX를 처리함                                          │
│   - 아직 다른 validator의 확인 없음                                  │
│   - 포크에서 탈락 가능 (약 5% fork rate)                            │
│   - ※ 입금에 절대 사용 금지                                         │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ confirmed (~600ms)                                                   │
│   - 클러스터의 66% supermajority가 해당 슬롯에 투표                  │
│   - 이론적으로 reorg 가능하나, 실제 관측된 적 없음                   │
│   - Validator들이 스테이킹을 잃어야 reorg 가능                      │
│   - ※ 잔액 표시, 비핵심 UI에 적합                                   │
└──────────────────────────┬──────────────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│ finalized (~13s)                                                     │
│   - 31개 이상의 후속 블록이 쌓임 (최대 lockout 도달)                 │
│   - Validator들의 투표가 "locked out" 됨                             │
│   - 경제적으로 reorg 불가능 (전체 스테이킹의 1/3 이상 슬래싱 필요)  │
│   - ※ 입금 확정에 사용 (Dagaon Core 채택)                           │
└─────────────────────────────────────────────────────────────────────┘
```

### 각 레벨의 상세 비교

| 항목 | processed | confirmed | finalized |
|------|-----------|-----------|-----------|
| 지연 시간 | ~400ms | ~600ms | ~13s |
| Reorg 리스크 | 있음 (약 5%) | 이론적 가능, 실제 0 | 불가능 |
| 투표 요건 | 리더만 처리 | 66% supermajority | 31+ 후속 블록 |
| EVM 대응 | 0 confirmations | 1-2 confirmations | 64 confirmations |
| 용도 | 개발/테스트 | 잔액 표시, UI | **입금 확정** |
| Dagaon Core 사용 | 사용 안 함 | tx-monitor에서 빠른 감지 | Block Publisher |

## Tower BFT와 지수적 Lockout

Solana의 합의 메커니즘인 Tower BFT가 `finalized`의 안전성을 보장하는 방식:

```
Tower BFT 투표 (Exponential Lockout):
┌────────────────────────────────────────────────────────────────────┐
│                                                                    │
│  Validator가 슬롯 N에 투표하면:                                    │
│                                                                    │
│  투표 #1 (slot N):   lockout = 2 slots    → 2개 슬롯 동안 번복 불가 │
│  투표 #2 (slot N+2): lockout = 4 slots    → 4개 슬롯 동안         │
│  투표 #3 (slot N+4): lockout = 8 slots    → 8개 슬롯 동안         │
│  투표 #4 (slot N+8): lockout = 16 slots   → 16개 슬롯 동안        │
│  ...                                                               │
│  투표 #31 (slot ~):  lockout = 2^31 slots → 사실상 영구적!        │
│                                                                    │
│  2^31 = 2,147,483,648 slots = 약 27년                              │
│                                                                    │
│  → 31개 연속 투표 후에는 번복이 물리적으로 불가능                   │
│  → 이것이 "finalized"의 의미                                       │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘

Reorg를 시도하려면:
  - 전체 스테이킹의 1/3 이상을 가진 validator들이 공모
  - 이들의 lockout된 투표를 번복 (= 스테이킹 슬래싱)
  - 경제적 손실: 수십억 달러
  
  → 사실상 불가능 (Bitcoin의 51% 공격보다 어려움)
```

### Lockout 시각화

```
시간 →

Validator A의 투표 히스토리:
  Slot 100: 투표 (lockout=2)  ──┐
  Slot 102: 투표 (lockout=4)  ──┼── 이제 slot 100은 lockout=4
  Slot 106: 투표 (lockout=8)  ──┼── slot 100의 lockout=8, slot 102의 lockout=4
  Slot 114: 투표 (lockout=16) ──┼── slot 100의 lockout=16
  ...
  Slot N+31: 투표 (lockout=2^31) ── slot 100은 영구적으로 확정됨!
                                     ↑
                                     이것이 slot 100이 "finalized"되는 순간
                                     (31개 후속 투표 완료)
```

## EVM vs Solana: Reorg 방어 비교

```
┌─────────────────────────────────────────────────────────────────────┐
│                    EVM Reorg 방어                                     │
│                                                                     │
│  Block Publisher                    Event Confirmer                  │
│  ┌─────────────────┐              ┌─────────────────────────┐      │
│  │ parentHash      │              │ last_block = 19500100   │      │
│  │ RingBuffer      │              │ confirmation_blocks = 64│      │
│  │                 │              │                         │      │
│  │ 블록 수신 시:   │              │ 확정 기준:              │      │
│  │ parent != last? │              │ block.number <=         │      │
│  │ → reorg 감지!   │              │   last - 64?           │      │
│  │ → 되돌림 시작   │              │ → 입금 확정!            │      │
│  └─────────────────┘              └─────────────────────────┘      │
│                                                                     │
│  필요한 이유:                                                       │
│  - 블록이 언제든 교체될 수 있음                                     │
│  - 64블록 대기 ≈ 13분 (Ethereum)                                   │
│  - 그래도 절대적 보장은 아님 (이론적으로 64블록 이상 reorg 가능)    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                  Solana Reorg 방어                                    │
│                                                                     │
│  Block Publisher                    Event Confirmer                  │
│  ┌─────────────────┐              ┌─────────────────────────┐      │
│  │ getBlocks(...)  │              │                         │      │
│  │ commitment:     │              │    불 필 요              │      │
│  │ "finalized"     │              │                         │      │
│  │                 │              │ finalized로 조회한      │      │
│  │ → 이미 확정된   │              │ 시점에 이미 확정됨      │      │
│  │   블록만 수신   │              │                         │      │
│  │                 │              │ → 컴포넌트 자체가       │      │
│  │ previousBlock   │              │   불필요                │      │
│  │ hash 방어적검증 │              │                         │      │
│  └─────────────────┘              └─────────────────────────┘      │
│                                                                     │
│  Reorg 방어가 commitment level에 내장됨:                            │
│  - "finalized" 조회 = 이미 31+ 후속 투표 완료                      │
│  - 별도 확인 대기 불필요                                            │
│  - ~13초 지연은 EVM의 13분보다 훨씬 빠름                           │
└─────────────────────────────────────────────────────────────────────┘
```

## previousBlockhash: Defense-in-Depth

`finalized`에서 reorg가 발생하지 않지만, Dagaon Core는 **방어적으로 체인 연속성을 검증**한다.

### 왜 방어적 검증을 유지하는가?

1. **코드 신뢰도**: RPC 클라이언트 버그, 프록시 캐시 이상 등 비정상 상황 감지
2. **운영 안정성**: "불가능하다"와 "감지할 수 없다"는 다름. 감지할 수 있으면 감지해야 한다.
3. **감사(audit) 대응**: "왜 reorg를 체크하지 않나요?" → "체크합니다. 다만 트리거되지 않을 뿐."
4. **미래 대비**: Solana의 consensus 변경 시에도 안전

### 구현 방식

```go
// Solana Block Publisher - 방어적 previousBlockhash 검증
type SolanaRingBuffer struct {
    blockhashes [32]string  // 최근 32개 블록의 blockhash 저장
    head        int
}

func (p *SolanaPublisher) verifyChainContinuity(block *SolanaBlock) bool {
    if p.ringBuffer.IsEmpty() {
        return true  // 최초 블록은 검증 건너뜀
    }
    
    lastHash := p.ringBuffer.Last()
    if block.PreviousBlockhash != lastHash {
        // 이것이 트리거되면 RPC 이상 또는 심각한 네트워크 문제
        log.Error("CRITICAL: previousBlockhash mismatch",
            "expected", lastHash,
            "actual", block.PreviousBlockhash,
            "slot", block.SlotNumber,
        )
        
        // 알림 발송 (PagerDuty/Slack)
        p.alertOps("previousBlockhash mismatch detected")
        
        // 운영자 판단 대기 (자동 되돌림 하지 않음)
        // finalized에서 이것은 "있을 수 없는 일"이므로 자동 처리보다 수동 확인이 안전
        return false
    }
    
    return true
}
```

### EVM과의 차이: 트리거 시 행동

| 상황 | EVM | Solana |
|------|-----|--------|
| chain mismatch 감지 | 자동 되돌림 + 재스캔 (정상 동작) | 운영 알림 + 수동 확인 (비정상 상황) |
| 빈도 | 간헐적 발생 (정상적) | 이론적으로 발생 안 함 |
| 원인 | 네트워크의 포크 선택 경쟁 | RPC 버그, 캐시 오류 |

## ADR: Reorg 처리 전략

### ADR-REO-1: Solana Reorg 방어 수준

**결정:** `finalized` commitment 사용 + `previousBlockhash` 방어적 검증

**대안 검토:**

| 옵션 | 설명 | 장점 | 단점 |
|------|------|------|------|
| A. finalized만, 검증 없음 | previousBlockhash 무시 | 단순함 | RPC 이상 감지 불가 |
| B. finalized + 방어적 검증 | mismatch 시 알림만 | 이상 감지 가능, 단순 | 약간의 추가 코드 |
| C. confirmed + RingBuffer | EVM과 동일한 reorg 방어 | 빠른 감지(~600ms) | 불필요한 복잡성 |

**채택: 옵션 B**

**근거:**
- finalized에서 reorg는 발생하지 않으므로 되돌림 로직 불필요
- 하지만 "발생할 수 없는 일"이 감지되면 운영자에게 알려야 함
- EVM 대비 코드 복잡도 대폭 감소 (되돌림 로직 제거)

## 참고 자료

- [Solana Commitment Levels (Helius)](https://www.helius.dev/blog/solana-commitment-levels)
- [Tower BFT: Solana's Consensus Algorithm](https://solana.com/news/tower-bft-solana-s-high-performance-implementation-of-pbft)
- [Understanding Solana Finality](https://docs.solanalabs.com/consensus/commitments)
