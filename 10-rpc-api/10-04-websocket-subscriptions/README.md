# 10.4 WebSocket 구독

상위 섹션: [10. RPC API 레퍼런스](../README.md)

## 개요

Solana WebSocket은 실시간 이벤트 알림을 위한 push 기반 인터페이스다. HTTP 폴링 대비 지연시간을 크게 줄일 수 있다.

WebSocket 엔드포인트:
```
Mainnet: wss://api.mainnet-beta.solana.com
Devnet:  wss://api.devnet.solana.com
Provider: wss://{provider-specific-url}
```

### 구독 생명주기

```
1. WebSocket 연결 수립
2. subscribe 요청 -> subscription ID 반환
3. 이벤트 발생 시 -> notification 수신
4. unsubscribe 요청 -> 구독 해제
5. 연결 종료 -> 모든 구독 자동 해제
```

모든 구독의 공통 패턴:

```json
// 구독 요청
{"jsonrpc":"2.0","id":1,"method":"xxxSubscribe","params":[...]}

// 구독 응답 (subscription ID)
{"jsonrpc":"2.0","result":12345,"id":1}

// 알림 수신 (subscription ID로 식별)
{"jsonrpc":"2.0","method":"xxxNotification","params":{"subscription":12345,"result":{...}}}

// 구독 해제 요청
{"jsonrpc":"2.0","id":2,"method":"xxxUnsubscribe","params":[12345]}

// 구독 해제 응답
{"jsonrpc":"2.0","result":true,"id":2}
```

---

## slotSubscribe

새 슬롯이 처리/확인될 때마다 알림을 받는다. 가장 가벼운 구독.

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "slotSubscribe"
}
```

(파라미터 없음)

### 구독 응답

```json
{
  "jsonrpc": "2.0",
  "result": 0,
  "id": 1
}
```

### 알림

```json
{
  "jsonrpc": "2.0",
  "method": "slotNotification",
  "params": {
    "subscription": 0,
    "result": {
      "slot": 332558491,
      "parent": 332558490,
      "root": 332558458
    }
  }
}
```

- `slot`: 현재 처리 중인 슬롯
- `parent`: 부모 슬롯
- `root`: 최근 finalized 슬롯 (= root)

### 해제

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "slotUnsubscribe",
  "params": [0]
}
```

### Dagaon Core 사용

```
Block Publisher에서:
  1. slotSubscribe로 새 슬롯 감지
  2. root (finalized slot) 값이 last_synced_slot보다 크면
  3. getBlocks + getBlock으로 블록 데이터 수집
  4. HTTP 폴링 간격(1~2초)을 없앨 수 있음

장점:
  - 새 블록 감지 지연: 폴링 1~2초 -> WebSocket ~400ms
  - RPC 호출 횟수 감소 (불필요한 getSlot 폴링 제거)
```

---

## blockSubscribe

새 블록의 전체 데이터를 실시간으로 수신한다.

### 주의: 가용성 제한

```
- 모든 RPC 프로바이더가 지원하지는 않음
- Alchemy: 미지원
- Helius: 지원 (유료 플랜)
- 자체 노드: --rpc-pubsub-enable-block-subscription 플래그 필요
- 데이터 양이 매우 많아 bandwidth 부담
```

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "blockSubscribe",
  "params": [
    "all",
    {
      "commitment": "finalized",
      "encoding": "jsonParsed",
      "transactionDetails": "full",
      "showRewards": false,
      "maxSupportedTransactionVersion": 0
    }
  ]
}
```

첫 번째 파라미터 필터:
- `"all"`: 모든 TX 포함
- `{"mentionsAccountOrProgram": "address"}`: 특정 주소/프로그램 관련 TX만

### 알림

```json
{
  "jsonrpc": "2.0",
  "method": "blockNotification",
  "params": {
    "subscription": 0,
    "result": {
      "context": { "slot": 332558491 },
      "value": {
        "slot": 332558491,
        "block": {
          "blockhash": "...",
          "previousBlockhash": "...",
          "parentSlot": 332558490,
          "blockHeight": 310000001,
          "blockTime": 1716300001,
          "transactions": [...]
        },
        "err": null
      }
    }
  }
}
```

### Dagaon Core에서의 고려사항

```
blockSubscribe를 사용하면:
  - getBlock 호출 불필요 (블록 데이터가 push됨)
  - Block Publisher 로직 대폭 단순화
  - 하지만 provider 지원 여부 확인 필수

대안:
  - slotSubscribe (알림) + getBlock (데이터 fetch) 조합이 더 범용적
  - blockSubscribe는 자체 노드 운영 시 사용 권장
```

---

## signatureSubscribe

특정 TX 서명의 확인 상태를 구독한다. **확인 후 자동으로 구독이 해제된다.**

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "signatureSubscribe",
  "params": [
    "5xYzAbcDef1234567890abcdef1234567890abcdef1234567890abcdef12345678abcdefgh",
    {
      "commitment": "finalized"
    }
  ]
}
```

### 알림 (TX 확인 시)

```json
{
  "jsonrpc": "2.0",
  "method": "signatureNotification",
  "params": {
    "subscription": 0,
    "result": {
      "context": { "slot": 332558491 },
      "value": {
        "err": null
      }
    }
  }
}
```

- `err: null`: TX 성공
- `err: {...}`: TX 실패 (블록에 포함되었지만 실행 에러)

### 자동 구독 해제

```
TX가 지정된 commitment 레벨에 도달하면:
  -> 알림 1회 전송
  -> 자동으로 구독 해제 (unsubscribe 불필요)

TX가 만료되면 (blockhash expiry):
  -> 알림 없이 구독이 내부적으로 정리됨
  -> 클라이언트는 timeout으로 감지해야 함
```

### Dagaon Core tx-monitor 패턴

```
방법 1: HTTP 폴링 (현재 권장)
  - getSignatureStatuses를 주기적으로 배치 호출
  - 단순하고 안정적
  - 지연: 폴링 간격 (1~5초)

방법 2: WebSocket + HTTP 폴백 (향후)
  - signatureSubscribe로 즉시 알림
  - WebSocket 끊김 시 HTTP 폴링으로 폴백
  - 지연: ~13초 (finalized 도달 시간)
  - 구현 복잡도 증가
```

---

## accountSubscribe

특정 계정의 데이터가 변경될 때마다 알림을 받는다.

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "accountSubscribe",
  "params": [
    "DRpbCBMxVnDK7maPMoKsdTdEC1a4NoLc8cmm7RFJ3quP",
    {
      "encoding": "jsonParsed",
      "commitment": "finalized"
    }
  ]
}
```

### 알림

```json
{
  "jsonrpc": "2.0",
  "method": "accountNotification",
  "params": {
    "subscription": 0,
    "result": {
      "context": { "slot": 332558491 },
      "value": {
        "lamports": 2500000000,
        "data": ["", "base64"],
        "owner": "11111111111111111111111111111111",
        "executable": false,
        "rentEpoch": 18446744073709551615,
        "space": 0
      }
    }
  }
}
```

### Dagaon Core 사용

```
- fee_payer 잔액 모니터링: lamports가 임계값 이하로 떨어지면 알림
- deposit 지갑 잔액 변화 감지: SOL 입금 실시간 알림
- durable nonce 계정 모니터링: stored_nonce 변경 감지
```

### 해제

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "accountUnsubscribe",
  "params": [0]
}
```

---

## logsSubscribe

TX 실행 로그를 실시간으로 수신한다. 주소 필터 가능.

### 요청: 특정 주소 관련 로그만

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "logsSubscribe",
  "params": [
    {
      "mentions": ["EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"]
    },
    {
      "commitment": "finalized"
    }
  ]
}
```

### 요청: 모든 로그

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "logsSubscribe",
  "params": [
    "all",
    {
      "commitment": "finalized"
    }
  ]
}
```

### 알림

```json
{
  "jsonrpc": "2.0",
  "method": "logsNotification",
  "params": {
    "subscription": 0,
    "result": {
      "context": { "slot": 332558491 },
      "value": {
        "signature": "5xYzAbcDef...",
        "err": null,
        "logs": [
          "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA invoke [1]",
          "Program log: Instruction: Transfer",
          "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA consumed 4645 of 200000 compute units",
          "Program TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA success"
        ]
      }
    }
  }
}
```

### Dagaon Core 사용

- SPL Token 전송 실시간 감지: `mentions`에 Token Program 주소 설정
- 특정 mint(USDC 등)의 전송만 모니터링: `mentions`에 mint 주소 설정

---

## rootSubscribe

새 root(finalized) 슬롯 알림을 받는다.

### 요청

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "rootSubscribe"
}
```

### 알림

```json
{
  "jsonrpc": "2.0",
  "method": "rootNotification",
  "params": {
    "subscription": 0,
    "result": 332558458
  }
}
```

`result`는 새로 finalized된 슬롯 번호 (정수).

### slotSubscribe vs rootSubscribe

```
slotSubscribe:
  - 모든 슬롯 알림 (processed 레벨)
  - 초당 2~3회 (400ms/slot)
  - root 필드로 finalized 슬롯도 확인 가능
  - 더 많은 정보 (slot, parent, root)

rootSubscribe:
  - finalized 슬롯만 알림
  - 더 적은 빈도 (~13초마다)
  - 데이터가 단순 (슬롯 번호만)
  - finality만 추적하면 충분할 때 사용
```

Dagaon Core에서는 `slotSubscribe`의 `root` 필드를 사용하는 것이 더 효율적 (하나의 구독으로 두 가지 정보).

---

## WebSocket 연결 관리

### 재연결 전략

```
WebSocket 연결이 끊어지는 상황:
  1. 네트워크 장애
  2. RPC 노드 재시작
  3. idle timeout (provider별 다름, 보통 5~10분)
  4. rate limit 초과

재연결 로직:
  1. 연결 끊김 감지 (onClose/onError)
  2. exponential backoff: 1s -> 2s -> 4s -> 8s (최대 30s)
  3. 재연결 성공 시 모든 구독 재등록
  4. 재연결 사이에 HTTP 폴링으로 폴백
```

### Heartbeat (Ping/Pong)

```
WebSocket idle timeout 방지:
  - 30초마다 ping 프레임 전송
  - pong 응답이 없으면 연결 끊긴 것으로 판정
  - 재연결 로직 트리거

코드 패턴:
  setInterval(() => ws.ping(), 30000)
  ws.on('pong', () => lastPongAt = Date.now())
  setInterval(() => {
    if (Date.now() - lastPongAt > 60000) ws.terminate()
  }, 10000)
```

### 다중 구독 관리

```
하나의 WebSocket 연결에 여러 구독을 동시에 운영:

ws.subscribe("slotSubscribe")     -> subscriptionId: 0
ws.subscribe("signatureSubscribe") -> subscriptionId: 1
ws.subscribe("accountSubscribe")   -> subscriptionId: 2

알림 수신 시 subscriptionId로 핸들러 라우팅:
  subscriptionId 0 -> handleSlotNotification()
  subscriptionId 1 -> handleSignatureNotification()
  subscriptionId 2 -> handleAccountNotification()

연결 끊김 시:
  모든 구독이 해제됨 -> 재연결 후 모든 구독 재등록 필요
```

### EVM WebSocket과의 비교

| 항목 | EVM (eth_subscribe) | Solana |
|------|-------------------|--------|
| 새 블록 | newHeads | slotSubscribe / blockSubscribe |
| TX 확인 | 없음 (receipt 폴링) | signatureSubscribe (자동 해제) |
| 로그 | logs (토픽 필터) | logsSubscribe (주소 필터) |
| 계정 변경 | 없음 | accountSubscribe |
| Pending TX | newPendingTransactions | 없음 (mempool 없음) |
| finality | 없음 (confirmation 카운트) | rootSubscribe |
