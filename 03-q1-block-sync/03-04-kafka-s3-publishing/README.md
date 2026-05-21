# 3.4 Kafka/S3 적재

상위 섹션: [3. Q1: Block Sync 아키텍처 호환성](../README.md)

## 핵심 결론

Kafka/S3 인프라는 **완전 재사용** 가능하다. 변경되는 것은 메시지 JSON 포맷과 S3 object key naming뿐이다.

```
재사용 가능:                        변경 필요:
├── Kafka 클러스터                  ├── 메시지 JSON 스키마
├── Kafka 토픽 파티셔닝             ├── S3 object key 패턴
├── Consumer Group 관리             ├── etcd checkpoint 키 이름
├── S3 버킷 구조                    └── 메시지 사이즈 설정
├── etcd distributed lock           
├── Kafka producer/consumer 코드
└── S3 upload/download 코드
```

## 메시지 포맷 비교

### EVM Kafka 메시지 (현재)

```json
{
  "chainId": 1,
  "blockNumber": 19500000,
  "blockHash": "0xabc123def456789...",
  "parentHash": "0xdef789abc123456...",
  "timestamp": 1716230400,
  "transactions": [
    {
      "index": 0,
      "transaction": {
        "hash": "0x1234567890abcdef...",
        "from": "0xSenderAddress...",
        "to": "0xReceiverAddress...",
        "value": "1000000000000000000",
        "nonce": 42,
        "gasPrice": "20000000000",
        "gas": 21000,
        "input": "0x"
      },
      "receipt": {
        "status": 1,
        "gasUsed": 21000,
        "logs": [
          {
            "address": "0xTokenContract...",
            "topics": [
              "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
              "0x000000000000000000000000SenderAddress...",
              "0x000000000000000000000000ReceiverAddress..."
            ],
            "data": "0x00000000000000000000000000000000000000000000003635c9adc5dea00000",
            "logIndex": 0
          }
        ]
      },
      "traces": [
        {
          "type": "call",
          "from": "0xSender...",
          "to": "0xReceiver...",
          "value": "0x0",
          "traceAddress": [0]
        }
      ]
    }
  ]
}
```

### Solana Kafka 메시지 (제안)

```json
{
  "chainId": 900,
  "slotNumber": 289567890,
  "blockHeight": 267890123,
  "blockhash": "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc747Whez6W",
  "previousBlockhash": "4sGjMW1sUnHzSxGspuhSqoGX4iqjA5j7HFBZ9MNR3op2",
  "parentSlot": 289567889,
  "blockTime": 1716230400,
  "transactions": [
    {
      "signature": "5UfDuX7WXY4J3RCi5GVkpdBPZFTPXRnh7YUax2FdT7Z9eYxjV6Cz8oUwMmnBXKDGU6R4LP7W3VDzq5Ps2W3JnVcT",
      "slot": 289567890,
      "err": null,
      "fee": 5000,
      "computeUnitsConsumed": 150000,
      "preBalances": [1000000000, 500000000, 1],
      "postBalances": [999995000, 500005000, 1],
      "preTokenBalances": [
        {
          "accountIndex": 1,
          "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "owner": "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2",
          "uiTokenAmount": {
            "amount": "1000000000",
            "decimals": 6,
            "uiAmount": 1000.0
          }
        }
      ],
      "postTokenBalances": [
        {
          "accountIndex": 1,
          "mint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
          "owner": "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2",
          "uiTokenAmount": {
            "amount": "900000000",
            "decimals": 6,
            "uiAmount": 900.0
          }
        }
      ],
      "accountKeys": [
        "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
        "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2",
        "11111111111111111111111111111111"
      ],
      "instructions": [
        {
          "programId": "11111111111111111111111111111111",
          "parsed": {
            "type": "transfer",
            "info": {
              "source": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",
              "destination": "7Np41oeYqPefeNQEHSv1UDhYrehxin3NStELsSKCT4K2",
              "lamports": 5000
            }
          }
        }
      ]
    }
  ]
}
```

## 필드 변경 매핑

### 블록 레벨 필드

| EVM 필드 | Solana 필드 | 변환 | 비고 |
|----------|------------|------|------|
| `blockNumber` | `slotNumber` | 직접 대응 | primary key |
| `blockHash` | `blockhash` | hex → base58 | 포맷만 다름 |
| `parentHash` | `previousBlockhash` | hex → base58 | 체인 연결 |
| `timestamp` | `blockTime` | 동일 (unix epoch) | 초 단위 |
| - | `blockHeight` | 신규 | 빈 슬롯 제외한 높이 |
| - | `parentSlot` | 신규 | 직전 블록의 slot |

### 트랜잭션 레벨 필드

| EVM 필드 | Solana 필드 | 변환 | 비고 |
|----------|------------|------|------|
| `transaction.hash` | `signature` | hex → base58 | 고유 식별자 |
| `transaction.from` | `accountKeys[0]` (보통) | 도출 방식 다름 | fee payer |
| `transaction.nonce` | - | 없음 | Solana에 순차 nonce 없음 |
| `receipt.status` | `err` | `status=1` → `err=null` | 성공/실패 |
| `receipt.gasUsed` | `fee` | gas*price → lamports | 수수료 |
| `receipt.logs` | - | 없음 | 대신 balance diff 사용 |
| `traces` | - | 없음 | 대신 preBalances/postBalances |
| - | `preBalances` | 신규 | TX 실행 전 잔액 |
| - | `postBalances` | 신규 | TX 실행 후 잔액 |
| - | `preTokenBalances` | 신규 | TX 실행 전 토큰 잔액 |
| - | `postTokenBalances` | 신규 | TX 실행 후 토큰 잔액 |
| - | `computeUnitsConsumed` | 신규 | 가스 대응 |

## Kafka 토픽 설계

### 현재 EVM 토픽 구조

```
dagaon.block.{chain_id}           // 블록 데이터 (chain_id별 분리)
dagaon.block.1                    // Ethereum mainnet
dagaon.block.8217                 // Kaia mainnet
```

### Solana 토픽 추가

```
dagaon.block.900                  // Solana mainnet (chain_id = 900 제안)
dagaon.block.901                  // Solana devnet (chain_id = 901 제안)
```

### 파티셔닝 전략

```
EVM:   partition_key = block_number % partition_count
       → 순서 보장 (모든 블록이 단일 파티션에 순차 적재)

Solana: partition_key = slot_number % partition_count
        → 동일 전략 유지
        → 주의: Solana는 TX 볼륨이 크므로 파티션 수를 늘릴 수 있음
        
권장:
  EVM: 3 partitions (충분)
  Solana: 6-12 partitions (mainnet TX 볼륨 고려)
```

### 메시지 사이즈 고려

```
EVM 블록 메시지:   평균 ~500KB, 최대 ~2MB
Solana 블록 메시지: 평균 ~5MB, 최대 ~20MB (!!)

이유: Solana 블록당 TX가 10-100배 많음

대응:
  1. Kafka max.message.bytes: 20MB → 50MB로 증가
  2. 또는: TX를 블록과 분리하여 별도 토픽에 발행
     dagaon.block-header.900    // 블록 헤더만 (작음)
     dagaon.block-txs.900      // TX 배열 (대용량)
  3. 또는: 압축 활성화 (lz4, snappy)
     compression.type = lz4    // JSON 기반이므로 압축률 높음
```

## S3 Object Key 전략

### EVM (현재)

```
s3://{bucket}/blocks/{chain_id}/{block_number_padded}.json

예시:
  s3://dagaon-blocks/blocks/1/019500000.json
  s3://dagaon-blocks/blocks/1/019500001.json
  s3://dagaon-blocks/blocks/8217/000150000.json
```

### Solana (제안)

```
s3://{bucket}/blocks/{chain_id}/{slot_number_padded}.json

예시:
  s3://dagaon-blocks/blocks/900/289567890.json
  s3://dagaon-blocks/blocks/900/289567891.json
  s3://dagaon-blocks/blocks/901/000345678.json

주의:
  - Solana slot 번호는 EVM block 번호보다 훨씬 큼 (2.89억 vs 0.19억)
  - padding을 12자리로 설정 (최대 999,999,999,999)
  - 또는 prefix를 epoch 단위로 분리:
    s3://dagaon-blocks/blocks/900/epoch_{N}/{slot_number}.json
```

### S3 데이터 볼륨 예측

```
Solana mainnet 1일 데이터:
  - 슬롯 간격: 400ms
  - 1일 슬롯 수: 86,400 / 0.4 = 216,000 slots
  - 유효 블록: ~205,000 (5% 빈 슬롯 제외)
  - 블록당 평균 크기: 5MB
  - 1일 S3 저장량: 205,000 * 5MB = ~1TB/day

비용:
  - S3 Standard: ~$23/TB/month
  - 1달: ~30TB → ~$690/month (스토리지만)
  
최적화:
  - S3 Intelligent-Tiering 활용
  - 30일 이후 Glacier로 전환
  - 또는 압축 저장 (gzip: ~70% 감소) → ~300GB/day
```

## etcd Checkpoint 변경

### EVM (현재)

```
key:   /dagaon/block-publisher/1/last_processed
value: "19500000"

key:   /dagaon/block-publisher/8217/last_processed
value: "150000"
```

### Solana (변경)

```
key:   /dagaon/block-publisher/900/last_processed_slot
value: "289567890"

추가 메타데이터 (선택):
key:   /dagaon/block-publisher/900/last_processed_block_height
value: "267890123"

key:   /dagaon/block-publisher/900/last_processed_blockhash
value: "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc747Whez6W"
```

### Checkpoint 복구 시나리오

```
1. 정상 재시작:
   slot = etcd.Get("last_processed_slot")
   → getBlocks(slot + 1, currentSlot, "finalized")
   
2. etcd 유실:
   → S3에서 마지막 저장된 블록의 slot_number로 복구
   → 또는 block_height를 getBlockHeight()로 조회하여 대략적 위치 파악
   
3. Cold start (최초 배포):
   → 현재 finalized slot부터 시작 (과거 데이터는 별도 backfill)
```

## 메시지 직렬화/역직렬화

### Producer (Block Publisher)

```go
// Solana Block을 Kafka 메시지로 변환
func (p *SolanaPublisher) toKafkaMessage(slot int64, block *SolanaBlock) *KafkaMessage {
    msg := &SolanaBlockMessage{
        ChainID:           p.chainID,
        SlotNumber:        slot,
        BlockHeight:       block.BlockHeight,
        Blockhash:         block.Blockhash,
        PreviousBlockhash: block.PreviousBlockhash,
        ParentSlot:        block.ParentSlot,
        BlockTime:         block.BlockTime,
        Transactions:      make([]SolanaTransactionMessage, 0, len(block.Transactions)),
    }
    
    for _, tx := range block.Transactions {
        txMsg := SolanaTransactionMessage{
            Signature:            tx.Transaction.Signatures[0],
            Slot:                 slot,
            Err:                  tx.Meta.Err,
            Fee:                  tx.Meta.Fee,
            ComputeUnitsConsumed: tx.Meta.ComputeUnitsConsumed,
            PreBalances:          tx.Meta.PreBalances,
            PostBalances:         tx.Meta.PostBalances,
            PreTokenBalances:     tx.Meta.PreTokenBalances,
            PostTokenBalances:    tx.Meta.PostTokenBalances,
            AccountKeys:          tx.Transaction.Message.AccountKeys,
            Instructions:         tx.Transaction.Message.Instructions,
        }
        msg.Transactions = append(msg.Transactions, txMsg)
    }
    
    return &KafkaMessage{
        Key:   strconv.FormatInt(slot, 10),
        Value: json.Marshal(msg),
    }
}
```

### Consumer (Block Consumer)

```go
// Kafka 메시지를 받아 처리
func (c *SolanaConsumer) processMessage(msg *KafkaMessage) error {
    var block SolanaBlockMessage
    json.Unmarshal(msg.Value, &block)
    
    // 1. 블록 정보 DB 저장
    c.saveBlock(block)
    
    // 2. Transfer 추출 (다음 섹션 3.5에서 상세)
    transfers := c.extractTransfers(block)
    
    // 3. 감시 지갑 매칭
    matched := c.matchWatchedWallets(transfers)
    
    // 4. 매칭된 transfer DB 저장
    c.saveTransfers(matched)
    
    return nil
}
```

## 구현 체크리스트

- [ ] Solana 전용 Kafka 토픽 생성 (`dagaon.block.900`)
- [ ] 메시지 JSON 스키마 정의 (Protocol Buffers 고려)
- [ ] Kafka `max.message.bytes` 설정 검토
- [ ] S3 object key naming 규칙 확정
- [ ] etcd checkpoint 키 형식 확정
- [ ] 메시지 압축 전략 결정 (lz4 권장)
- [ ] mainnet 1일 데이터 볼륨 시뮬레이션
- [ ] Consumer의 deserialization 성능 벤치마크

## 참고 자료

- [Solana RPC - getBlock 응답 구조](https://solana.com/docs/rpc/http/getblock)
- [Kafka Message Size Best Practices](https://docs.confluent.io/platform/current/installation/configuration/topic-configs.html)
