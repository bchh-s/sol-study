# 3.2 블록 스캐닝 방식 비교

상위 섹션: [3. Q1: Block Sync 아키텍처 호환성](../README.md)

## 핵심 차이

EVM은 모든 블록 번호에 블록이 존재하므로 단순히 `n++`로 순회한다.
Solana는 빈 슬롯이 존재하므로, **먼저 유효한 슬롯 목록을 조회**한 뒤 각 슬롯의 블록을 가져와야 한다.

## EVM 블록 스캐닝 (현재 Dagaon Core)

```go
// Dagaon Core Block Publisher (EVM) - 의사코드
func (p *Publisher) ScanLoop() {
    lastProcessed := p.loadCheckpoint()  // etcd에서 마지막 처리 블록 번호
    
    for {
        currentBlock := p.rpc.GetBlockNumber()  // eth_blockNumber
        
        for n := lastProcessed + 1; n <= currentBlock; n++ {
            // 핵심: 모든 n에 블록이 반드시 존재
            block := p.rpc.GetBlockByNumber(n, true)  // fullTx=true
            
            // parentHash로 reorg 검증
            if !p.ringBuffer.Verify(block.ParentHash) {
                p.handleReorg(n)
                break
            }
            
            // Kafka + S3 발행
            p.publish(block)
            p.ringBuffer.Push(block.Hash)
            p.saveCheckpoint(n)  // etcd 저장
            
            lastProcessed = n
        }
        
        time.Sleep(1 * time.Second)  // 다음 블록 대기
    }
}
```

**특징:**
- `n++`로 단순 순차 증가 (모든 번호에 블록 존재)
- 각 블록을 개별 조회 (`getBlockByNumber`)
- `parentHash`로 체인 연속성 검증
- 블록 간격 12초이므로 1초마다 폴링

## Solana 블록 스캐닝 (변경)

```go
// Dagaon Core Block Publisher (Solana) - 의사코드
func (p *SolanaPublisher) ScanLoop() {
    lastProcessedSlot := p.loadCheckpoint()  // etcd에서 마지막 처리 슬롯
    
    for {
        // 1. 현재 finalized 슬롯 확인
        currentSlot := p.rpc.GetSlot("finalized")
        
        if currentSlot <= lastProcessedSlot {
            time.Sleep(400 * time.Millisecond)  // 슬롯 간격만큼 대기
            continue
        }
        
        // 2. 유효한 슬롯 목록 조회 (빈 슬롯 자동 제외!)
        //    핵심: getBlocks()가 실제 블록이 있는 슬롯만 반환
        slots := p.rpc.GetBlocks(
            lastProcessedSlot + 1,
            min(currentSlot, lastProcessedSlot + BATCH_SIZE),
            "finalized",
        )
        
        // 3. 각 슬롯의 블록 데이터 조회
        for _, slot := range slots {
            block := p.rpc.GetBlock(slot, GetBlockOptions{
                Encoding:                       "jsonParsed",
                TransactionDetails:             "full",
                Rewards:                        false,
                MaxSupportedTransactionVersion: 0,
                Commitment:                     "finalized",
            })
            
            if block == nil {
                // 극히 드물지만 getBlocks에는 있으나 getBlock이 null 반환
                // (finalization 직후 타이밍 이슈)
                log.Warn("block nil for slot", slot)
                continue
            }
            
            // 방어적 previousBlockhash 검증
            if !p.ringBuffer.Verify(block.PreviousBlockhash) {
                // 이론적으로 finalized에서는 트리거 안 됨
                log.Error("previousBlockhash mismatch!", slot)
                p.alertOps()
                break
            }
            
            // Kafka + S3 발행
            p.publish(block)
            p.ringBuffer.Push(block.Blockhash)
            p.saveCheckpoint(slot)
            
            lastProcessedSlot = slot
        }
        
        // 배치 완료 후 다음 배치까지 대기
        if len(slots) == 0 {
            time.Sleep(400 * time.Millisecond)
        }
    }
}
```

## Side-by-Side 비교

```
┌─────────────────────────────────┬─────────────────────────────────────────┐
│          EVM (현재)              │            Solana (변경)                  │
├─────────────────────────────────┼─────────────────────────────────────────┤
│                                 │                                         │
│  1. getBlockNumber()            │  1. getSlot("finalized")                │
│     → currentBlock = 19500100  │     → currentSlot = 289567890          │
│                                 │                                         │
│  2. for n = last+1 to current  │  2. getBlocks(last+1, current, "final") │
│     ※ 빈 번호 없음             │     → [289567881, 289567883, ...]       │
│                                 │     ※ 빈 슬롯 자동 제외                 │
│                                 │                                         │
│  3. getBlockByNumber(n, true)   │  3. getBlock(slot, options)             │
│     → 단일 블록 JSON            │     → 단일 블록 JSON                    │
│                                 │                                         │
│  4. parentHash 검증             │  4. previousBlockhash 검증 (방어적)     │
│     → reorg 시 되돌림           │     → finalized에서 트리거 안 됨        │
│                                 │                                         │
│  5. checkpoint = blockNumber    │  5. checkpoint = slotNumber             │
│                                 │                                         │
│  6. sleep(1s) 다음 블록 대기    │  6. sleep(400ms) 또는 즉시 다음 배치    │
│                                 │                                         │
└─────────────────────────────────┴─────────────────────────────────────────┘
```

## getBlocks() API 상세

### 요청 파라미터

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBlocks",
  "params": [
    289567880,       // start_slot (inclusive)
    289567890,       // end_slot (inclusive, optional)
    {
      "commitment": "finalized"
    }
  ]
}
```

### 응답 형태

```json
{
  "jsonrpc": "2.0",
  "result": [289567880, 289567881, 289567883, 289567884, 289567886, 289567887, 289567888, 289567890],
  "id": 1
}
```

- 289567882, 289567885, 289567889가 빈 슬롯이므로 결과에서 제외됨

### 제약 사항

| 항목 | 제한 | 비고 |
|------|------|------|
| 최대 범위 | 500,000 슬롯 | RPC provider마다 다를 수 있음 |
| endSlot 생략 시 | startSlot + 500,000 또는 현재 슬롯 | 둘 중 작은 값 |
| Rate limit | Provider 의존 | Helius 무료: 50 RPS |

## getBlock() API 상세

### 요청 파라미터

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBlock",
  "params": [
    289567890,
    {
      "encoding": "jsonParsed",
      "transactionDetails": "full",
      "rewards": false,
      "maxSupportedTransactionVersion": 0,
      "commitment": "finalized"
    }
  ]
}
```

### 옵션 설명

| 옵션 | 값 | 이유 |
|------|---|------|
| `encoding` | `"jsonParsed"` | instruction이 파싱된 형태로 반환, 디버깅 용이 |
| `transactionDetails` | `"full"` | 모든 TX 데이터 포함 (transfer 추출에 필수) |
| `rewards` | `false` | validator reward 불필요 (Dagaon Core 용도 아님) |
| `maxSupportedTransactionVersion` | `0` | v0 TX (Address Lookup Table) 지원 |
| `commitment` | `"finalized"` | 최종 확정된 블록만 조회 |

### 응답 구조 (핵심 필드)

```json
{
  "blockhash": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp...",
  "previousBlockhash": "4sGjMW1sUnHzSxGspuhSqoGX4i...",
  "parentSlot": 289567889,
  "blockHeight": 267890123,
  "blockTime": 1716230400,
  "transactions": [
    {
      "transaction": {
        "signatures": ["5UfDuX7WXY4J3..."],
        "message": {
          "accountKeys": [...],
          "instructions": [...]
        }
      },
      "meta": {
        "err": null,
        "fee": 5000,
        "preBalances": [1000000000, 0, 1],
        "postBalances": [999995000, 5000, 1],
        "preTokenBalances": [...],
        "postTokenBalances": [...]
      }
    }
  ]
}
```

## Edge Cases 처리

### 1. 빈 슬롯 범위

```
상황: getBlocks(100, 110) 결과가 빈 배열 []
원인: 해당 범위의 모든 슬롯이 빈 슬롯 (네트워크 지연 등)
처리: 다음 배치로 넘어감 (checkpoint 변경 없음)

if len(slots) == 0 {
    // checkpoint를 endSlot으로 갱신하면 안 됨!
    // (endSlot 이후에 finalized 블록이 생성될 수 있음)
    // 단순히 대기 후 재시도
    time.Sleep(2 * time.Second)
    continue
}
```

### 2. getBlock()이 null 반환

```
상황: getBlocks()에는 포함되었으나 getBlock()이 null
원인: finalization 직후 타이밍 이슈 (매우 드묾)
처리: 해당 슬롯을 건너뛰지 말고 재시도

retries := 0
for block == nil && retries < 3 {
    time.Sleep(500 * time.Millisecond)
    block = p.rpc.GetBlock(slot, options)
    retries++
}
if block == nil {
    log.Error("getBlock returned nil after retries", slot)
    break  // 다음 폴링 사이클에서 재시도
}
```

### 3. RPC Rate Limiting

```
상황: 429 Too Many Requests
처리: 지수 백오프 (exponential backoff)

baseDelay := 100 * time.Millisecond
for attempt := 0; attempt < 5; attempt++ {
    block, err := p.rpc.GetBlock(slot, options)
    if err == nil {
        break
    }
    if isRateLimited(err) {
        delay := baseDelay * time.Duration(1 << attempt)  // 100ms, 200ms, 400ms, 800ms, 1.6s
        time.Sleep(delay)
        continue
    }
    return err  // 다른 에러는 즉시 반환
}
```

### 4. RPC 연결 장애

```
상황: TCP timeout, connection refused 등
처리:
  1. 다른 RPC 엔드포인트로 failover
  2. circuit breaker 패턴 적용
  3. 연속 5회 실패 시 알림

rpcEndpoints := []string{
    "https://mainnet.helius-rpc.com",
    "https://solana-mainnet.quiknode.pro",
    "https://api.mainnet-beta.solana.com",  // 공식 (rate limit 낮음)
}
```

### 5. 대량 싱크 (cold start)

```
상황: 최초 배포 또는 장시간 다운 후 재시작 → 수만 슬롯 뒤처짐
처리:
  1. BATCH_SIZE를 100에서 500으로 증가 (catch-up 모드)
  2. getBlock 호출을 병렬화 (동시 10개)
  3. lag < 100 슬롯이면 정상 모드로 전환
  4. 장기적으로 gRPC/Yellowstone 도입 검토

const (
    NORMAL_BATCH_SIZE  = 100
    CATCHUP_BATCH_SIZE = 500
    CATCHUP_THRESHOLD  = 1000  // 1000 슬롯 이상 뒤처지면 catch-up 모드
    PARALLEL_FETCHES   = 10
)
```

## TypeScript PoC (devnet)

실행 가능한 전체 코드는 [code/block-scanner.ts](../code/block-scanner.ts) 참조.

```typescript
import { Connection } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com", "finalized");

async function scanBlocks() {
  // 1. 현재 finalized 슬롯 조회
  const currentSlot = await connection.getSlot("finalized");
  const startSlot = currentSlot - 20;
  
  // 2. 유효한 슬롯 목록 (빈 슬롯 제외)
  const slots = await connection.getBlocks(startSlot, currentSlot, "finalized");
  
  console.log(`범위: ${startSlot}~${currentSlot} (${currentSlot - startSlot + 1} slots)`);
  console.log(`유효 블록: ${slots.length}개`);
  console.log(`빈 슬롯: ${currentSlot - startSlot + 1 - slots.length}개`);
  
  // 3. 각 슬롯의 블록 조회
  for (const slot of slots.slice(0, 3)) {
    const block = await connection.getBlock(slot, {
      maxSupportedTransactionVersion: 0,
      transactionDetails: "full",
      commitment: "finalized",
    });
    
    if (block) {
      const okTxs = block.transactions.filter(t => t.meta?.err === null);
      console.log(`Slot ${slot}: ${okTxs.length} ok txs, hash=${block.blockhash.slice(0,16)}...`);
    }
  }
}
```

## Dagaon Core 컴포넌트 매핑

| Dagaon Core 함수/구조체 | EVM | Solana |
|------------------------|-----|--------|
| `Publisher.getCurrentBlock()` | `eth_blockNumber` | `getSlot("finalized")` |
| `Publisher.fetchBlock(n)` | `eth_getBlockByNumber(n)` | `getBlocks(start,end)` + `getBlock(slot)` |
| `Publisher.verifyChain(block)` | `parentHash == ringBuffer.last` | `previousBlockhash == ringBuffer.last` |
| `Publisher.checkpoint` | `block_number` (int64) | `slot_number` (int64) |
| `Publisher.pollInterval` | 1초 | 400ms |
| `Publisher.batchSize` | 1 (단일 블록) | 50~500 (슬롯 배치) |

## 참고 자료

- [Solana RPC - getBlocks](https://solana.com/docs/rpc/http/getblocks)
- [Solana RPC - getBlock](https://solana.com/docs/rpc/http/getblock)
- [Add Solana to Your Exchange](https://solana.com/developers/guides/advanced/exchange)
