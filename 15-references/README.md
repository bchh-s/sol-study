# 15. 참고자료

원문: ../solana-integration-research.md

## 이 폴더의 목표

자료 링크를 단순 모음이 아니라 학습 순서와 검증 과제로 재구성한다.

## 원문에서 먼저 볼 소제목

  - Solana 공식 문서
  - 기술 블로그
  - AWS KMS
  - 라이브러리

## 개발할 내용

1. 링크별로 “읽고 확인할 질문”을 붙인다.
2. 공식 문서, provider 문서, 블로그, 라이브러리 샘플을 분리한다.
3. 읽은 날짜와 문서 버전을 기록해 stale risk를 줄인다.

## 공부할 내용

1. 1순위: Transactions, Confirmation, Retry, Durable Nonces.
2. 2순위: Fees, RPC HTTP/WebSocket, Exchange guide.
3. 3순위: provider-specific APIs, KMS 샘플, production case study.

## 실습/검증 과제

1. 각 문서를 읽고 5줄 요약 + 구현에 미치는 영향 1개를 적는다.
2. 불확실한 주장(AWS KMS Ed25519 availability 등)은 실제 계정/region에서 CLI로 검증한다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [Solana 공식 문서](./01-solana-official-docs/README.md)
- [기술 블로그](./02-technical-blogs/README.md)
- [AWS KMS](./03-aws-kms/README.md)
- [라이브러리](./04-libraries/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
