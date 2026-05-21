# 10.1 블록 싱크용 HTTP RPC

상위 섹션: [10. RPC API 레퍼런스](../README.md)

## 개요

Block Publisher가 Solana 블록을 수집하기 위해 사용하는 핵심 RPC 메서드 7개를 다룬다.

블록 싱크 루프:
```
1. getSlot(finalized)          -> 현재 최종 확정 슬롯 번호
2. getBlocks(lastSynced, current) -> 그 사이의 블록 있는 슬롯 목록
3. for each slot in slots:
     getBlock(slot)             -> 블록 데이터 (TX 포함)
     -> transfer 추출 -> DB 저장
```

---

## getSlot

현재 노드가 처리한 최신 슬롯 번호를 반환한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| commitment | string | 아니오 | "processed", "confirmed", "finalized" |
| minContextSlot | number | 아니오 | 최소 슬롯 컨텍스트 (캐시 무효화용) |

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSlot",
  "params": [
    {
      "commitment": "finalized"
    }
  ]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": 332558490,
  "id": 1
}
```

`result`는 단순 정수(u64)로, 현재 finalized 슬롯 번호이다.

### Dagaon Core 사용

```
Block Publisher의 폴링 루프:
  current_slot = getSlot(finalized)
  if current_slot > last_synced_slot:
    slots = getBlocks(last_synced_slot + 1, current_slot)
    for each slot: getBlock(slot) ...
```

---

## getBlockHeight

현재 블록 높이(빈 슬롯 제외한 순차 높이)를 반환한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| commitment | string | 아니오 | "processed", "confirmed", "finalized" |
| minContextSlot | number | 아니오 | 최소 슬롯 컨텍스트 |

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBlockHeight",
  "params": [
    {
      "commitment": "finalized"
    }
  ]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": 310000000,
  "id": 1
}
```

### slot vs height 관계

```
slot_number:   100  101(빈)  102  103(빈)  104
block_height:   50    -       51    -       52

getSlot(finalized) = 104  (가장 높은 슬롯)
getBlockHeight(finalized) = 52  (블록이 있는 슬롯만 카운트)
```

Dagaon Core에서는 `getSlot`을 기준으로 동기화하고, `block_height`는 getBlock 응답에서 추출하여 저장한다.

---

## getBlocks

두 슬롯 사이에서 실제 블록이 생성된 슬롯 번호 목록을 반환한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| start_slot | u64 | 예 | 시작 슬롯 (포함) |
| end_slot | u64 | 아니오 | 끝 슬롯 (포함). 생략 시 최대 500,000 슬롯 범위 |
| commitment | string | 아니오 | "confirmed" 또는 "finalized" (processed 미지원) |

### 제한사항

- **최대 범위: 500,000 슬롯** (end_slot - start_slot <= 500,000)
- 범위를 초과하면 에러 반환
- Dagaon Core에서는 배치 크기를 10,000~50,000으로 설정 권장

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBlocks",
  "params": [
    332558000,
    332558100,
    {
      "commitment": "finalized"
    }
  ]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": [
    332558000,
    332558001,
    332558003,
    332558004,
    332558006,
    332558007,
    332558009
  ],
  "id": 1
}
```

빈 슬롯(332558002, 332558005, 332558008)은 목록에서 제외된다.

### Dagaon Core 사용

```go
// catch-up 동기화 시
batchSize := 10000
for startSlot <= currentSlot {
    endSlot := min(startSlot + batchSize, currentSlot)
    slots := rpc.GetBlocks(startSlot, endSlot, "finalized")
    for _, slot := range slots {
        block := rpc.GetBlock(slot, ...)
        processBlock(block)
    }
    startSlot = endSlot + 1
}
```

---

## getBlock

슬롯 번호로 블록 전체 데이터를 조회한다. **Block Publisher의 핵심 메서드.**

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| slot | u64 | 예 | 슬롯 번호 |
| encoding | string | 아니오 | "json" (기본), "jsonParsed", "base58", "base64" |
| transactionDetails | string | 아니오 | "full" (기본), "accounts", "signatures", "none" |
| rewards | bool | 아니오 | validator 보상 포함 여부 (기본 true) |
| commitment | string | 아니오 | "confirmed" 또는 "finalized" (processed 미지원) |
| maxSupportedTransactionVersion | number | 아니오 | 최대 지원 TX 버전. **0을 반드시 지정** (legacy + v0 모두 포함) |

### encoding 옵션 비교

| encoding | 장점 | 단점 | 응답 크기 | 파싱 난이도 |
|----------|------|------|----------|------------|
| json | 구조화된 JSON | instruction data는 base58 그대로 | 중간 | 중간 |
| **jsonParsed** | **instruction이 파싱됨** | **모든 프로그램이 파싱되지는 않음** | **큼** | **쉬움** |
| base64 | TX raw 데이터 | 직접 디코딩 필요 | 작음 | 어려움 |
| base58 | raw 데이터 (base58) | base64보다 느림 | 작음 | 어려움 |

**Dagaon Core 권장: `jsonParsed`**
- SystemProgram, TokenProgram의 transfer instruction이 자동 파싱됨
- 파싱 실패 시 원본 데이터가 그대로 반환됨 (graceful degradation)

### maxSupportedTransactionVersion 필수 지정

```
지정하지 않으면:
  - legacy TX만 반환
  - Versioned Transaction (v0)이 포함된 블록에서 에러 발생

지정 시 (0):
  - legacy TX + v0 TX 모두 반환
  - 현재 Solana의 대부분의 TX가 v0
```

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBlock",
  "params": [
    332558000,
    {
      "encoding": "jsonParsed",
      "transactionDetails": "full",
      "rewards": false,
      "commitment": "finalized",
      "maxSupportedTransactionVersion": 0
    }
  ]
}
```

### 응답 구조 (축약)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "blockhash": "7xKJpQx5GBQ4Z2uSyZxVcUjPMFcH2kLdhQKpNdZsqp5",
    "previousBlockhash": "9mNPqJzCpZ8fEpFXGdx1PJrEUb9kCn2eMYptBbMHZHaW",
    "parentSlot": 332557999,
    "blockHeight": 310000000,
    "blockTime": 1716300000,
    "transactions": [
      {
        "transaction": {
          "signatures": ["5xYzAbcDef..."],
          "message": {
            "accountKeys": [
              {
                "pubkey": "DRpbCBMxVnDK7maPMoKsd...",
                "signer": true,
                "writable": true,
                "source": "transaction"
              }
            ],
            "instructions": [
              {
                "program": "system",
                "programId": "11111111111111111111111111111111",
                "parsed": {
                  "type": "transfer",
                  "info": {
                    "source": "DRpbCBMxVnDK7maPMoKsd...",
                    "destination": "9Wfz3pHwRG2URVfJqWtCxc...",
                    "lamports": 1000000000
                  }
                }
              }
            ]
          }
        },
        "meta": {
          "err": null,
          "fee": 5000,
          "preBalances": [5000000000, 1000000000],
          "postBalances": [3999995000, 2000000000],
          "innerInstructions": [],
          "logMessages": [
            "Program 11111111111111111111111111111111 invoke [1]",
            "Program 11111111111111111111111111111111 success"
          ]
        },
        "version": "legacy"
      }
    ]
  },
  "id": 1
}
```

### 응답 필드 -> DB 매핑

| 응답 필드 | DB 테이블.컬럼 |
|----------|--------------|
| blockhash | solana_blocks.blockhash |
| previousBlockhash | solana_blocks.previous_blockhash |
| parentSlot | solana_blocks.parent_slot |
| blockHeight | solana_blocks.block_height |
| blockTime | solana_blocks.block_time |
| transactions[].transaction.signatures[0] | solana_transfers.tx_signature |
| transactions[].transaction.message.instructions[i].parsed | transfer 추출 대상 |
| transactions[].meta.err | null이면 성공, 아니면 실패 TX (저장하지 않음) |

---

## getBlockTime

슬롯의 블록 생성 시간을 Unix timestamp로 반환한다.

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBlockTime",
  "params": [332558000]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": 1716300000,
  "id": 1
}
```

`result`가 `null`일 수 있다:
- 매우 오래된 블록 (timestamp이 기록되지 않은 초기 블록)
- 존재하지 않는 슬롯

Dagaon Core에서는 `getBlock` 응답의 `blockTime` 필드를 사용하므로 별도 호출은 불필요하다.

---

## getTransaction

TX 서명(signature)으로 트랜잭션 상세를 조회한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| signature | string | 예 | base58 인코딩된 TX 서명 |
| encoding | string | 아니오 | "json", "jsonParsed", "base58", "base64" |
| commitment | string | 아니오 | "confirmed" 또는 "finalized" |
| maxSupportedTransactionVersion | number | 아니오 | 0 지정 권장 |

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTransaction",
  "params": [
    "5xYzAbcDef1234567890abcdef1234567890abcdef1234567890abcdef12345678abcdefgh",
    {
      "encoding": "jsonParsed",
      "commitment": "finalized",
      "maxSupportedTransactionVersion": 0
    }
  ]
}
```

### 응답

`getBlock`의 `transactions[]` 항목과 동일한 구조에 `slot`과 `blockTime` 추가:

```json
{
  "jsonrpc": "2.0",
  "result": {
    "slot": 332558000,
    "blockTime": 1716300000,
    "transaction": { "..." },
    "meta": { "..." },
    "version": "legacy"
  },
  "id": 1
}
```

TX가 아직 확인되지 않았거나 존재하지 않으면 `result: null`.

### Dagaon Core 사용

- tx-monitor: `getSignatureStatuses`로 상태만 확인 (더 가벼움)
- 상세 데이터가 필요한 경우에만 `getTransaction` 사용 (디버깅, 감사 등)

---

## getSignaturesForAddress

특정 주소와 관련된 TX 서명 목록을 조회한다. 페이지네이션을 지원한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| address | string | 예 | base58 주소 |
| limit | number | 아니오 | 반환 개수 (1~1000, 기본 1000) |
| before | string | 아니오 | 이 서명 이전의 결과만 (역순 페이지네이션) |
| until | string | 아니오 | 이 서명 이후의 결과만 (하한) |
| commitment | string | 아니오 | "confirmed" 또는 "finalized" |

### 페이지네이션 패턴

```
// 첫 페이지
getSignaturesForAddress(address, { limit: 100, commitment: "finalized" })
-> 최신 100개 서명 반환 (역시간순)

// 다음 페이지
lastSig = results[99].signature
getSignaturesForAddress(address, { limit: 100, before: lastSig })
-> lastSig 이전의 100개 반환

// until 사용: 특정 시점 이후만
getSignaturesForAddress(address, { until: knownSig })
-> knownSig 이후의 결과만 반환
```

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSignaturesForAddress",
  "params": [
    "DRpbCBMxVnDK7maPMoKsdTdEC1a4NoLc8cmm7RFJ3quP",
    {
      "limit": 10,
      "commitment": "finalized"
    }
  ]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": [
    {
      "signature": "5xYzAbcDef...",
      "slot": 332558000,
      "err": null,
      "memo": null,
      "blockTime": 1716300000,
      "confirmationStatus": "finalized"
    },
    {
      "signature": "3mNpQrSt...",
      "slot": 332557990,
      "err": { "InstructionError": [0, "InsufficientFunds"] },
      "memo": null,
      "blockTime": 1716299996,
      "confirmationStatus": "finalized"
    }
  ],
  "id": 1
}
```

### Dagaon Core 사용

- 주로 Block Consumer의 보조 수단으로 사용
- 블록 스캔에서 놓친 입금을 "주소 기반 역추적"으로 보완
- `err`이 null이 아닌 건은 실패한 TX (입금으로 처리하지 않음)

---

## EVM RPC와의 비교 요약

| Solana 메서드 | EVM 대응 | 주요 차이 |
|--------------|---------|----------|
| getSlot | eth_blockNumber | slot은 빈 슬롯 포함, commitment 지원 |
| getBlockHeight | eth_blockNumber | 빈 슬롯 제외한 높이 |
| getBlocks | 없음 (range scan) | EVM은 연속이므로 불필요 |
| getBlock | eth_getBlockByNumber | encoding/transactionDetails 옵션, versioned TX |
| getBlockTime | eth_getBlockByNumber | EVM은 블록에 timestamp 포함 |
| getTransaction | eth_getTransactionReceipt | receipt 대신 meta 필드에 실행 결과 |
| getSignaturesForAddress | 없음 (indexer 필요) | Solana는 RPC 기본 지원 |
