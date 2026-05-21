# 6. Q4: Fee Delegation

원문: ../solana-integration-research.md

## 이 폴더의 목표

Solana fee payer 모델로 커스터디얼 가스비 대납을 단순화한다.

## 원문에서 먼저 볼 소제목

  - 결론: Solana가 EVM보다 훨씬 간단하게 네이티브 지원한다.
  - 6.1 Solana의 Fee Payer 모델
  - 6.2 EVM과의 비교
  - 6.3 Dagaon Core 커스터디얼 모델에서의 적용
  - 6.4 Fee 구조 상세

## 개발할 내용

1. transaction account key ordering에서 첫 signer=fee payer가 보장되는지 builder test를 만든다.
2. SPL token transfer에서 source owner와 fee payer가 다를 때 필요한 signer/account meta를 검증한다.
3. ATA 생성 비용과 실패 TX fee를 회계 이벤트로 남긴다.
4. fee payer SOL 잔액 모니터링과 refill threshold 알림을 만든다.

## 공부할 내용

1. Solana transaction header의 numRequiredSignatures와 account ordering을 공부한다.
2. ComputeBudgetProgram으로 unit limit/price를 설정하는 법을 학습한다.
3. Circle Gas Station 같은 fee payer 운영 사례를 참고한다.

## 실습/검증 과제

1. fee payer A, token owner B 구조로 devnet SPL token transfer를 실행한다.
2. ATA가 없는 수신자에게 createAssociatedTokenAccountIdempotent + transfer를 한 TX에 묶어본다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [결론: Solana가 EVM보다 훨씬 간단하게 네이티브 지원한다.](./01-conclusion-native-fee-payer/README.md)
- [6.1 Solana의 Fee Payer 모델](./06-01-fee-payer-model/README.md)
- [6.2 EVM과의 비교](./06-02-evm-comparison/README.md)
- [6.3 Dagaon Core 커스터디얼 모델에서의 적용](./06-03-custodial-application/README.md)
- [6.4 Fee 구조 상세](./06-04-fee-structure/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
