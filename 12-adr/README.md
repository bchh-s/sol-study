# 12. Architecture Decision Records

원문: ../solana-integration-research.md

## 이 폴더의 목표

핵심 결정이 나중에 흔들리지 않도록 근거와 trade-off를 기록한다.

## 원문에서 먼저 볼 소제목

  - ADR-1: 입금 Commitment Level
  - ADR-2: 출금 Durable Nonce
  - ADR-3: DB 테이블 분리
  - ADR-4: Event Confirmer 생략

## 개발할 내용

1. ADR 템플릿을 만들고 finalized, durable nonce, DB 분리, Event Confirmer 생략 ADR을 개별 파일로 분리한다.
2. 각 ADR에 반대안과 폐기 이유를 추가한다.
3. 나중에 구현 결과가 바뀌면 Superseded by 링크로 갱신한다.

## 공부할 내용

1. ADR 형식(Context/Decision/Consequences)을 익힌다.
2. Solana exchange guide와 confirmation/retry guide를 근거 링크로 연결한다.

## 실습/검증 과제

1. ADR-2 durable nonce에 recent blockhash 대안을 실제 운영 조건(KMS latency, approval delay)으로 반박한다.
2. ADR review checklist를 만든다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [ADR-1: 입금 Commitment Level](./adr-01-deposit-commitment/README.md)
- [ADR-2: 출금 Durable Nonce](./adr-02-withdrawal-durable-nonce/README.md)
- [ADR-3: DB 테이블 분리](./adr-03-db-table-separation/README.md)
- [ADR-4: Event Confirmer 생략](./adr-04-skip-event-confirmer/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
