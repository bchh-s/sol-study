# 10. RPC API 레퍼런스

원문: ../solana-integration-research.md

## 개요

Solana RPC는 크게 **HTTP JSON-RPC**와 **WebSocket 구독** 두 가지 인터페이스로 나뉜다.

Dagaon Core에서 Solana를 통합하려면 다음 기능별로 RPC 메서드를 사용해야 한다:

| 기능 | 프로토콜 | 메서드 수 | 주요 컴포넌트 |
|------|----------|----------|-------------|
| 블록 싱크 | HTTP | 7개 | Block Publisher |
| 잔액/계정 조회 | HTTP | 5개 | Balance Checker, Deposit Monitor |
| TX 전송/확인 | HTTP | 6개 | tx-sender, tx-monitor |
| 실시간 구독 | WebSocket | 6개 | Block Publisher, tx-monitor |

## HTTP vs WebSocket 분리

### HTTP JSON-RPC (포트 8899)

```
요청/응답 패턴 (pull)
- 블록 데이터 조회: getBlock, getBlocks
- 잔액 조회: getBalance, getTokenAccountsByOwner
- TX 전송: sendTransaction
- 상태 확인: getSignatureStatuses

특성:
- 동기적 요청/응답
- rate limit 적용 (provider별 상이)
- commitment 레벨을 매 요청마다 지정
- retry/backoff 정책 적용 용이
```

### WebSocket (포트 8900)

```
구독/알림 패턴 (push)
- 새 슬롯 알림: slotSubscribe
- TX 확인 알림: signatureSubscribe
- 계정 변경 알림: accountSubscribe

특성:
- 비동기 이벤트 스트림
- 연결 유지 필요 (heartbeat, reconnection)
- 구독 ID 기반 관리
- 일부 구독은 provider에서 미지원 가능 (blockSubscribe)
```

### Dagaon Core에서의 사용 전략

```
1차: HTTP 기반으로 모든 기능 구현
  - Block Publisher: getSlot -> getBlocks -> getBlock 폴링
  - tx-monitor: getSignatureStatuses 폴링
  - 안정적이고 디버깅 용이

2차: WebSocket으로 지연시간 최적화
  - slotSubscribe: 새 슬롯 감지 즉시 getBlock 호출 (폴링 간격 제거)
  - signatureSubscribe: TX 확인 즉시 알림 (폴링 대신)
  - HTTP 폴백은 유지 (WebSocket 연결 끊김 대비)

3차: gRPC/Geyser (대규모 운영 시)
  - Yellowstone Geyser plugin: 블록/TX 스트리밍
  - HTTP RPC보다 10x+ 효율적
  - 자체 노드 운영 또는 Helius gRPC 사용
```

## commitment 레벨 정책

모든 읽기 RPC에는 commitment을 명시적으로 지정한다. 기본값에 의존하지 않는다.

```
| commitment  | 의미                           | 지연시간    | 용도                    |
|-------------|-------------------------------|-----------|------------------------|
| processed   | 1개 validator가 처리            | ~400ms    | 사용하지 않음 (불안정)     |
| confirmed   | supermajority가 투표            | ~5s       | UI 표시용 (빠른 피드백)    |
| finalized   | supermajority + 32 slot 경과   | ~13s      | 입금 확정, 출금 확인 (필수) |
```

Dagaon Core 정책:
- Block Publisher: `finalized` (입금 확정용 데이터만 저장)
- tx-monitor: `finalized` (출금 TX 확인)
- Balance Checker: `confirmed` (UI 표시용은 빠르게, 실제 확정은 finalized)

## 오류 처리 정책

### Rate Limit (429)

```
- exponential backoff: 1s -> 2s -> 4s -> 8s (최대 30s)
- provider failover: primary 429 시 secondary provider로 전환
- 메트릭: rate_limit_hits counter
```

### Timeout

```
- 기본 timeout: 10초
- getBlock (대용량): 30초
- sendTransaction: 5초 (빠른 실패 후 재시도)
```

### Node Behind

```
- getSlot 결과가 이전 폴링보다 작으면 "node behind" 판정
- 다른 노드로 failover
- 메트릭: node_behind_events counter
```

## 하위 문서

- [10.1 블록 싱크용 HTTP RPC](./10-01-block-sync-http-rpc/README.md) -- getSlot, getBlock 등 7개 메서드
- [10.2 잔액/계정 조회](./10-02-balance-account-rpc/README.md) -- getBalance, getTokenAccountsByOwner 등 5개 메서드
- [10.3 TX 전송/확인](./10-03-tx-send-confirm-rpc/README.md) -- sendTransaction, getSignatureStatuses 등 6개 메서드
- [10.4 WebSocket 구독](./10-04-websocket-subscriptions/README.md) -- slotSubscribe 등 6개 구독
- [10.5 RPC 프로바이더 비교](./10-05-rpc-provider-comparison/README.md) -- Alchemy, Helius, QuickNode, 자체 노드

## 실습 코드

- [RPC Explorer (TypeScript)](./code/rpc-explorer.ts) -- 모든 주요 RPC 메서드를 devnet에서 실행하고 응답 저장

## 참고 링크

- Solana RPC HTTP Methods: https://solana.com/docs/rpc/http
- Solana RPC WebSocket Methods: https://solana.com/docs/rpc/websocket
- Solana JSON-RPC API: https://docs.solanalabs.com/api
- Transaction Confirmation: https://solana.com/developers/guides/advanced/confirmation
