# 3.1 Slot/Block 모델 이해

상위 섹션: [3. Q1: Block Sync 아키텍처 호환성](../README.md)

## 핵심 개념: Solana의 시간 단위

EVM에서는 "블록"이 유일한 시간 단위이다. Solana에서는 **Slot**, **Block**, **Epoch** 세 계층의 시간 단위가 있다.

```
┌─────────────────────────────────────────────────────────────────────┐
│ Epoch (약 2-3일, 432,000 slots)                                     │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Slot 1000 │ Slot 1001 │ Slot 1002 │ Slot 1003 │ Slot 1004  │   │
│  │  Block!   │  (empty)  │  Block!   │  Block!   │  (empty)   │   │
│  │  height=  │  leader   │  height=  │  height=  │  skipped   │   │
│  │   950     │  offline  │   951     │   952     │  (fork)    │   │
│  │           │           │           │           │            │   │
│  │ 400ms     │ 400ms     │ 400ms     │ 400ms     │ 400ms      │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  Leader Schedule: 각 슬롯에 1명의 validator가 배정됨                  │
│  Epoch 시작 시 전체 leader schedule이 결정됨                          │
└─────────────────────────────────────────────────────────────────────┘
```

## Slot vs Block vs Block Height

### Slot (슬롯)

- Solana의 **기본 시간 단위**
- 약 **400ms** (실제로는 PoH 틱 기준으로 약간 변동)
- 모든 슬롯에 고유 번호가 있음 (genesis 이후 단조 증가)
- 각 슬롯은 **단일 리더(validator)**에게 배정됨
- 리더가 해당 슬롯에서 TX를 모아 블록을 생성

### Block (블록)

- 리더가 슬롯 동안 TX를 처리하여 생성한 결과물
- **모든 슬롯에 블록이 존재하지는 않음** (빈 슬롯 존재)
- 빈 슬롯 발생 원인:
  - 리더가 오프라인
  - 리더가 시간 내에 블록을 생성하지 못함
  - 생성된 블록이 포크 선택에서 탈락

### Block Height (블록 높이)

- **블록이 실제로 생성된 슬롯만** 카운트
- `slot_number != block_height` (핵심!)
- EVM의 `block_number`와 유사하지만, slot_number로 인덱싱하는 것이 표준

```
예시:
  Slot 1000: Block 생성 → block_height = 950
  Slot 1001: 빈 슬롯     → block_height 증가 없음
  Slot 1002: Block 생성 → block_height = 951
  Slot 1003: Block 생성 → block_height = 952
  Slot 1004: 빈 슬롯     → block_height 증가 없음
  Slot 1005: Block 생성 → block_height = 953

  → slot_number는 5 증가했지만 block_height는 3만 증가
```

### EVM과의 대응

| EVM | Solana | 비고 |
|-----|--------|------|
| `block_number` | `slot_number` | Dagaon Core에서는 slot_number를 primary key로 사용 |
| `block_number` (연속) | `block_height` (연속) | 빈 슬롯을 건너뜀 |
| 해당 없음 | `parent_slot` | 직전 블록의 slot_number |
| `parentHash` | `previousBlockhash` | 체인 연결 증명 |
| 12초 | 400ms | 블록 간격 |

### Dagaon Core에서의 결정

**slot_number를 primary key로 사용한다.**

이유:
1. RPC API가 slot_number 기반 (`getBlock(slot)`, `getBlocks(startSlot, endSlot)`)
2. block_height로는 직접 블록을 조회할 수 없음
3. Solana Explorer, 모든 도구가 slot 기반
4. checkpoint 복구 시 slot_number가 필요

## Epoch 구조

```
┌────────────────────────────────────────────────────────────────────┐
│                        1 Epoch = 432,000 Slots                     │
│                        (약 2-3일, 400ms * 432,000 = ~48시간)        │
│                                                                    │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Epoch N                                                       │  │
│  │                                                               │  │
│  │ Leader Schedule 결정 시점:                                     │  │
│  │   Epoch N 시작 시, staking 가중치 기반으로                     │  │
│  │   432,000개 슬롯의 리더를 미리 배정                            │  │
│  │                                                               │  │
│  │ Staking Rewards 지급:                                         │  │
│  │   Epoch N 종료 시, validator 보상 계산 및 지급                  │  │
│  │                                                               │  │
│  │ 리더 배정:                                                    │  │
│  │   연속 4개 슬롯을 하나의 "leader slot"으로 배정               │  │
│  │   [Validator A][Validator A][Validator A][Validator A]         │  │
│  │   [Validator B][Validator B][Validator B][Validator B]         │  │
│  │   ...                                                         │  │
│  └──────────────────────────────────────────────────────────────┘  │
│                                                                    │
│  Epoch 경계에서 발생하는 일:                                       │
│    1. 새 leader schedule 적용                                      │
│    2. staking rewards 지급                                         │
│    3. stake activation/deactivation 반영                           │
│    4. rent collection (deprecated, 현재는 rent-exempt 강제)        │
└────────────────────────────────────────────────────────────────────┘
```

### Epoch이 Block Sync에 미치는 영향

Dagaon Core 블록 스캐너 입장에서 epoch 경계는 **특별히 처리할 필요 없다.**
- `getBlocks()` 호출 시 epoch 경계를 걸쳐도 정상 동작
- 단, `getBlocks()`의 범위 제한이 있을 수 있음 (RPC provider마다 다름, 보통 500,000 슬롯)

## PoH (Proof of History)와 슬롯 내 순서

EVM에서는 블록 내 TX 순서를 `transactionIndex`로 확인한다.
Solana에서는 **PoH가 슬롯 내 이벤트의 순서를 결정한다.**

```
PoH 해시 체인 (슬롯 내부):
  hash_0 → SHA256(hash_0) → hash_1 → SHA256(hash_1) → hash_2 → ...
       ↑                         ↑
    TX_A가 여기에 삽입         TX_B가 여기에 삽입
    → TX_A가 TX_B보다 먼저    (PoH 틱 번호로 순서 증명)
```

**블록 스캐너에서의 의미:**
- `block.transactions` 배열의 인덱스 = TX의 슬롯 내 순서
- EVM의 `transactionIndex`와 동일한 역할
- Transfer 추출 시 이 인덱스를 `instruction_index`와 함께 고유 식별자로 사용

## 빈 슬롯 타임라인 (실제 예시)

```
시간축 (400ms 간격):
────┬────┬────┬────┬────┬────┬────┬────┬────┬────┬────►
    │    │    │    │    │    │    │    │    │    │
 slot slot slot slot slot slot slot slot slot slot
 100  101  102  103  104  105  106  107  108  109
  ▼         ▼    ▼              ▼    ▼    ▼
Block     Block Block         Block Block Block
h=80      h=81 h=82          h=83  h=84  h=85

getBlocks(100, 109, "finalized") 결과:
→ [100, 102, 103, 105, 106, 107]  (빈 슬롯 101, 104, 108, 109 제외)

※ Mainnet 통계: 약 5%의 슬롯이 빈 슬롯
   → 100개 슬롯 범위를 스캔하면 약 95개의 블록을 처리
```

## Leader Schedule과 빈 슬롯의 관계

```
Leader Schedule (Epoch 시작 시 결정):
┌──────────────────────────────────────────────────┐
│ Slot 100-103: Validator A (4 연속 슬롯)           │
│ Slot 104-107: Validator B (4 연속 슬롯)           │
│ Slot 108-111: Validator C (4 연속 슬롯)           │
│ ...                                               │
└──────────────────────────────────────────────────┘

빈 슬롯 발생 시나리오:
  1. Validator B가 오프라인 → Slot 104-107 전부 빈 슬롯
  2. 네트워크 지연 → Slot 104는 블록 생성, 105-107은 빈 슬롯
  3. 포크 경쟁 → 블록 생성했으나 finalize 안 됨 → finalized 관점에서 빈 슬롯
```

## getBlocks() RPC 동작 상세

```typescript
// Solana RPC: getBlocks
// start_slot부터 end_slot 사이에서 블록이 확인된 슬롯 번호 목록을 반환
// 빈 슬롯은 자동으로 제외됨

const slots = await connection.getBlocks(
  startSlot,    // inclusive
  endSlot,      // inclusive (optional, 생략 시 startSlot + 500,000까지)
  "finalized"   // commitment level
);

// 반환값: number[] (오름차순 정렬된 slot 번호 배열)
// 예: [100, 102, 103, 105, 106, 107]
```

**제약사항:**
- 범위 제한: RPC provider마다 다름 (공식 노드는 500,000 슬롯)
- `endSlot` 생략 시 `startSlot + 500,000` 또는 현재 슬롯 중 작은 값까지
- Helius/QuickNode 등은 더 넓은 범위를 지원할 수 있음

## Dagaon Core 적용 시 고려사항

### 1. Checkpoint 설계

```
EVM:
  etcd key: /dagaon/block-publisher/{chain_id}/last_processed
  value: block_number (예: 19500000)
  
  다음 스캔: getBlockByNumber(19500001)

Solana:
  etcd key: /dagaon/block-publisher/{chain_id}/last_processed_slot
  value: slot_number (예: 289567890)
  
  다음 스캔: getBlocks(289567891, currentSlot, "finalized")
```

### 2. 스캔 배치 크기

```
EVM: 1개씩 (getBlockByNumber는 단일 블록 반환)
Solana: getBlocks()로 한번에 수백~수천개 슬롯 목록을 가져옴

권장 배치:
  - devnet: 100 슬롯씩
  - mainnet: 50 슬롯씩 (TX 볼륨이 크므로)
  - 각 슬롯에 대해 getBlock() 호출 (rate limit 고려)
```

### 3. 모니터링 포인트

| 메트릭 | 설명 | 알림 조건 |
|--------|------|----------|
| `scan_lag_slots` | 현재 finalized slot - 마지막 처리 slot | > 100 |
| `empty_slot_ratio` | 빈 슬롯 비율 | > 20% (비정상) |
| `block_fetch_errors` | getBlock 실패 횟수 | > 5/min |
| `scan_batch_duration_ms` | 배치 처리 시간 | > 5000ms |

## 참고 자료

- [Understanding Slots, Blocks, and Epochs on Solana (Helius)](https://www.helius.dev/blog/solana-slots-blocks-and-epochs)
- [Solana Docs - Terminology](https://solana.com/docs/terminology)
- [Solana RPC - getBlocks](https://solana.com/docs/rpc/http/getblocks)
- [Solana RPC - getBlock](https://solana.com/docs/rpc/http/getblock)
