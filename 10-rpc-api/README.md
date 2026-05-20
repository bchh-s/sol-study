# 10. RPC API 레퍼런스

원문: ../solana-integration-research.md

## 이 폴더의 목표

RPC 메서드를 기능별 wrapper로 감싸고 rate limit/오류/commitment 정책을 표준화한다.

## 원문에서 먼저 볼 소제목

  - 10.1 블록 싱크용 HTTP RPC
  - 10.2 잔액/계정 조회
  - 10.3 TX 전송/확인
  - 10.4 WebSocket 구독
  - 10.5 RPC 프로바이더 비교

## 개발할 내용

1. SolanaRPC 인터페이스를 만든다: GetFinalizedSlot, GetBlocks, GetBlock, GetSignatureStatuses, SendTransaction, SimulateTransaction, GetRecentPrioritizationFees.
2. 모든 읽기 RPC에는 commitment를 명시하고 기본값 의존을 금지한다.
3. 429/timeout/node behind 오류에 retry/backoff/provider failover 정책을 둔다.
4. blockSubscribe 지원 여부를 provider capability check로 감싼다.
5. 대량 sync는 HTTP로 시작하되 mainnet 부하 테스트 후 Geyser 전환 기준을 수치화한다.

## 공부할 내용

1. 각 RPC의 commitment 지원 여부, pagination/limit, response shape를 공식 문서로 확인한다.
2. provider별 credit 과금 단위와 rate limit을 비교한다.

## 실습/검증 과제

1. devnet RPC wrapper contract test를 작성한다.
2. 같은 slot을 jsonParsed/json/base64 encoding으로 받아 크기와 파싱 난이도를 비교한다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [10.1 블록 싱크용 HTTP RPC](./10-01-block-sync-http-rpc/README.md)
- [10.2 잔액/계정 조회](./10-02-balance-account-rpc/README.md)
- [10.3 TX 전송/확인](./10-03-tx-send-confirm-rpc/README.md)
- [10.4 WebSocket 구독](./10-04-websocket-subscriptions/README.md)
- [10.5 RPC 프로바이더 비교](./10-05-rpc-provider-comparison/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
