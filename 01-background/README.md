# 1. 배경

원문: ../solana-integration-research.md

## 이 폴더의 목표

현재 EVM 커스터디얼 지갑 시스템의 암묵적 전제를 식별하고, Solana 통합 시 깨지는 전제를 개발 과제로 전환한다.

## 원문에서 먼저 볼 소제목

  - 현재 시스템 (Dagaon Core)
  - 현재 EVM 전제 조건들

## 개발할 내용

1. 현재 코드에서 chain plugin registry, block publisher/consumer, tx-ticketer/signer/sender/monitor 경계를 문서화한다.
2. EVM 전제 조건 목록을 테스트 가능한 체크리스트로 만든다: parentHash, nonce, gas, ERC20 log, RLP, hex address.
3. Solana용 인터페이스 분기 지점을 정한다: ChainClient, Signer, TransactionBuilder, TransferExtractor.
4. 각 컴포넌트별 “재사용/확장/신규/삭제” 라벨을 붙이고 migration impact 표를 갱신한다.

## 공부할 내용

1. Custodial wallet 입출금 파이프라인에서 idempotency, exactly-once가 실제로 어디서 보장되는지 복습한다.
2. EVM nonce/gas/log 모델이 왜 현재 설계를 단순하게 만들었는지 정리한다.
3. Solana account/transaction/commitment 모델을 EVM 용어로 매핑한다.

## 실습/검증 과제

1. 현재 시스템 sequence diagram을 그린다.
2. EVM 전제 조건을 하나씩 깨뜨렸을 때 실패하는 지점을 표로 적는다.
3. Solana 통합에서 공통 인터페이스로 남길 것과 체인별 구현으로 분리할 것을 ADR 초안으로 쓴다.

## 완료 기준

- 이 섹션의 핵심 개념을 EVM 현재 구조와 비교해서 설명할 수 있다.
- 최소 1개 이상의 코드/쿼리/CLI PoC 또는 테스트 fixture가 있다.
- 구현이 필요한 항목은 파일/컴포넌트/상태 전이/오류 처리 기준까지 쪼개져 있다.
- 공식 문서나 실제 devnet/mainnet 응답으로 가정 하나 이상을 검증했다.

## 하위 header 폴더

- [현재 시스템 (Dagaon Core)](./01-current-system/README.md)
- [현재 EVM 전제 조건들](./02-current-evm-assumptions/README.md)

## 참고 링크

- Solana Transactions: https://solana.com/docs/core/transactions
- Solana Fees: https://solana.com/docs/core/fees
- Solana Durable Nonces: https://solana.com/docs/core/transactions/durable-nonces
- Solana RPC HTTP: https://solana.com/docs/rpc/http
- Transaction Confirmation & Expiration: https://solana.com/developers/guides/advanced/confirmation
- Retrying Transactions: https://solana.com/developers/guides/advanced/retry
- Add Solana to Your Exchange: https://solana.com/developers/guides/advanced/exchange
- AWS KMS Key Spec Reference: https://docs.aws.amazon.com/kms/latest/developerguide/asymmetric-key-specs.html
