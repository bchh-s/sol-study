# 7. Solana 기초 개념 상세

원문: ../solana-integration-research.md

## 이 폴더의 목표

Solana 구현에 필요한 기본 개념을 코드 작성 가능한 수준까지 끌어올린다.

## 원문에서 먼저 볼 소제목

  - 7.1 합의 메커니즘
  - 7.2 계정 모델
  - 7.3 Associated Token Account (ATA)
  - 7.4 Transaction 구조
  - 7.5 프로그램 (스마트 컨트랙트)

## 개발할 내용

1. 프로젝트 내부 glossary를 만든다: slot, blockHeight, commitment, account, owner, program, ATA, PDA, CU.
2. PublicKey/base58/lamports/token amount 변환 유틸과 테스트를 만든다.
3. ATA derivation helper와 rent-exempt 조회 wrapper를 만든다.
4. legacy transaction과 v0 transaction 사용 기준을 문서화한다.

## 공부할 내용

1. Account model: lamports/data/owner/executable/rent를 이해한다.
2. PDA와 ATA address derivation을 직접 계산해본다.
3. Transaction size 1232 bytes 제한과 ALT가 필요한 시점을 학습한다.

## 실습/검증 과제

1. devnet에서 새 wallet 생성, airdrop, ATA 생성, SPL token balance 조회까지 CLI/SDK로 수행한다.
2. 하나의 transaction에 여러 instruction을 넣고 atomic failure를 확인한다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [7.1 합의 메커니즘](./07-01-consensus/README.md)
- [7.2 계정 모델](./07-02-account-model/README.md)
- [7.3 Associated Token Account (ATA)](./07-03-associated-token-account/README.md)
- [7.4 Transaction 구조](./07-04-transaction-structure/README.md)
- [7.5 프로그램 (스마트 컨트랙트)](./07-05-programs/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
