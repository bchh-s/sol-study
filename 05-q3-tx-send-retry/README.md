# 5. Q3: TX 전송 및 재전송 방식

원문: ../solana-integration-research.md

## 이 폴더의 목표

mempool 없는 Solana에서 durable nonce 기반 출금 안정성을 구현한다.

## 원문에서 먼저 볼 소제목

  - 결론: Durable Nonce를 사용해야 한다. Mempool이 없으므로 적극적 재전송 필수.
  - 5.1 왜 Durable Nonce인가?
  - 5.2 Durable Nonce 상세
  - 5.3 출금 파이프라인 비교 (EVM vs Solana)
  - 5.4 EVM과의 핵심 차이
  - 5.5 Nonce 계정 풀 관리

## 개발할 내용

1. hot wallet별 durable nonce account pool 테이블과 상태 전이를 구현한다: FREE/IN_USE/DISABLED.
2. tx-preparer는 nonce account를 row lock으로 할당하고 stored nonce를 조회한다.
3. transaction 첫 instruction에 AdvanceNonceAccount를 강제하는 builder guard를 둔다.
4. tx-sender는 sendTransaction(maxRetries=0) 후 signatureSubscribe + 2초 재전송 루프를 운영한다.
5. 장기 미확인/실패 시 nonce advance로 기존 TX를 무효화하고 새 nonce/priority fee로 새 TX를 생성한다.
6. 중복 지급 방지를 위해 request_id idempotency와 completed signature final check를 넣는다.

## 공부할 내용

1. recent blockhash expiration과 durable nonce의 차이를 실제 confirmation guide로 학습한다.
2. Solana retry guide의 TPU/RPC forwarding/drop 시나리오를 이해한다.
3. priority fee bump가 EVM gas replacement와 다른 이유를 정리한다.

## 실습/검증 과제

1. devnet nonce account를 만들고 AdvanceNonce + Transfer transaction을 실행한다.
2. 의도적으로 낮은 priority fee/네트워크 오류를 시뮬레이션하고 재전송 로그를 관찰한다.
3. nonce pool 고갈 시나리오 테스트를 작성한다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [결론: Durable Nonce를 사용해야 한다. Mempool이 없으므로 적극적 재전송 필수.](./01-conclusion-durable-nonce/README.md)
- [5.1 왜 Durable Nonce인가?](./05-01-why-durable-nonce/README.md)
- [5.2 Durable Nonce 상세](./05-02-durable-nonce-details/README.md)
- [5.3 출금 파이프라인 비교 (EVM vs Solana)](./05-03-withdrawal-pipeline/README.md)
- [5.4 EVM과의 핵심 차이](./05-04-evm-key-differences/README.md)
- [5.5 Nonce 계정 풀 관리](./05-05-nonce-account-pool/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
