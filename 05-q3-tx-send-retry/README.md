# 5. Q3: TX 전송 및 재전송 방식

원문: ../solana-integration-research.md

## 이 섹션이 중요한 이유

Dagaon Core의 출금 파이프라인은 `tx-ticketer -> tx-signer -> tx-sender -> tx-monitor` 4단계로 구성되어 있다. Solana 체인 통합 시 **가장 크게 변경되는 컴포넌트가 바로 tx-sender와 tx-monitor**이다.

EVM 체인에서는 트랜잭션을 `eth_sendRawTransaction`으로 전송하면 mempool에 들어가 pending 상태로 대기한다. 노드가 살아 있는 한 트랜잭션은 유실되지 않는다. 그러나 **Solana에는 mempool이 없다**. 트랜잭션은 RPC 노드에서 현재 리더 validator로 직접 전달(forwarding)되며, 리더가 처리하지 못하면 **아무 오류 없이 조용히 드롭(silently dropped)** 된다.

이 차이는 단순한 API 변경이 아니라 **출금 안정성의 근본적인 설계 변경**을 요구한다:

```
EVM 세계관:                          Solana 세계관:
┌─────────────┐                     ┌─────────────┐
│  TX 전송     │                     │  TX 전송     │
└──────┬──────┘                     └──────┬──────┘
       │                                   │
       v                                   v
┌─────────────┐                     ┌─────────────┐
│  Mempool    │  <-- 안전하게 대기    │  리더에게    │  <-- 드롭될 수 있음
│  (보관됨)    │                     │  직접 전달    │
└──────┬──────┘                     └──────┬──────┘
       │                                   │
       v                                   v
┌─────────────┐                     ┌─────────────┐
│  블록 포함   │                     │  블록 포함   │  또는 유실
└─────────────┘                     └─────────────┘
```

추가로, Solana의 `recentBlockhash` 기반 트랜잭션은 **60-90초 내에 만료**된다. Dagaon Core처럼 KMS 서명 파이프라인을 거치는 시스템에서는 이 시간이 부족할 수 있다. 이 두 가지 문제를 해결하기 위해 **Durable Nonce**와 **적극적 재전송 전략**이 필수적이다.

## 핵심 과제 3가지

| # | 과제 | EVM 대비 변경 규모 | 난이도 |
|---|------|-------------------|--------|
| 1 | Durable Nonce 기반 TX 빌드 | tx-ticketer 전면 재설계 | 높음 |
| 2 | Mempool 없는 환경에서 적극적 재전송 | tx-sender 재전송 로직 신규 | 높음 |
| 3 | Nonce 계정 풀 관리 | 신규 인프라 컴포넌트 | 중간 |

## 하위 섹션

| 섹션 | 내용 | 핵심 질문 |
|------|------|----------|
| [결론](./01-conclusion-durable-nonce/README.md) | Executive Summary | 왜 durable nonce가 필수인가? |
| [5.1](./05-01-why-durable-nonce/README.md) | 왜 Durable Nonce인가? | recent blockhash가 왜 부족한가? |
| [5.2](./05-02-durable-nonce-details/README.md) | Durable Nonce 상세 | 어떻게 동작하는가? |
| [5.3](./05-03-withdrawal-pipeline/README.md) | 출금 파이프라인 비교 | 각 컴포넌트가 어떻게 변경되는가? |
| [5.4](./05-04-evm-key-differences/README.md) | EVM과의 핵심 차이 | 운영 관점에서 무엇이 다른가? |
| [5.5](./05-05-nonce-account-pool/README.md) | Nonce 계정 풀 관리 | 동시 출금을 어떻게 처리하는가? |

## 개발할 내용

1. hot wallet별 durable nonce account pool 테이블과 상태 전이를 구현한다: `FREE` / `IN_USE` / `DISABLED`.
2. tx-preparer는 nonce account를 row lock으로 할당하고 stored nonce를 조회한다.
3. transaction 첫 instruction에 `AdvanceNonceAccount`를 강제하는 builder guard를 둔다.
4. tx-sender는 `sendTransaction(maxRetries=0)` 후 `signatureSubscribe` + 2초 재전송 루프를 운영한다.
5. 장기 미확인/실패 시 nonce advance로 기존 TX를 무효화하고 새 nonce/priority fee로 새 TX를 생성한다.
6. 중복 지급 방지를 위해 `request_id` idempotency와 completed signature final check를 넣는다.

## 실습 코드

- [`code/durable-nonce-demo.ts`](./code/durable-nonce-demo.ts): devnet에서 durable nonce 계정 생성, nonce 기반 TX 전송, 취소를 시연하는 데모

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
