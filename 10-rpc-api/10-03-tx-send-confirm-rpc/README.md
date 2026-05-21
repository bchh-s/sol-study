# 10.3 TX 전송/확인 RPC

상위 섹션: [10. RPC API 레퍼런스](../README.md)

## 개요

Dagaon Core의 tx-sender와 tx-monitor가 사용하는 TX 전송/확인 관련 RPC 메서드 6개를 다룬다.

출금 TX 흐름:
```
1. getLatestBlockhash          -> blockhash + lastValidBlockHeight (만료 기준)
   또는 durable nonce 사용     -> stored_nonce를 blockhash로 사용
2. getRecentPrioritizationFees -> priority fee 결정
3. getFeeForMessage            -> 총 수수료 예측
4. simulateTransaction         -> TX 시뮬레이션 (실패 사전 감지)
5. sendTransaction             -> TX 브로드캐스트
6. getSignatureStatuses        -> TX 확인 상태 폴링
```

---

## sendTransaction

직렬화된 서명 TX를 네트워크에 브로드캐스트한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| transaction | string | 예 | base64 (또는 base58) 인코딩된 서명 TX |
| encoding | string | 아니오 | "base64" (기본) 또는 "base58" |
| skipPreflight | bool | 아니오 | true면 preflight 시뮬레이션 건너뜀 (기본 false) |
| preflightCommitment | string | 아니오 | preflight의 commitment (기본 "finalized") |
| maxRetries | number | 아니오 | RPC 노드의 자동 재전송 횟수 (null이면 노드 기본값) |
| minContextSlot | number | 아니오 | 최소 슬롯 컨텍스트 |

### skipPreflight 사용 전략

```
skipPreflight = false (기본):
  - RPC 노드가 TX를 먼저 시뮬레이션
  - 실패 시 에러 반환 (TX가 네트워크에 전파되지 않음)
  - 장점: 실패할 TX를 미리 거를 수 있음
  - 단점: 지연시간 증가

skipPreflight = true:
  - 시뮬레이션 없이 바로 리더에게 전달
  - 장점: 지연시간 최소화
  - 단점: 실패할 TX도 전파됨 (base fee 소비)

Dagaon Core 권장:
  - 첫 전송: skipPreflight = false (안전)
  - 재전송(retry): skipPreflight = true (이미 시뮬레이션 통과한 TX)
```

### maxRetries 설정

```
maxRetries = 0:
  - RPC 노드가 자동 재전송하지 않음
  - Dagaon Core의 tx-monitor가 직접 재전송 관리
  - 권장: 0 (중앙 제어)

maxRetries 미지정:
  - 노드가 자체적으로 재전송 (횟수 미정)
  - tx-monitor와 중복 재전송 가능성
```

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "sendTransaction",
  "params": [
    "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDDRpbCBMxVnDK7maPMoKsd...(base64 encoded signed tx)...",
    {
      "encoding": "base64",
      "skipPreflight": false,
      "preflightCommitment": "confirmed",
      "maxRetries": 0
    }
  ]
}
```

### 응답 (성공)

```json
{
  "jsonrpc": "2.0",
  "result": "5xYzAbcDef1234567890abcdef1234567890abcdef1234567890abcdef12345678abcdefgh",
  "id": 1
}
```

`result`: TX 서명 (base58). 이 값으로 `getSignatureStatuses`를 폴링한다.

### 응답 (에러)

```json
{
  "jsonrpc": "2.0",
  "error": {
    "code": -32002,
    "message": "Transaction simulation failed: Error processing Instruction 0: custom program error: 0x1",
    "data": {
      "accounts": null,
      "err": { "InstructionError": [0, { "Custom": 1 }] },
      "logs": [
        "Program 11111111111111111111111111111111 invoke [1]",
        "Program 11111111111111111111111111111111 failed: custom program error: 0x1"
      ],
      "returnData": null,
      "unitsConsumed": 150
    }
  },
  "id": 1
}
```

### EVM 대응: eth_sendRawTransaction

```
EVM:
  eth_sendRawTransaction("0xf86c...") -> "0xtxhash..."
  - TX가 mempool에 들어감
  - 언젠가 채굴되거나 replacement됨
  - 반환값: TX hash

Solana:
  sendTransaction("base64...") -> "5xYz..."
  - TX가 현재 리더에게 전달됨
  - mempool 없음 -> 리더가 처리하지 않으면 소실
  - 반환값: TX signature
  - 재전송이 필수적 (리더가 놓칠 수 있음)
```

---

## simulateTransaction

TX를 온체인에 제출하지 않고 시뮬레이션만 수행한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| transaction | string | 예 | base64 인코딩된 TX |
| encoding | string | 아니오 | "base64" (기본) |
| sigVerify | bool | 아니오 | true면 서명 검증 수행 (기본 false) |
| replaceRecentBlockhash | bool | 아니오 | true면 시뮬레이션용으로 최신 blockhash로 교체 |
| commitment | string | 아니오 | 시뮬레이션에 사용할 상태의 commitment |
| accounts | object | 아니오 | 시뮬레이션 후 반환할 계정 목록 |
| minContextSlot | number | 아니오 | 최소 슬롯 컨텍스트 |

### replaceRecentBlockhash 사용

```
replaceRecentBlockhash = true:
  - TX에 포함된 blockhash가 만료되었어도 시뮬레이션 가능
  - durable nonce TX에서도 유용: nonce 값에 관계없이 로직 검증
  - 주의: 실제 전송 시에는 유효한 blockhash/nonce 필요

Dagaon Core 사용:
  - TX 서명 전: replaceRecentBlockhash = true로 로직 검증
  - TX 서명 후: replaceRecentBlockhash = false로 실제 조건 확인
```

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "simulateTransaction",
  "params": [
    "AQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABAAEDDRpbCBMx...",
    {
      "encoding": "base64",
      "replaceRecentBlockhash": true,
      "commitment": "finalized"
    }
  ]
}
```

### 응답 (성공)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "context": { "slot": 332558490 },
    "value": {
      "err": null,
      "logs": [
        "Program 11111111111111111111111111111111 invoke [1]",
        "Program 11111111111111111111111111111111 success"
      ],
      "accounts": null,
      "unitsConsumed": 150,
      "returnData": null
    }
  },
  "id": 1
}
```

### 응답 (실패)

```json
{
  "jsonrpc": "2.0",
  "result": {
    "context": { "slot": 332558490 },
    "value": {
      "err": { "InstructionError": [0, "InsufficientFunds"] },
      "logs": [
        "Program 11111111111111111111111111111111 invoke [1]",
        "Transfer: insufficient lamports 1000, need 2000000000",
        "Program 11111111111111111111111111111111 failed: insufficient funds for instruction"
      ],
      "accounts": null,
      "unitsConsumed": 150,
      "returnData": null
    }
  },
  "id": 1
}
```

`err`이 null이면 성공, 아니면 에러 상세 포함. `logs`에서 실패 원인 확인 가능.

---

## getSignatureStatuses

하나 이상의 TX 서명의 확인 상태를 배치로 조회한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| signatures | string[] | 예 | base58 서명 배열 (최대 256개) |
| searchTransactionHistory | bool | 아니오 | true면 아카이브에서도 검색 (기본 false) |

### searchTransactionHistory

```
false (기본):
  - 최근 ~150 슬롯 내의 TX만 검색
  - 빠름
  - 최근에 확인된 TX 상태 체크에 적합

true:
  - 전체 TX 히스토리에서 검색
  - 느릴 수 있음
  - 오래된 TX의 최종 상태 확인에 필요
```

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSignatureStatuses",
  "params": [
    [
      "5xYzAbcDef1234567890abcdef1234567890abcdef1234567890abcdef12345678abcdefgh",
      "3mNpQrSt..."
    ],
    {
      "searchTransactionHistory": true
    }
  ]
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": {
    "context": { "slot": 332558490 },
    "value": [
      {
        "slot": 332558000,
        "confirmations": null,
        "err": null,
        "status": { "Ok": null },
        "confirmationStatus": "finalized"
      },
      null
    ]
  },
  "id": 1
}
```

- `confirmationStatus`: "processed", "confirmed", "finalized"
- `confirmations`: finalized이면 null, 아니면 confirmation 수
- `err`: null이면 성공, 아니면 에러 상세
- 배열의 null 원소: 해당 서명의 TX가 아직 확인되지 않음 (또는 존재하지 않음)

### Dagaon Core tx-monitor 패턴

```go
// 매 폴링 사이클마다
pendingTxs := db.GetBroadcastedTransactions(chainID)
signatures := extractSignatures(pendingTxs)

// 배치 조회 (최대 256개씩)
for batch := range chunk(signatures, 256) {
    statuses := rpc.GetSignatureStatuses(batch, searchTransactionHistory: true)

    for i, status := range statuses.Value {
        if status == nil {
            // 아직 미확인 -> retry_at 체크 후 재전송
            continue
        }
        if status.ConfirmationStatus == "finalized" {
            if status.Err == nil {
                // 성공 -> COMPLETED
                db.UpdateStatus(pendingTxs[i].ID, COMPLETED)
            } else {
                // 실패 (base fee만 소비) -> FAILED
                db.UpdateStatus(pendingTxs[i].ID, FAILED)
            }
        }
    }
}
```

---

## getLatestBlockhash

최신 blockhash와 해당 blockhash가 유효한 마지막 블록 높이를 반환한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| commitment | string | 아니오 | commitment 레벨 |
| minContextSlot | number | 아니오 | 최소 슬롯 컨텍스트 |

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getLatestBlockhash",
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
  "result": {
    "context": { "slot": 332558490 },
    "value": {
      "blockhash": "7xKJpQx5GBQ4Z2uSyZxVcUjPMFcH2kLdhQKpNdZsqp5",
      "lastValidBlockHeight": 310000150
    }
  },
  "id": 1
}
```

- `blockhash`: TX의 `recentBlockhash` 필드에 사용
- `lastValidBlockHeight`: 이 높이를 초과하면 TX가 만료됨 (약 150 블록 = 60~90초)

### TX 만료 감지

```
blockhash 기반 TX (durable nonce 미사용):
  currentHeight = getBlockHeight("finalized")
  if currentHeight > lastValidBlockHeight:
    -> TX 만료됨 (DROPPED 처리)
    -> 새 blockhash로 TX 재생성 필요

durable nonce 기반 TX:
  -> lastValidBlockHeight 만료 무관
  -> nonce가 advance되지 않는 한 영구 유효
  -> Dagaon Core는 durable nonce 사용 권장
```

### EVM 대응

```
EVM:
  nonce 기반 -> TX가 만료되지 않음 (영구)
  replacement만 가능 (같은 nonce, 더 높은 gas)

Solana (recent blockhash):
  blockhash 기반 -> 60~90초 후 만료
  만료 후에는 같은 TX를 다시 전송 불가 (새 blockhash 필요)

Solana (durable nonce):
  nonce 기반 -> 수동 advance 전까지 무기한 유효
  EVM의 nonce와 가장 유사한 동작
```

---

## getFeeForMessage

직렬화된 메시지에 대한 예상 수수료를 반환한다.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| message | string | 예 | base64 인코딩된 직렬화 메시지 |
| commitment | string | 아니오 | commitment 레벨 |

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getFeeForMessage",
  "params": [
    "AQABAgIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEBAQAA",
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
  "result": {
    "context": { "slot": 332558490 },
    "value": 5000
  },
  "id": 1
}
```

`value` = 5,000 lamports (base fee). priority fee는 별도.

### Dagaon Core 사용

- TX 서명 전 수수료 예측
- fee_payer의 SOL 잔액이 충분한지 사전 확인
- 실제 수수료 = getFeeForMessage 결과 + priority fee

---

## getRecentPrioritizationFees

최근 블록들의 priority fee 통계를 반환한다. 적절한 compute unit price를 결정하는 데 사용.

### 파라미터

| 파라미터 | 타입 | 필수 | 설명 |
|---------|------|------|------|
| accountKeys | string[] | 아니오 | 관심 있는 계정 주소 배열 (해당 계정을 사용한 TX의 fee만 조회) |

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getRecentPrioritizationFees",
  "params": []
}
```

### 응답

```json
{
  "jsonrpc": "2.0",
  "result": [
    {
      "slot": 332558488,
      "prioritizationFee": 0
    },
    {
      "slot": 332558489,
      "prioritizationFee": 1000
    },
    {
      "slot": 332558490,
      "prioritizationFee": 5000
    }
  ],
  "id": 1
}
```

최근 150개 슬롯의 priority fee를 반환한다.

### Priority Fee 결정 전략

```
fees = getRecentPrioritizationFees()

// 전략 1: 중앙값 사용
medianFee = median(fees.map(f => f.prioritizationFee))

// 전략 2: 75th percentile (혼잡 시 빠른 확인)
p75Fee = percentile(fees.map(f => f.prioritizationFee), 75)

// 전략 3: 특정 계정의 fee만 참고 (로컬 fee market)
fees = getRecentPrioritizationFees([mintAddress, tokenProgramId])
```

### Dagaon Core 설정

```go
type PriorityFeeConfig struct {
    Strategy    string  // "median", "p75", "fixed"
    MinFee      uint64  // 최소 priority fee (micro-lamports)
    MaxFee      uint64  // 최대 priority fee (과도한 지불 방지)
    FixedFee    uint64  // Strategy="fixed"일 때 사용할 값
}
```

### EVM 대응

```
EVM:
  eth_maxPriorityFeePerGas -> 제안 priority fee (wei)
  eth_feeHistory -> 최근 블록의 base fee, priority fee 히스토리

Solana:
  getRecentPrioritizationFees -> 슬롯별 priority fee (micro-lamports)
  Solana는 "로컬 fee market" (같은 계정을 사용하는 TX끼리 경쟁)
  EVM은 "글로벌 fee market" (모든 TX가 같은 base fee)
```
