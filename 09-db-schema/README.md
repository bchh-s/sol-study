# 9. DB 스키마 영향

원문: ../solana-integration-research.md

## 이 폴더의 목표

Solana 전용 테이블을 명확한 invariant와 migration plan으로 설계한다.

## 원문에서 먼저 볼 소제목

  - 권장: Solana 전용 테이블 생성
  - 9.1 blocks 테이블
  - 9.2 transfers 테이블
  - 9.3 wallets 테이블
  - 9.4 withdrawal_transactions 테이블
  - 9.5 durable_nonce_accounts 테이블 (신규)

## 개발할 내용

1. solana_blocks, solana_transfers, solana_wallets, solana_withdrawal_transactions, solana_durable_nonce_accounts DDL을 migration으로 작성한다.
2. base58 길이, tx_signature 길이, amount string precision, unique key를 실제 샘플 데이터로 검증한다.
3. status enum과 retry_at index를 tx lifecycle query 기준으로 조정한다.
4. nonce account pool 할당은 SELECT ... FOR UPDATE SKIP LOCKED 또는 DB별 equivalent로 원자화한다.

## 공부할 내용

1. Solana signature/base58 최대 길이와 token amount decimal 처리 방식을 확인한다.
2. append-only transaction log와 current-state table을 분리하는 패턴을 복습한다.

## 실습/검증 과제

1. 샘플 block/transfer/withdrawal fixture를 insert하고 주요 조회 쿼리 explain을 확인한다.
2. 중복 transfer insert가 unique key로 막히는지 테스트한다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [권장: Solana 전용 테이블 생성](./01-dedicated-tables/README.md)
- [9.1 blocks 테이블](./09-01-blocks-table/README.md)
- [9.2 transfers 테이블](./09-02-transfers-table/README.md)
- [9.3 wallets 테이블](./09-03-wallets-table/README.md)
- [9.4 withdrawal_transactions 테이블](./09-04-withdrawal-transactions-table/README.md)
- [9.5 durable_nonce_accounts 테이블 (신규)](./09-05-durable-nonce-accounts-table/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
